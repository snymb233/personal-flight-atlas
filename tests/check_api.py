"""Runnable checks; never open or modify the personal database."""
import csv
import io
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
with tempfile.TemporaryDirectory() as temp:
    os.environ["FLIGHT_ATLAS_DB"] = str(Path(temp) / "test.sqlite3")
    import backend as b
    from fastapi.testclient import TestClient

    def request(client, method, path, body=None, status=200):
        r = client.request(method, "/api" + path, json=body) if body is not None else client.request(method, "/api" + path)
        assert r.status_code == status, (path, r.status_code, r.text)
        return r

    f = {"date": "2026-10-01", "origin": "WUX", "destination": "PKX"}
    with TestClient(b.app) as c:
        assert request(c, "GET", "/flights").json() == []
        assert request(c, "GET", "/health").json()["airport_count"] > 5000
        one = request(c, "POST", "/flights", f, 201).json()
        assert 950 < one["theoretical_distance_km"] < 1150
        assert one["actual_duration_minutes"] is None and one["route_kind"] == "theoretical"
        two = request(c, "POST", "/flights", f, 201).json()
        assert one["id"] != two["id"] and len(request(c, "GET", "/flights").json()) == 2
        request(c, "POST", "/flights", {**f, "date": "2026-02-30"}, 422)
        request(c, "POST", "/flights", {**f, "origin": "ZZZ"}, 422)
        request(c, "POST", "/flights", {**f, "icao24": "123xyz"}, 422)
        request(c, "POST", "/flights", {**f, "actual_departure": "2026-10-01T16:40"}, 422)
        request(c, "POST", "/flights", {**f, "actual_departure": "2026-10-01T18:00Z", "actual_arrival": "2026-10-01T16:00Z"}, 422)
        aware = request(c, "POST", "/flights", {**f, "date": "2025-12-31", "actual_departure": "2025-12-31T23:00+08:00", "actual_arrival": "2026-01-01T01:00+09:00"}, 201).json()
        assert aware["actual_duration_minutes"] == 60
        assert aware["actual_departure"] == "2025-12-31T15:00:00Z"
        assert len(request(c, "GET", "/flights?year=2025").json()) == 1
        request(c, "PUT", "/flights/" + one["id"], {**f, "aircraft": "A320"})
        assert request(c, "GET", "/flights/" + one["id"]).json()["aircraft"] == "A320"
        assert len(request(c, "GET", "/flights/" + one["id"]).json()["sources"]) == 2
        # A plan is never an actual duration.
        scheduled = request(c, "POST", "/flights", {**f, "scheduled_departure": "2026-10-01T16:20+08:00", "scheduled_arrival": "2026-10-01T18:35+08:00"}, 201).json()
        assert scheduled["scheduled_duration_minutes"] == 135 and scheduled["actual_duration_minutes"] is None
        assert scheduled["flight_duration_minutes"] == 135
        marked = request(c, "POST", "/flights", {**f, "marked_duration_minutes": 120, "actual_departure": "2026-10-01T16:40+08:00", "actual_arrival": "2026-10-01T18:14+08:00"}, 201).json()
        assert marked["flight_duration_minutes"] == 120 and marked["actual_duration_minutes"] == 94
        request(c, "POST", "/flights", {**f, "marked_duration_minutes": 0}, 422)
        request(c, "POST", "/scan", {"filename": "test.png", "content": "not an image"}, 422)
        assert c.post("/api/scan", json={"filename":"test.png","content":"eA=="}, headers={"Origin":"https://example.com"}).status_code == 403
        csv_body = {"filename": "flights.csv", "content": "date,origin,destination,flight_number\n2026-10-01,WUX,PKX,\n2026-10-02,WUX,PKX,MU0001\n2026-02-30,WUX,PKX,ERR\n"}
        preview = request(c, "POST", "/import/preview", csv_body).json()
        assert preview["valid"] == 2 and preview["errors"] == 1 and preview["duplicates"] == 1
        imp = request(c, "POST", "/import/commit", csv_body).json()
        assert imp["created"] == 1 and imp["skipped"] == 1 and len(imp["errors"]) == 1
        keep = request(c, "POST", "/import/commit", {**csv_body, "strategy": "keep"}).json()
        assert keep["created"] == 2
        merging = {"filename": "merge.csv", "content": "date,origin,destination,registration\n2026-10-01,WUX,PKX,B-TEST\n", "strategy": "merge"}
        assert request(c, "POST", "/import/commit", merging).json()["merged"] == 1
        assert request(c, "GET", "/flights/" + one["id"]).json()["registration"] == "B-TEST"
        # Batch duplicate preview agrees with commit; different times remain separate.
        batch = {"filename": "twice.csv", "content": "date,origin,destination,flight_number,actual_departure\n2024-01-01,WUX,PKX,XX100,2024-01-01T08:00+08:00\n2024-01-01,WUX,PKX,XX100,2024-01-01T08:00+08:00\n2024-01-01,WUX,PKX,XX100,2024-01-01T16:00+08:00\n"}
        assert request(c, "POST", "/import/preview", batch).json()["duplicates"] == 1
        result = request(c, "POST", "/import/commit", batch).json()
        assert result["created"] == 2 and result["skipped"] == 1
        for content in ['not,csv\n1,2', 'date,origin,destination\n"2026-10-01,WUX,PKX', 'date,origin,destination\n2026-10-01,WUX', 'date,date,origin,destination\n2026-10-01,2026-10-01,WUX,PKX']:
            request(c, "POST", "/import/preview", {"filename": "bad.csv", "content": content}, 422 if 'not,csv' not in content else 200)
        request(c, "POST", "/import/preview", {"filename": "bad.json", "content": "null"}, 422)
        prior = len(request(c, "GET", "/flights").json())
        demos = request(c, "GET", "/demo").json()
        assert all(f["is_demo"] for f in demos) and len(demos) == 16
        assert len(request(c, "GET", "/flights").json()) == prior
        blocked = request(c, "POST", "/import/preview", {"filename": "demo.json", "content": (b.ROOT / "data" / "demo.json").read_text(encoding="utf8")}).json()
        assert blocked["valid"] == 0 and blocked["errors"] == 16
        # Daylight-saving gaps/ambiguities require explicit offsets.
        for raw in ["2026-03-08T02:30", "2026-11-01T01:30"]:
            try: b.utc_time(raw, "America/New_York")
            except ValueError: pass
            else: raise AssertionError("DST input should be rejected")
        assert b.utc_time("2026-11-01T01:30-04:00", "America/New_York") == "2026-11-01T05:30:00Z"
        assert b.distance({"latitude": 0, "longitude": 0}, {"latitude": 0, "longitude": 0}) == 0
        assert 20000 < b.distance({"latitude": 0, "longitude": 0}, {"latitude": 0, "longitude": 180}) < 20020
        assert request(c, "GET", "/template.csv").text.startswith("\ufeffdate,origin,destination")
        dumped = request(c, "GET", "/export.json").json()
        assert len(dumped["flights"]) == prior and len(dumped["sources"]) >= prior
        request(c, "DELETE", "/flights/" + two["id"])
        assert len(request(c, "GET", "/flights").json()) == prior - 1
        request(c, "GET", "/flights/" + two["id"], status=404)
        assert c.post('/api/flights', json=f, headers={'Origin':'https://evil.example'}).status_code == 403
        assert c.get('/api/flights', headers={'Host':'evil.example'}).status_code == 403
        assert c.get('/api/flights', headers={'Sec-Fetch-Site':'cross-site'}).status_code == 403
        before_restart = request(c, "GET", "/flights").json()
    with TestClient(b.app) as c:
        assert request(c, "GET", "/flights").json() == before_restart
    print("PASS: CRUD, minimal entry, distance, timezone/DST, actual vs planned, duplicate strategies, invalid imports, year filter, demo isolation, export, persistence, local access checks")
