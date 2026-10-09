"""Prepare the user-supplied official GeoJSON for local SVG display; never edit its source."""
import hashlib
import json
import math
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parent
source = Path(sys.argv[1])
raw = source.read_bytes()
obj = json.loads(raw.decode('utf-8-sig'))
assert obj['type'] == 'FeatureCollection'
assert len(obj['features']) == 42, 'Unexpected additional or missing official features'
assert obj.get('crs', {}).get('properties', {}).get('name') == 'urn:ogc:def:crs:EPSG::4490', 'Expected the official CGCS2000 export'
polygons = [f for f in obj['features'] if f['geometry']['type'] == 'MultiPolygon']
lines = [f for f in obj['features'] if f['geometry']['type'] == 'MultiLineString']
assert len(polygons) == 34 and len(lines) == 8, 'Unexpected official layer counts; inspect the new source before replacing data'
assert len({f['properties']['gb'] for f in polygons}) == 34
edges = Counter()
for f in polygons:
    for polygon in f['geometry']['coordinates']:
        for index, ring in enumerate(polygon):
            assert len(ring) >= 4 and ring[0] == ring[-1], 'Unclosed official polygon'
            assert all(len(p) == 2 and all(math.isfinite(v) for v in p) and -180 <= p[0] <= 180 and -90 <= p[1] <= 90 for p in ring)
            area = sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring, ring[1:]))
            # D3's spherical polygons use clockwise exteriors; only vertex order changes.
            if (area > 0) == (index == 0):
                ring.reverse()
            edges.update(tuple(sorted((tuple(a), tuple(b)))) for a,b in zip(ring, ring[1:]) if a != b)
assert all(count in (1, 2) for count in edges.values()), 'Unexpected overlapping boundary segments'
for f in lines:
    assert all(len(line) >= 2 and all(len(p) == 2 and all(math.isfinite(v) for v in p) and -180 <= p[0] <= 180 and -90 <= p[1] <= 90 for p in line) for line in f['geometry']['coordinates'])

# ponytail: exact shared edges in this official export suffice; do not snap or reshape government boundaries.
obj['features'] = polygons
obj['boundary_layers'] = {
    'outline': {'type': 'MultiLineString', 'coordinates': [edge for edge,count in edges.items() if count == 1]},
    'provinces': {'type': 'MultiLineString', 'coordinates': [edge for edge,count in edges.items() if count == 2]},
    'special': {'type': 'FeatureCollection', 'features': lines},
}
assert len(edges) == 54586 and len(obj['boundary_layers']['provinces']['coordinates']) == 18951
dest = root / 'public' / 'china-provinces.geojson'
dest.write_text(json.dumps(obj, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
metadata_path = root / 'audit' / 'official-boundaries.json'
metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
metadata.update({
    'status': 'integrated_official_export',
    'local_sha256': hashlib.sha256(raw).hexdigest(), 'runtime_file': str(dest.relative_to(root)),
    'runtime_sha256': hashlib.sha256(dest.read_bytes()).hexdigest(), 'crs': 'EPSG:4490 / CGCS2000',
    'province_count': len(polygons), 'special_line_features': len(lines),
    'outline_segments': 35635, 'shared_province_segments': 18951,
    'provenance': '用户按前一轮核实的天地图官方入口下载并提供；来源文件无内嵌审图号',
    'review_number_scope': '此前记录的是官方网页预览审图号，不是本应用的审图号',
    'coordinate_processing': '坐标数值原样保留；只调整 SVG 所需环方向，并按完全相同边生成绘制层，不简化或补画境界线',
    'integrated_at_utc': datetime.now(timezone.utc).isoformat(),
})
metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
assert hashlib.sha256(source.read_bytes()).hexdigest() == metadata['local_sha256']
print(json.dumps({'provinces': 34, 'special_line_features': 8, 'outline_segments': 35635, 'shared_province_segments': 18951, 'source_unchanged': True, 'runtime_bytes': dest.stat().st_size}))
