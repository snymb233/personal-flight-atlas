"""Windows local OCR and conservative, editable flight candidates. No database writes."""
import base64
import json
import os
import re
import subprocess
import tempfile
import unicodedata
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
AIRLINES = {"MU":"中国东方航空", "FM":"上海航空", "9C":"春秋航空", "HO":"吉祥航空", "CA":"中国国际航空", "CZ":"中国南方航空", "ZH":"深圳航空", "HU":"海南航空", "MF":"厦门航空", "SC":"山东航空", "3U":"四川航空", "JD":"首都航空", "EU":"成都航空"}

def compact(text):
    value = re.sub(r"\s+", "", unicodedata.normalize("NFKC", text)).upper()
    return re.sub(r"(?<=\d)[一—–](?=\d)", "-", value)

def parse_candidates(result, airports):
    lines = result.get("lines") or [{"text": t, "x": 0, "y": i * 20} for i, t in enumerate(result["text"].splitlines())]
    lines = sorted([{**line, "clean": compact(line["text"])} for line in lines], key=lambda line: (line["y"], line["x"]))
    headers = []
    for line in lines:
        match = re.search(r"(?<![A-Z0-9])([A-Z][A-Z0-9]|[0-9][A-Z])\d{3,4}[A-Z]?(?![A-Z0-9])", line["clean"])
        if match:
            number = match[0]
            # Common OCR substitution, limited to the known airline HO.
            if number.startswith("H0"):
                number = "HO" + number[2:]
            headers.append((line["y"], number))
    # ponytail: one image at a time, positional blocks for list screenshots; ambiguous fields stay blank for review.
    if not headers:
        headers = [(lines[0]["y"] if lines else 0, "")]
    rows = []
    aliases = [(code, compact(airport["name"]).removesuffix("机场")) for code, airport in airports.items() if re.search(r"[\u4e00-\u9fff]", airport["name"])] + [("WUX", "无锡硕放"), ("NKG", "南京禄囗"), ("CSX", "伥沙黄花")]
    for i, (y, number) in enumerate(headers[:100]):
        block = lines if len(headers) == 1 else [line for line in lines if y - 12 <= line["y"] < (headers[i+1][0] - 12 if i+1 < len(headers) else float("inf"))]
        text = "\n".join(line["clean"] for line in block)
        stamp = ""
        full = re.search(r"(?<!\d)(20\d{2})[-./年](\d{1,2})[-./月](\d{1,2})(?:日)?(?!\d)", text)
        year = re.search(r"(?<!\d)(20\d{2})(?!\d)", text)
        md = re.search(r"(?<![\d:])(\d{1,2})[·./月-](\d{1,2})(?:日)?(?![\d:])", text)
        try:
            if full:
                stamp = date(*map(int, full.groups())).isoformat()
            elif year and md:
                stamp = date(int(year[1]), int(md[1]), int(md[2])).isoformat()
        except ValueError:
            pass
        found = []
        for line in block:
            latin = unicodedata.normalize("NFKC", line["text"]).upper()
            matches = [(m.start(), m[0]) for m in re.finditer(r"(?<![A-Z0-9])[A-Z]{3}(?![A-Z0-9])", latin) if m[0] in airports]
            matches += [(m.start(),m[1]) for m in re.finditer(r"(?:出发机场|到达机场|FROM|TO)[:：]?([A-Z]{3})(?![A-Z])", line["clean"]) if m[1] in airports]
            if line["clean"] in airports: matches.append((0,line["clean"]))
            matches += [(line["clean"].find(alias), code) for code, alias in aliases if len(alias) >= 4 and alias in line["clean"]]
            for _, code in sorted(set(matches)):
                if code not in found: found.append(code)
        origin, destination = (found + ["", ""])[:2]
        duration = None
        explicit = re.search(r"(?:飞行时长|飞行时间|时长|DURATION)[:：]?(?:(\d{1,2})(?:小时|HRS?|H))?(?:(\d{1,3})(?:分钟|分|MINS?|M))", text)
        if explicit:
            duration = int(explicit[1] or 0) * 60 + int(explicit[2] or 0)
        times = re.findall(r"(?<!\d)([0-2]?\d):([0-5]\d)(?!\d)", text)
        if duration is None and len(times) == 2 and origin and destination and airports[origin]["country"] == airports[destination]["country"] == "CN" and not re.search(r"登机|BOARDING", text):
            start, end = [int(h)*60 + int(m) for h, m in times]
            if start < 1440 and end < 1440:
                duration = end - start + (1440 if "+1" in text or "次日" in text else 0)
        if duration is not None and not 0 < duration <= 2880: duration = None
        rows.append({"date": stamp, "origin": origin, "destination": destination, "flight_number": number,
                     "airline": AIRLINES.get(number[:2], ""), "marked_duration_minutes": duration,
                     "source": "登机牌／截图本地 OCR", "verification": "pending", "ocr_text": text,
                     "notes": "图片识别后请核对日期、机场、航班号与标注时长。"})
    return rows

def recognize(content):
    try:
        data = base64.b64decode(content, validate=True)
    except ValueError as exc:
        raise ValueError("图片内容无效") from exc
    if not 0 < len(data) <= 8_000_000:
        raise ValueError("请选择不超过 8 MB 的图片")
    if data.startswith(b"\xff\xd8\xff"): suffix = ".jpg"
    elif data.startswith(b"\x89PNG\r\n\x1a\n"): suffix = ".png"
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP": suffix = ".webp"
    else: raise ValueError("仅支持 JPG、PNG、WebP 图片")
    ps = Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    if not ps.exists(): raise ValueError("本地图片识别需要 Windows OCR；仍可手动或 CSV 添加")
    with tempfile.TemporaryDirectory(prefix="flight-atlas-ocr-") as folder:
        image = Path(folder) / ("input" + suffix)
        image.write_bytes(data)
        try:
            process = subprocess.run([str(ps), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "ocr.ps1"), "-ImagePath", str(image)], capture_output=True, encoding="utf-8", timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
        except subprocess.TimeoutExpired as exc:
            raise ValueError("图片识别超时，请缩小或裁剪图片后重试") from exc
        if process.returncode:
            raise ValueError("Windows 无法识别这张图片，请检查图片或系统 OCR 语言包")
        return json.loads(process.stdout.lstrip("\ufeff"))
