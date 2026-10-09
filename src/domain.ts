import { geoInterpolate } from 'd3-geo';

export type Airport = {code: string; name: string; city: string; country: string; continent: string; latitude: number; longitude: number};
export type Flight = {
  id: string; date: string; origin: string; destination: string; flight_number: string; airline: string;
  aircraft: string; registration: string; icao24: string; scheduled_departure: string; scheduled_arrival: string;
  actual_departure: string; actual_arrival: string; departure_timezone: string; arrival_timezone: string;
  reported_distance_km: number | null; reported_duration_minutes: number | null; marked_duration_minutes: number | null; flight_duration_minutes: number | null; source: string; verification: string;
  notes: string; trip: string; theoretical_distance_km: number; actual_duration_minutes: number | null;
  scheduled_duration_minutes: number | null; origin_airport: Airport; destination_airport: Airport; is_demo?: boolean;
  sources?: {name: string; original_json: string; created_at: string}[];
};
export const labels: Record<string, string> = {
  date:'航班日期',origin:'出发机场',destination:'到达机场',flight_number:'航班号',airline:'航空公司',aircraft:'机型',
  registration:'飞机注册号',icao24:'ICAO24',scheduled_departure:'计划起飞时间',scheduled_arrival:'计划到达时间',
  actual_departure:'实际起飞时间',actual_arrival:'实际落地时间',departure_timezone:'出发时区',arrival_timezone:'到达时区',
  reported_distance_km:'来源报告距离（km）',reported_duration_minutes:'来源报告实际时长（分钟）',source:'数据来源',
  marked_duration_minutes:'航班标注时长（分钟）',
  verification:'验证状态',notes:'备注',trip:'旅行分组',
};
export const fmt = (n: number) => new Intl.NumberFormat('zh-CN', {maximumFractionDigits:0}).format(n);
export function duration(n: number | null) {if (n === null) return '待补充'; const m=Math.round(n); return `${Math.floor(m/60)} 小时 ${m%60} 分钟`;}
export const routeKey = (f: Flight) => `${f.origin} → ${f.destination}`;
export function ranking(fs: Flight[], get: (f:Flight)=>string) {
  const counts = new Map<string, number>();
  for (const f of fs) {const k=get(f); if(k) counts.set(k,(counts.get(k)||0)+1);}
  return [...counts].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,10);
}
export function summarize(all: Flight[], year: string) {
  const flights=all.filter(f=>year==='all'||f.date.slice(0,4)===year);
  const airports=[...new Map(flights.flatMap(f=>[f.origin_airport,f.destination_airport]).map(a=>[a.code,a])).values()];
  const years=[...new Set(all.map(f=>f.date.slice(0,4)))].sort().reverse();
  const timed=flights.filter(f=>f.flight_duration_minutes!=null);
  const yearly=[...years].reverse().map(y=>({year:y,count:all.filter(f=>f.date.startsWith(y)).length,distance:all.filter(f=>f.date.startsWith(y)).reduce((s,f)=>s+f.theoretical_distance_km,0)}));
  const latest=year==='all'?years[0]:year;
  const current=all.filter(f=>f.date.slice(0,4)===latest).length;
  const previous=all.filter(f=>Number(f.date.slice(0,4))===Number(latest)-1).length;
  return {flights,airports,years,yearly,count:flights.length,distance:flights.reduce((s,f)=>s+f.theoretical_distance_km,0),
    minutes:timed.length?timed.reduce((s,f)=>s+f.flight_duration_minutes!,0):null,timedCount:timed.length,
    cities:new Set(airports.map(a=>`${a.country}:${a.city}`)).size,countries:new Set(airports.map(a=>a.country).filter(Boolean)).size,
    continents:new Set(airports.map(a=>a.continent).filter(Boolean)).size,routes:new Set(flights.map(routeKey)).size,
    airlines:ranking(flights,f=>f.airline),aircraft:ranking(flights,f=>f.aircraft),days:new Set(flights.map(f=>f.date)).size,
    airlineCount:new Set(flights.map(f=>f.airline).filter(Boolean)).size,aircraftCount:new Set(flights.map(f=>f.aircraft).filter(Boolean)).size,
    longest:flights.length?[...flights].sort((a,b)=>b.theoretical_distance_km-a.theoretical_distance_km)[0]:null,
    shortest:flights.length?[...flights].sort((a,b)=>a.theoretical_distance_km-b.theoretical_distance_km)[0]:null,
    monthly:Array.from({length:12},(_,i)=>flights.filter(f=>Number(f.date.slice(5,7))===i+1).length),
    topRoutes:ranking(flights,routeKey),topAirports:ranking(flights,f=>f.origin),
    comparisonYear:latest,yoy:previous?Math.round((current-previous)/previous*100):null,
  };
}

export function annualSummary(all: Flight[], year: string) {
  const stats=summarize(all,year);
  const earlier=new Set(all.filter(f=>f.date.slice(0,4)<year).flatMap(f=>[f.origin,f.destination]));
  const dates=stats.flights.map(f=>f.date).sort();
  const peak=Math.max(0,...stats.monthly);
  return {...stats,firstDate:dates[0]||'',lastDate:dates.at(-1)||'',
    newAirports:stats.airports.filter(a=>!earlier.has(a.code)),
    aircraftCoverage:stats.flights.filter(f=>f.aircraft.trim()).length,
    pendingCount:stats.flights.filter(f=>f.verification==='pending').length,
    peakMonths:stats.monthly.flatMap((n,i)=>peak&&n===peak?[i+1]:[]),peakCount:peak};
}

export function publicFlightLookup(flightNumber:string,date:string,origin:string,destination:string,registration='') {
  const number=flightNumber.replace(/\s/g,'').toUpperCase();
  if(!/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(number))return [];
  const links=[{label:'Flightradar24 航班历史',url:`https://www.flightradar24.com/data/flights/${number.toLowerCase()}`},
    {label:'按日期和航线搜索',url:`https://www.bing.com/search?q=${encodeURIComponent(`${number} ${date} ${origin} ${destination} aircraft type 机型`)}`}];
  if(/^[A-Z0-9-]{2,24}$/i.test(registration))links.push({label:'按注册号查飞机',url:`https://www.flightradar24.com/data/aircraft/${registration.toLowerCase()}`});
  return links;
}

// Adapted from Flight Atlas makeRouteGeometry (MIT). See licenses/flight-atlas-MIT.txt.
export function routeGeometry(a: Airport,b: Airport) {
  const interpolate=geoInterpolate([a.longitude,a.latitude],[b.longitude,b.latitude]);
  return {type:'LineString' as const,coordinates:Array.from({length:65},(_,i)=>interpolate(i/64))};
}

// Standard P1 import contract, not enabled in this P0 release.
export type TrackPoint = {timestamp:string; latitude:number; longitude:number; altitude_m:number|null; ground_speed_kmh:number|null; heading_deg:number|null; icao24:string|null};

// Display curvature only. Geographic distance remains the airport great-circle distance.
export function displayArc(start: [number,number], end: [number,number]) {
  const dx=end[0]-start[0],dy=end[1]-start[1],length=Math.hypot(dx,dy);
  if(length<.001)return null;
  const bend=Math.min(95,Math.max(16,length*.22));
  const control:[number,number]=[(start[0]+end[0])/2-dy/length*bend,(start[1]+end[1])/2+dx/length*bend];
  const t=.68,u=1-t;
  const arrow:[number,number]=[u*u*start[0]+2*u*t*control[0]+t*t*end[0],u*u*start[1]+2*u*t*control[1]+t*t*end[1]];
  const angle=Math.atan2(u*(control[1]-start[1])+t*(end[1]-control[1]),u*(control[0]-start[0])+t*(end[0]-control[0]))*180/Math.PI;
  return {path:`M${start[0]},${start[1]} Q${control[0]},${control[1]} ${end[0]},${end[1]}`,control,arrow,angle};
}
