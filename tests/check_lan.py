"""Temporary database only: authentication and exact Host/Origin checks for mobile access."""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
with tempfile.TemporaryDirectory() as folder:
    os.environ["FLIGHT_ATLAS_DB"] = str(Path(folder) / "check.sqlite3")
    os.environ["FLIGHT_ATLAS_LAN_HOST"] = "192.168.1.123"
    os.environ["FLIGHT_ATLAS_LAN_PASSWORD"] = "synthetic-test-password-only"
    import backend
    from fastapi.testclient import TestClient
    with TestClient(backend.app, base_url="http://192.168.1.123:8767") as client:
        assert client.get("/api/flights").status_code == 401
        assert client.get("/api/flights", auth=("atlas", "wrong-password")).status_code == 401
        auth = ("atlas", "synthetic-test-password-only")
        assert client.get("/api/flights", auth=auth).json() == []
        payload = {"date": "2026-01-01", "origin": "WUX", "destination": "PKX"}
        assert client.post("/api/flights", json=payload, auth=auth, headers={"Origin": "http://192.168.1.123:8767"}).status_code == 201
        for origin in ("http://192.168.1.124:8767", "https://example.com", "http://192.168.1.123:9999"):
            assert client.post("/api/flights", json=payload, auth=auth, headers={"Origin": origin}).status_code == 403
        assert client.get("/api/flights", auth=auth, headers={"Host": "example.com"}).status_code == 403
        assert client.get("/api/flights", auth=auth, headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
        assert client.get("/api/flights", auth=("atlas", "汉字")).status_code == 401
        assert len(client.get("/api/flights", auth=auth).json()) == 1
print("LAN authentication and origin checks passed")
