"""Personal Flight Atlas: single-user, local-first P0 API."""
import csv
import base64
import ipaddress
import io
import json
import math
import os
import re
import secrets
import sqlite3
import uuid
from collections import Counter
from contextlib import asynccontextmanager, contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from scan import recognize, parse_candidates

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("FLIGHT_ATLAS_DB", ROOT / "data" / "atlas.sqlite3"))
LAN_HOST = os.environ.get("FLIGHT_ATLAS_LAN_HOST", "")
LAN_PASSWORD = os.environ.get("FLIGHT_ATLAS_LAN_PASSWORD", "")
if LAN_HOST:
    lan_address = ipaddress.ip_address(LAN_HOST)
    if not isinstance(lan_address, ipaddress.IPv4Address) or not lan_address.is_private or lan_address.is_loopback or lan_address.is_link_local or lan_address.is_unspecified or len(LAN_PASSWORD) < 16:
        raise ValueError("LAN access requires a private IPv4 address and a password of at least 16 characters")
AIRPORTS = {}
# Local display aliases; coordinates and geographical fields remain OurAirports data.
ZH = {
    "WUX": ("无锡", "苏南硕放机场"), "PKX": ("北京", "北京大兴机场"),
    "PEK": ("北京", "北京首都机场"), "PVG": ("上海", "上海浦东机场"),
    "SHA": ("上海", "上海虹桥机场"), "CAN": ("广州", "广州白云机场"),
    "SZX": ("深圳", "深圳宝安机场"), "CTU": ("成都", "成都双流机场"),
    "TFU": ("成都", "成都天府机场"), "XIY": ("西安", "西安咸阳机场"),
    "HGH": ("杭州", "杭州萧山机场"), "KMG": ("昆明", "昆明长水机场"),
    "CKG": ("重庆", "重庆江北机场"), "XMN": ("厦门", "厦门高崎机场"),
    "URC": ("乌鲁木齐", "乌鲁木齐地窝堡机场"), "LHW": ("兰州", "兰州中川机场"),
    "LXA": ("拉萨", "拉萨贡嘎机场"), "SYX": ("三亚", "三亚凤凰机场"),
    "HKG": ("香港", "香港国际机场"), "TPE": ("台北", "桃园国际机场"),
    "MFM": ("澳门", "澳门国际机场"), "NRT": ("东京", "成田国际机场"),
    "HND": ("东京", "羽田机场"), "SIN": ("新加坡", "樟宜机场"),
    "ICN": ("首尔", "仁川国际机场"), "LHR": ("伦敦", "希思罗机场"),
    "JFK": ("纽约", "肯尼迪国际机场"), "SYD": ("悉尼", "悉尼机场"),
    "DNH": ("敦煌", "敦煌莫高机场"), "JGN": ("嘉峪关", "嘉峪关酒泉机场"),
    "YTY": ("扬州", "扬州泰州机场"), "HUZ": ("惠州", "惠州平潭机场"),
    "NKG": ("南京", "南京禄口机场"), "YNZ": ("盐城", "盐城南洋机场"),
    "DLC": ("大连", "大连周水子机场"), "SWA": ("揭阳", "揭阳潮汕机场"),
    "CSX": ("长沙", "长沙黄花机场"),
}
for a in json.loads((ROOT / "data" / "airports.json").read_text(encoding="utf-8")):
    code = a["iata_code"]
    entry = {"code": code, "name": a["name"], "city": a["municipality"] or a["name"],
             "latitude": float(a["latitude_deg"]), "longitude": float(a["longitude_deg"]),
             "country": a["iso_country"], "continent": a["continent"]}
    if code in ZH:
        entry["city"], entry["name"] = ZH[code]
    # ponytail: deterministic preference for duplicate IATA codes; no external lookup at runtime.
    if code not in AIRPORTS or a["type"] == "large_airport":
        AIRPORTS[code] = entry


class FlightInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    date: str = Field(max_length=10)
    origin: str = Field(min_length=3, max_length=3)
    destination: str = Field(min_length=3, max_length=3)
    flight_number: str = Field(default="", max_length=20)
    airline: str = Field(default="", max_length=100)
    aircraft: str = Field(default="", max_length=100)
    registration: str = Field(default="", max_length=24)
    icao24: str = Field(default="", max_length=6)
    scheduled_departure: str = Field(default="", max_length=40)
    scheduled_arrival: str = Field(default="", max_length=40)
    actual_departure: str = Field(default="", max_length=40)
    actual_arrival: str = Field(default="", max_length=40)
    departure_timezone: str = Field(default="", max_length=64)
    arrival_timezone: str = Field(default="", max_length=64)
    reported_distance_km: float | None = Field(default=None, gt=0, le=50000, allow_inf_nan=False)
    reported_duration_minutes: float | None = Field(default=None, gt=0, le=2880, allow_inf_nan=False)
    marked_duration_minutes: float | None = Field(default=None, gt=0, le=2880, allow_inf_nan=False)
    source: str = Field(default="手动录入", max_length=200)
    verification: str = Field(default="pending", pattern="^(pending|user_confirmed|verified)$")
    notes: str = Field(default="", max_length=5000)
    trip: str = Field(default="", max_length=100)


FIELDS = list(FlightInput.model_fields)
TIME_FIELDS = ["scheduled_departure", "scheduled_arrival", "actual_departure", "actual_arrival"]


def utc_time(raw, zone):
    if not raw:
        return ""
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if "T" not in raw and " " not in raw:
            raise ValueError("时间需包含完整日期和时分")
        if dt.tzinfo is None:
            if not zone:
                raise ValueError("无偏移的时间必须指定 IANA 时区，或使用 +08:00 等偏移")
            tz = ZoneInfo(zone)
            candidates = [dt.replace(tzinfo=tz, fold=f) for f in (0, 1)]
            valid = [c for c in candidates if c.astimezone(timezone.utc).astimezone(tz).replace(tzinfo=None) == dt]
            if not valid:
                raise ValueError("该本地时间处于夏令时跳跃区间，请校正")
            if len({c.utcoffset() for c in valid}) > 1:
                raise ValueError("该本地时间有夏令时歧义，请提供明确 UTC 偏移")
            dt = valid[0]
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except (ValueError, ZoneInfoNotFoundError) as exc:
        raise ValueError(f"时间无效：{raw}（{exc}）") from exc


def distance(a, b):
    """Mean Earth radius, kilometres; independent of display projection."""
    lat1, lat2 = math.radians(a["latitude"]), math.radians(b["latitude"])
    dlat = lat2 - lat1
    dlon = math.radians(b["longitude"] - a["longitude"])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(min(1, max(0, h))))


def minutes(start, end):
    return (datetime.fromisoformat(end.replace("Z", "+00:00")) -
            datetime.fromisoformat(start.replace("Z", "+00:00"))).total_seconds() / 60 if start and end else None


def normalize(raw):
    f = FlightInput.model_validate(raw).model_dump()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", f["date"]):
        raise ValueError("日期格式必须是 YYYY-MM-DD")
    date.fromisoformat(f["date"])
    for key in ("origin", "destination"):
        f[key] = f[key].upper()
        if f[key] not in AIRPORTS:
            raise ValueError(f"机场代码未收录：{f[key]}，请使用 IATA 三字码")
    if f["origin"] == f["destination"]:
        raise ValueError("出发和到达机场不能相同")
    f["flight_number"] = re.sub(r"\s+", "", f["flight_number"].upper())
    f["icao24"] = f["icao24"].lower()
    if f["icao24"] and not re.fullmatch(r"[0-9a-f]{6}", f["icao24"]):
        raise ValueError("ICAO24 必须为 6 位十六进制字符")
    for zone in (f["departure_timezone"], f["arrival_timezone"]):
        if zone:
            try:
                ZoneInfo(zone)
            except ZoneInfoNotFoundError as exc:
                raise ValueError(f"未知时区：{zone}") from exc
    for key in TIME_FIELDS:
        f[key] = utc_time(f[key], f["departure_timezone"] if key.endswith("departure") else f["arrival_timezone"])
    for prefix in ("scheduled", "actual"):
        m = minutes(f[prefix + "_departure"], f[prefix + "_arrival"])
        if m is not None and not 0 < m <= 2880:
            raise ValueError(f"{prefix} 到达时间必须晚于出发时间，且时长不超过 48 小时；跨日请写完整日期")
    m = minutes(f["actual_departure"], f["actual_arrival"])
    if m is not None and f["reported_duration_minutes"] is not None and abs(m - f["reported_duration_minutes"]) > 5:
        raise ValueError("填写的实际时长与实际起落时间相差超过 5 分钟，请核对")
    return f


@contextmanager
def connect():
    db = sqlite3.connect(DB_PATH, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        with db:
            yield db
    finally:
        db.close()


def initialize():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        version = db.execute("PRAGMA user_version").fetchone()[0]
        if version > 2:
            raise RuntimeError("数据库版本高于程序版本，请升级程序；不会覆盖数据库")
        if version == 0:
            columns = ",".join(f'"{k}" {"REAL" if k.endswith(("_km", "_minutes")) else "TEXT"}' for k in FIELDS)
            db.execute(f"CREATE TABLE IF NOT EXISTS flights (id TEXT PRIMARY KEY,{columns},created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT)")
            db.execute("CREATE INDEX IF NOT EXISTS flight_date_idx ON flights(date)")
            db.execute("CREATE TABLE IF NOT EXISTS flight_sources (id TEXT PRIMARY KEY,flight_id TEXT NOT NULL REFERENCES flights(id),name TEXT NOT NULL,original_json TEXT NOT NULL,created_at TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS airports (code TEXT PRIMARY KEY, metadata_json TEXT NOT NULL)")
            db.executemany("INSERT OR IGNORE INTO airports VALUES (?,?)", [(code, json.dumps(a, ensure_ascii=False)) for code, a in AIRPORTS.items()])
        elif version == 1:
            db.execute("ALTER TABLE flights ADD COLUMN marked_duration_minutes REAL")
        db.execute("PRAGMA user_version=2")


def now():
    return datetime.now(timezone.utc).isoformat()


def materialize(row):
    f = dict(row)
    f["theoretical_distance_km"] = round(distance(AIRPORTS[f["origin"]], AIRPORTS[f["destination"]]), 2)
    f["actual_duration_minutes"] = minutes(f["actual_departure"], f["actual_arrival"])
    if f["actual_duration_minutes"] is None:
        f["actual_duration_minutes"] = f["reported_duration_minutes"]
    f["scheduled_duration_minutes"] = minutes(f["scheduled_departure"], f["scheduled_arrival"])
    f["flight_duration_minutes"] = f["marked_duration_minutes"] if f["marked_duration_minutes"] is not None else f["scheduled_duration_minutes"]
    f["origin_airport"], f["destination_airport"] = AIRPORTS[f["origin"]], AIRPORTS[f["destination"]]
    f["route_kind"] = "theoretical"
    return f


def save(db, f, raw, record_id=None):
    stamp = now()
    if record_id:
        db.execute(f"UPDATE flights SET {','.join(k+'=?' for k in FIELDS)},updated_at=? WHERE id=? AND deleted_at IS NULL", [f[k] for k in FIELDS] + [stamp, record_id])
    else:
        record_id = str(uuid.uuid4())
        db.execute(f"INSERT INTO flights (id,{','.join(FIELDS)},created_at,updated_at) VALUES ({','.join('?' for _ in range(len(FIELDS)+3))})", [record_id] + [f[k] for k in FIELDS] + [stamp, stamp])
    db.execute("INSERT INTO flight_sources VALUES (?,?,?,?,?)", [str(uuid.uuid4()), record_id, f["source"] or "未注明来源", json.dumps(raw, ensure_ascii=False), stamp])
    return record_id


def same_candidate(a, b):
    if any(a[k] != b[k] for k in ("date", "origin", "destination")):
        return False
    if a["flight_number"] and b["flight_number"] and a["flight_number"] != b["flight_number"]:
        return False
    at = a["actual_departure"] or a["scheduled_departure"]
    bt = b["actual_departure"] or b["scheduled_departure"]
    return not at or not bt or at == bt


def duplicate(db, f):
    # Missing identifiers are a possible duplicate, never proof of one. User can choose keep.
    rows = db.execute("SELECT * FROM flights WHERE date=? AND origin=? AND destination=? AND deleted_at IS NULL", [f["date"], f["origin"], f["destination"]]).fetchall()
    for r in rows:
        if same_candidate(f, r):
            return dict(r)
    return None


ALIASES = {
    "航班日期": "date", "日期": "date", "flightdate": "date", "出发机场": "origin", "from": "origin",
    "到达机场": "destination", "dest": "destination", "to": "destination", "航班号": "flight_number", "flightnumber": "flight_number", "flightno": "flight_number",
    "航空公司": "airline", "机型": "aircraft", "飞机注册号": "registration", "计划起飞时间": "scheduled_departure", "计划到达时间": "scheduled_arrival",
    "实际起飞时间": "actual_departure", "实际落地时间": "actual_arrival", "出发时区": "departure_timezone", "到达时区": "arrival_timezone",
    "飞行距离": "reported_distance_km", "飞行时长": "marked_duration_minutes", "航班标注时长": "marked_duration_minutes", "数据来源": "source", "备注": "notes", "验证状态": "verification", "旅行": "trip",
}


class ImportInput(BaseModel):
    filename: str = Field(max_length=255)
    content: str = Field(max_length=3_000_000)
    strategy: str = Field(default="skip", pattern="^(skip|merge|keep)$")


def parse_import(body):
    if body.filename.lower().endswith(".csv"):
        reader = csv.DictReader(io.StringIO(body.content.lstrip("\ufeff")), strict=True)
        if not reader.fieldnames or len(reader.fieldnames) != len(set(reader.fieldnames)):
            raise ValueError("CSV 表头缺失或存在重复列")
        rows = list(reader)
        if any(None in r or any(v is None for v in r.values()) for r in rows):
            raise ValueError("CSV 列数与表头不一致")
    elif body.filename.lower().endswith(".json"):
        obj = json.loads(body.content)
        rows = obj.get("flights") if isinstance(obj, dict) else obj
    else:
        raise ValueError("请选择 UTF-8 CSV 或标准航班 JSON 文件")
    if not isinstance(rows, list) or not rows or len(rows) > 5000:
        raise ValueError("文件必须包含 1–5000 条航班记录")
    out = []
    for i, raw in enumerate(rows, 2):
        try:
            if not isinstance(raw, dict):
                raise ValueError("每条航班必须是对象")
            if str(raw.get("is_demo", "")).lower() in ("true", "1"):
                raise ValueError("演示数据不允许导入个人航班库")
            data = {}
            for k, v in raw.items():
                key = ALIASES.get(k.strip().lower(), k.strip().lower())
                if key in FIELDS and v not in ("", None):
                    data[key] = v
            out.append({"row": i, "raw": raw, "flight": normalize(data), "error": None})
        except (ValueError, ValidationError) as exc:
            out.append({"row": i, "raw": raw, "error": error_text(exc), "flight": None})
    return out


def error_text(exc):
    if isinstance(exc, ValidationError):
        return "；".join(".".join(str(v) for v in e["loc"]) + "：" + e["msg"] for e in exc.errors())
    return str(exc)


@asynccontextmanager
async def lifespan(app):
    initialize()
    yield


app = FastAPI(title="Personal Flight Atlas", version="0.1.0", lifespan=lifespan)


@app.middleware("http")
async def local_only(request: Request, call_next):
    # Loopback binding plus Host/Origin checks block drive-by browser writes and DNS rebinding.
    if request.url.hostname not in ("127.0.0.1", "localhost", "testserver", LAN_HOST):
        return JSONResponse({"detail": "仅允许本地访问"}, status_code=403)
    if LAN_HOST:
        expected = "Basic " + base64.b64encode(f"atlas:{LAN_PASSWORD}".encode()).decode()
        if not secrets.compare_digest(request.headers.get("authorization", "").encode(), expected.encode()):
            return JSONResponse({"detail": "请输入局域网启动窗口中的用户名和密码"}, status_code=401,
                                headers={"WWW-Authenticate": 'Basic realm="Personal Flight Atlas"', "Cache-Control": "no-store"})
    origin = request.headers.get("origin")
    allowed_origins = {f"http://{host}:{port}" for host in ("127.0.0.1", "localhost") for port in (request.url.port, 5173)}
    if LAN_HOST:
        allowed_origins.add(f"http://{LAN_HOST}:{request.url.port}")
    if origin and origin not in allowed_origins:
        return JSONResponse({"detail": "不允许外部网页访问个人数据"}, status_code=403)
    if request.headers.get("sec-fetch-site") == "cross-site":
        return JSONResponse({"detail": "不允许跨站访问"}, status_code=403)
    if request.url.path.startswith("/api") and request.method in ("POST", "PUT"):
        if not request.headers.get("content-type", "").startswith("application/json"):
            return JSONResponse({"detail": "请使用 JSON 请求"}, status_code=415)
        limit = 11_000_000 if request.url.path == "/api/scan" else 4_000_000
        if len(await request.body()) > limit:
            return JSONResponse({"detail": "请求文件过大"}, status_code=413)
    return await call_next(request)


@app.get("/api/health")
def health():
    return {"name": "Personal Flight Atlas", "status": "ok", "schema_version": 2, "airport_count": len(AIRPORTS), "data_scope": "personal" if DB_PATH.resolve() == (ROOT / "data" / "atlas.sqlite3").resolve() else "isolated"}


@app.get("/api/airports")
def airports(q: str = ""):
    q = q.lower().strip()
    return sorted([a for a in AIRPORTS.values() if not q or q in (a["code"] + a["name"] + a["city"]).lower()], key=lambda a: (a["code"].lower() != q, a["code"]))[:40]


class ScanInput(BaseModel):
    filename: str = Field(max_length=255)
    content: str = Field(max_length=10_700_000)


@app.post("/api/scan")
def scan_image(body: ScanInput):
    try:
        result = recognize(body.content)
        rows = parse_candidates(result, AIRPORTS)
        for row in rows:
            row["source_image"] = body.filename
            row["ocr_language"] = result["language"]
        return {"text": result["text"], "flights": rows, "language": result["language"]}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/api/flights")
def list_flights(year: int | None = None):
    with connect() as db:
        rows = db.execute("SELECT * FROM flights WHERE deleted_at IS NULL" + (" AND substr(date,1,4)=?" if year else "") + " ORDER BY date DESC,created_at DESC", [str(year)] if year else []).fetchall()
        return [materialize(r) for r in rows]


@app.get("/api/demo")
def demo():
    records = json.loads((ROOT / "data" / "demo.json").read_text(encoding="utf-8"))
    return [materialize({**normalize({k: v for k, v in r.items() if k != "is_demo"}), "id": f"demo-{i}", "is_demo": True}) for i, r in enumerate(records)]


@app.post("/api/flights", status_code=201)
def create(body: FlightInput):
    try:
        f = normalize(body.model_dump())
    except ValueError as exc:
        raise HTTPException(422, error_text(exc)) from exc
    with connect() as db:
        ident = save(db, f, body.model_dump())
        return materialize(db.execute("SELECT * FROM flights WHERE id=?", [ident]).fetchone())


@app.get("/api/flights/{ident}")
def detail(ident: str):
    with connect() as db:
        r = db.execute("SELECT * FROM flights WHERE id=? AND deleted_at IS NULL", [ident]).fetchone()
        if not r:
            raise HTTPException(404, "航班不存在")
        return {**materialize(r), "sources": [dict(s) for s in db.execute("SELECT * FROM flight_sources WHERE flight_id=? ORDER BY created_at", [ident])]}


@app.put("/api/flights/{ident}")
def update(ident: str, body: FlightInput):
    detail(ident)
    try:
        f = normalize(body.model_dump())
    except ValueError as exc:
        raise HTTPException(422, error_text(exc)) from exc
    with connect() as db:
        save(db, f, body.model_dump(), ident)
    return detail(ident)


@app.delete("/api/flights/{ident}")
def delete(ident: str):
    detail(ident)
    with connect() as db:
        db.execute("UPDATE flights SET deleted_at=?,updated_at=? WHERE id=?", [now(), now(), ident])
    return {"deleted": ident}


@app.post("/api/import/preview")
def preview(body: ImportInput):
    try:
        parsed = parse_import(body)
    except (ValueError, csv.Error) as exc:
        raise HTTPException(422, error_text(exc)) from exc
    seen = []
    with connect() as db:
        for row in parsed:
            row.pop("raw")
            f = row["flight"]
            row["duplicate"] = False
            if f:
                row["duplicate"] = duplicate(db, f) is not None or any(same_candidate(s, f) for s in seen)
                seen.append(f)
    return {"rows": parsed, "valid": sum(not r["error"] for r in parsed), "errors": sum(bool(r["error"]) for r in parsed), "duplicates": sum(r["duplicate"] for r in parsed)}


@app.post("/api/import/commit")
def commit(body: ImportInput):
    try:
        parsed = parse_import(body)
    except (ValueError, csv.Error) as exc:
        raise HTTPException(422, error_text(exc)) from exc
    result = {"created": 0, "merged": 0, "skipped": 0, "errors": []}
    with connect() as db:
        for row in parsed:
            if row["error"]:
                result["errors"].append({"row": row["row"], "error": row["error"]})
                continue
            f = row["flight"]
            existing = duplicate(db, f)
            if existing and body.strategy == "skip":
                result["skipped"] += 1
            elif existing and body.strategy == "merge":
                # Only fill blanks from fields actually supplied; never overwrite existing evidence.
                merged = {k: existing[k] for k in FIELDS}
                supplied = {ALIASES.get(k.strip().lower(), k.strip().lower()) for k in row["raw"]}
                for k in supplied & set(FIELDS):
                    if merged[k] in (None, ""):
                        merged[k] = f[k]
                try:
                    save(db, normalize(merged), row["raw"], existing["id"])
                    result["merged"] += 1
                except ValueError as exc:
                    result["errors"].append({"row": row["row"], "error": error_text(exc)})
            else:
                save(db, f, row["raw"])
                result["created"] += 1
    return result


def csv_response(rows, fields, filename):
    buf = io.StringIO(newline="")
    writer = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for r in rows:
        # Neutralize spreadsheet formula execution without altering the database.
        writer.writerow({k: ("'" + v if isinstance(v, str) and v.startswith(("=", "+", "-", "@", "\t", "\r")) else v) for k, v in r.items()})
    return Response(content="\ufeff" + buf.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/api/template.csv")
def template():
    return csv_response([], FIELDS, "flight-template.csv")


@app.get("/api/export.csv")
def export_csv():
    return csv_response(list_flights(), ["id"] + FIELDS, "my-flights.csv")


@app.get("/api/export.json")
def export_json():
    with connect() as db:
        data = {"schema_version": 1, "exported_at": now(), "flights": [dict(r) for r in db.execute("SELECT * FROM flights WHERE deleted_at IS NULL")], "sources": [dict(r) for r in db.execute("SELECT s.* FROM flight_sources s JOIN flights f ON f.id=s.flight_id WHERE f.deleted_at IS NULL")]}
    return Response(json.dumps(data, ensure_ascii=False, indent=2), media_type="application/json", headers={"Content-Disposition": 'attachment; filename="my-flights.json"'})


if (ROOT / "dist").exists():
    app.mount("/", StaticFiles(directory=ROOT / "dist", html=True), name="web")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
