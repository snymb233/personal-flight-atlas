import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {airportLabel,routeLabel,shareSummary,type Airport,type Flight} from '../src/domain.ts';
import {automaticMapMode,mapProjection,mapRoute} from '../src/mapGeometry.ts';
const airports:Record<string,Airport>=JSON.parse(readFileSync(new URL('../worker/airports.json',import.meta.url),'utf8'));
const flight=(origin:string,destination:string,id='1')=>({id,date:'2026-01-01',origin,destination,origin_airport:airports[origin],destination_airport:airports[destination],theoretical_distance_km:1000,flight_duration_minutes:135,airline:'测试航空',aircraft:'',verification:'pending',flight_number:'QA1234'} as Flight);
const domestic=[flight('WUX','PKX'),flight('PKX','WUX','2'),flight('WUX','SHA','3')];
assert.equal(automaticMapMode(domestic),'china');
const single=shareSummary(domestic);assert.equal(single.count,3);assert.equal(single.airports.length,3);assert.equal(single.cities,3);assert.equal(single.coverageText,'覆盖中国的 3 个城市');assert.equal(single.coverageTotal,249);assert.equal(single.minutes,405);assert.equal(single.airlineCount,1);assert.ok(single.coverage>0&&single.coverage<1);
assert.ok(airportLabel(airports.WUX,true).includes('苏南硕放机场'));assert.ok(routeLabel(domestic[0]).includes('无锡'));assert.ok(routeLabel(domestic[0]).includes('北京'));
const international=[flight('PVG','HND'),flight('HND','SFO','2'),flight('SFO','JFK','3'),flight('JFK','LHR','4'),flight('LHR','SIN','5'),flight('SIN','SYD','6')];
assert.equal(automaticMapMode(international),'world');const global=shareSummary(international);assert.equal(global.countryCodes.length,6);assert.equal(global.coverage,6/249*100);assert.equal(global.coverageText,'6 个国家／地区');
const projection=mapProjection('world');
for(const f of international){for(const a of [f.origin_airport,f.destination_airport]){const point=projection([a.longitude,a.latitude])!;assert.ok(point[0]>=0&&point[0]<=1100&&point[1]>=0&&point[1]<=550,'International airport outside world viewport');}const arc=mapRoute(f,projection,'world')!;assert.ok(arc&&Number.isFinite(arc.angle));assert.ok(arc.arrow.every(Number.isFinite));assert.ok(!arc.path.includes('NaN'));}
const seam=mapRoute(flight('JFK','LHR'),projection,'world')!;assert.ok((seam.path.match(/M/g)||[]).length>=2,'Atlantic seam crossing must be clipped into separate path segments');
const pacific=mapRoute(flight('HND','SFO'),projection,'world')!;assert.ok(pacific.path.length>50,'Pacific international route should be a sampled great-circle curve');
assert.equal(shareSummary([domestic[0]]).coverageTotal,249);assert.equal(shareSummary([{...domestic[0],flight_duration_minutes:null}]).minutes,null);
assert.equal(shareSummary(domestic.filter(f=>f.date.startsWith('2025'))).count,0);
console.log('PASS: worldwide airport visibility, Pacific and Atlantic seam routing, arrow direction, human-readable names, country/city coverage, time and airline statistics.');
