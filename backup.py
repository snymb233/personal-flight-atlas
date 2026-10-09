"""Consistent SQLite snapshot, safe while the local server is running."""
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parent
source = root / 'data' / 'atlas.sqlite3'
if not source.exists():
    raise SystemExit('No personal database; start the application once first.')
dest = root / 'data' / 'backups' / f'atlas-{datetime.now(timezone.utc):%Y%m%dT%H%M%S%fZ}.sqlite3'
dest.parent.mkdir(parents=True, exist_ok=True)
with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as src, sqlite3.connect(dest) as out:
    src.backup(out)
    assert out.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
print(dest)
