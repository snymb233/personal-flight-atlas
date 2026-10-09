"""assert checks for OCR parsing; optionally recognize supplied images, read-only."""
import base64
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
with tempfile.TemporaryDirectory() as folder:
    os.environ['FLIGHT_ATLAS_DB'] = str(Path(folder) / 'test.sqlite3')
    import backend as b
    from fastapi.testclient import TestClient
    from scan import parse_candidates

    sample = {'text': '登机牌 BOARDING PASS\n日期 2026-10-01\n航班 MU2667\nFROM WUX TO PKX\n登机时间 15:40\n起飞时间 16:20\n飞行时长 2小时15分钟'}
    one = parse_candidates(sample, b.AIRPORTS)[0]
    assert (one['date'],one['origin'],one['destination'],one['flight_number'],one['marked_duration_minutes']) == ('2026-10-01','WUX','PKX','MU2667',135), one
    no_duration = parse_candidates({'text':sample['text'].split('\n飞行时长')[0]},b.AIRPORTS)[0]
    assert no_duration['marked_duration_minutes'] is None, 'Boarding and departure times are not duration'
    international = parse_candidates({'text':'2026-01-01\nCA123\nJFK LHR\n08:00\n20:00'},b.AIRPORTS)[0]
    assert international['marked_duration_minutes'] is None, 'Unknown international timezones must not be guessed'
    missing = parse_candidates({'text':'MU2667\n01 OCT\nWUX PKX'},b.AIRPORTS)[0]
    assert not missing['date'], 'Missing year must remain blank'
    crossed = parse_candidates({'text':'2025-10-03\nFM9401\nPVG CSX\n22:10\n00:05+1'},b.AIRPORTS)[0]
    assert crossed['marked_duration_minutes'] == 115, crossed
    with TestClient(b.app) as c:
        results = []
        for file in map(Path, sys.argv[1:]):
            response = c.post('/api/scan',json={'filename':file.name,'content':base64.b64encode(file.read_bytes()).decode()})
            assert response.status_code == 200, response.text
            result = response.json()
            assert result['text'] and result['flights']
            assert c.get('/api/flights').json() == [], 'Recognition must not save anything'
            results.append({'file':file.name,'candidates':len(result['flights']),'with_date':sum(bool(r['date']) for r in result['flights']),'with_route':sum(bool(r['origin'] and r['destination']) for r in result['flights']),'with_duration':sum(r['marked_duration_minutes'] is not None for r in result['flights'])})
            (Path(__file__).parent.parent/'output/playwright'/('ocr-'+file.stem+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({'passed':True,'parser':True,'scanDoesNotSave':True,'images':results},ensure_ascii=False))
