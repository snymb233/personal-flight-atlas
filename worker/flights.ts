import Papa from 'papaparse';
import airportsData from './airports.json' with {type:'json'};
import { ApiError } from './auth.ts';
import type { Airport, Flight } from '../src/domain';
export const airports=airportsData as Record<string,Airport>;
const textLimits={date:10,origin:3,destination:3,flight_number:20,airline:100,aircraft:100,registration:24,icao24:6,scheduled_departure:40,scheduled_arrival:40,actual_departure:40,actual_arrival:40,departure_timezone:64,arrival_timezone:64,source:200,verification:20,notes:5000,trip:100};
const numericLimits={reported_distance_km:50000,reported_duration_minutes:2880,marked_duration_minutes:2880};
export const fields=[...Object.keys(textLimits),...Object.keys(numericLimits)];
export type FlightData=Pick<Flight,keyof typeof textLimits|keyof typeof numericLimits>;
const aliases:Record<string,string>={'航班日期':'date','日期':'date','flightdate':'date','出发机场':'origin','from':'origin','到达机场':'destination','dest':'destination','to':'destination','航班号':'flight_number','flightnumber':'flight_number','flightno':'flight_number','航空公司':'airline','机型':'aircraft','飞机注册号':'registration','计划起飞时间':'scheduled_departure','计划到达时间':'scheduled_arrival','实际起飞时间':'actual_departure','实际落地时间':'actual_arrival','出发时区':'departure_timezone','到达时区':'arrival_timezone','飞行距离':'reported_distance_km','飞行时长':'marked_duration_minutes','航班标注时长':'marked_duration_minutes','数据来源':'source','备注':'notes','验证状态':'verification','旅行':'trip'};
const metadata=new Set(['id','created_at','updated_at','deleted_at','sources','origin_airport','destination_airport','theoretical_distance_km','actual_duration_minutes','scheduled_duration_minutes','flight_duration_minutes','route_kind','is_demo','user_id','raw_ocr_text']);
function checkDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
export function utcTime(raw:string,zone:string){
  if(!raw)return '';
  if(!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(raw)||!checkDate(raw.slice(0,10))||Number(raw.slice(11,13))>23||Number(raw.slice(14,16))>59||raw[16]===':'&&Number(raw.slice(17,19))>59)throw new ApiError(422,'时间需包含有效日期和时分');
  if(/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)){
    const stamp=Date.parse(raw);if(!Number.isFinite(stamp))throw new ApiError(422,'时间偏移无效');return new Date(stamp).toISOString();
  }
  if(!zone)throw new ApiError(422,'无偏移时间必须指定 IANA 时区');
  const wanted=raw.replace(' ','T').slice(0,16);const nominal=Date.parse(wanted+':00Z');
  const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const local=(stamp:number)=>formatter.format(new Date(stamp)).replace(' ','T');
  const candidates=new Set<number>();
  for(const shift of [-86400000,0,86400000]){
    const sample=nominal+shift;const offset=Date.parse(local(sample)+':00Z')-sample;
    const candidate=nominal-offset;if(local(candidate)===wanted)candidates.add(candidate);
  }
  if(candidates.size!==1)throw new ApiError(422,candidates.size?'该时间有夏令时歧义，请提供明确 UTC 偏移':'该本地时间不存在，请校正');
  const seconds=raw.slice(16)||':00';return new Date([...candidates][0]+(Number(seconds.slice(1))||0)*1000).toISOString();
}
export const minutes=(start:string,end:string)=>start&&end?(Date.parse(end)-Date.parse(start))/60000:null;
export function normalize(raw:Record<string,unknown>):FlightData{
  const f:Record<string,string|number|null>={};
  for(const [key,max] of Object.entries(textLimits)){
    const value=raw[key]??(key==='source'?'手动录入':key==='verification'?'pending':'');
    if(typeof value!=='string'||value.trim().length>max)throw new ApiError(422,`${key} 类型或长度无效`);
    f[key]=value.trim();
  }
  for(const [key,max] of Object.entries(numericLimits)){
    const value=raw[key];if(value!==null&&value!==undefined&&!['number','string'].includes(typeof value))throw new ApiError(422,`${key} 数值类型无效`);
    const n=value===null||value===undefined||value===''?null:Number(value);
    if(n!==null&&(!Number.isFinite(n)||n<=0||n>max||!['number','string'].includes(typeof value)))throw new ApiError(422,`${key} 数值无效`);
    f[key]=n;
  }
  const flight=f as FlightData;
  if(!checkDate(flight.date))throw new ApiError(422,'日期格式应为有效的 YYYY-MM-DD');
  flight.origin=flight.origin.toUpperCase();flight.destination=flight.destination.toUpperCase();
  if(!airports[flight.origin]||!airports[flight.destination])throw new ApiError(422,'机场未收录，请使用 IATA 三字码');
  if(flight.origin===flight.destination)throw new ApiError(422,'出发和到达机场不能相同');
  flight.flight_number=flight.flight_number.replace(/\s/g,'').toUpperCase();flight.icao24=flight.icao24.toLowerCase();
  if(flight.icao24&&!/^[0-9a-f]{6}$/.test(flight.icao24))throw new ApiError(422,'ICAO24 必须为 6 位十六进制字符');
  if(!['pending','user_confirmed','verified'].includes(flight.verification))throw new ApiError(422,'验证状态无效');
  for(const zone of [flight.departure_timezone,flight.arrival_timezone])if(zone){try{new Intl.DateTimeFormat('en',{timeZone:zone});}catch{throw new ApiError(422,'未知 IANA 时区');}}
  for(const key of ['scheduled_departure','scheduled_arrival','actual_departure','actual_arrival'] as const)flight[key]=utcTime(flight[key],flight[key.endsWith('departure')?'departure_timezone':'arrival_timezone']);
  for(const prefix of ['scheduled','actual'] as const){const m=minutes(flight[`${prefix}_departure`],flight[`${prefix}_arrival`]);if(m!==null&&(m<=0||m>2880))throw new ApiError(422,'到达时间必须晚于出发，且时长不超过 48 小时');}
  const actual=minutes(flight.actual_departure,flight.actual_arrival);
  if(actual!==null&&flight.reported_duration_minutes!==null&&Math.abs(actual-flight.reported_duration_minutes)>5)throw new ApiError(422,'实际时长与实际起落时刻不符，请核对');
  return flight;
}
export function distance(a:Airport,b:Airport){const rad=Math.PI/180;const lat1=a.latitude*rad,lat2=b.latitude*rad;const h=Math.sin((lat2-lat1)/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin((b.longitude-a.longitude)*rad/2)**2;return Math.round(6371.0088*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))))*100)/100;}
export function materialize(f:FlightData,id:string,extra:Record<string,unknown>={}):Flight{
  const a=airports[f.origin],b=airports[f.destination];const scheduled=minutes(f.scheduled_departure,f.scheduled_arrival);
  return {...f,id,...extra,origin_airport:a,destination_airport:b,theoretical_distance_km:distance(a,b),scheduled_duration_minutes:scheduled,actual_duration_minutes:minutes(f.actual_departure,f.actual_arrival)??f.reported_duration_minutes,flight_duration_minutes:f.marked_duration_minutes??scheduled};
}
export type ImportRow={row:number;raw:Record<string,unknown>;flight:FlightData|null;error:string|null;duplicate?:boolean};
export function parseImport(filename:unknown,content:unknown):ImportRow[]{
  if(typeof filename!=='string'||typeof content!=='string'||content.length>3_000_000)throw new ApiError(422,'文件内容或大小无效');
  let rows:unknown;
  if(filename.toLowerCase().endsWith('.csv')){
    const result=Papa.parse<Record<string,string>>(content.replace(/^\uFEFF/,''),{header:true,skipEmptyLines:'greedy'});
    if(result.errors.length||!result.meta.fields?.length||result.meta.renamedHeaders&&Object.keys(result.meta.renamedHeaders).length)throw new ApiError(422,'CSV 表头重复、列数或引号格式无效');
    rows=result.data;
  }else if(filename.toLowerCase().endsWith('.json')){
    try{const parsed:unknown=JSON.parse(content);rows=Array.isArray(parsed)?parsed:parsed&&typeof parsed==='object'?(parsed as Record<string,unknown>).flights:null;}catch{throw new ApiError(422,'JSON 格式无效');}
  }else throw new ApiError(422,'请选择 UTF-8 CSV 或标准航班 JSON');
  if(!Array.isArray(rows)||!rows.length||rows.length>5000)throw new ApiError(422,'文件必须包含 1–5000 条航班记录');
  return rows.map((item,index)=>{
    const row:ImportRow={row:index+2,raw:{},flight:null,error:null};
    try{
      if(!item||Array.isArray(item)||typeof item!=='object')throw new ApiError(422,'每条航班必须是对象');
      row.raw=item as Record<string,unknown>;
      if(row.raw.is_demo)throw new ApiError(422,'演示数据不能导入个人档案');
      if(JSON.stringify(row.raw).length>100_000)throw new ApiError(422,'单条来源记录过大');
      const values:Record<string,unknown>={};
      for(const [key,value] of Object.entries(row.raw)){
        const mapped=aliases[key.trim().toLowerCase()]||key.trim().toLowerCase();
        if(fields.includes(mapped))values[mapped]=value;
        else if(!metadata.has(mapped))throw new ApiError(422,`未知字段：${key}`);
      }
      row.flight=normalize(values);
    }catch(error){row.error=error instanceof Error?error.message:'数据无效';}
    return row;
  });
}
export function suppliedFields(raw:Record<string,unknown>){return new Set(Object.keys(raw).map(key=>aliases[key.trim().toLowerCase()]||key.trim().toLowerCase()));}
export function sameCandidate(a:FlightData,b:FlightData){return a.date===b.date&&a.origin===b.origin&&a.destination===b.destination&&(!a.flight_number||!b.flight_number||a.flight_number===b.flight_number)&&(!(a.actual_departure||a.scheduled_departure)||!(b.actual_departure||b.scheduled_departure)||(a.actual_departure||a.scheduled_departure)===(b.actual_departure||b.scheduled_departure));}
export function csv(rows:Record<string,unknown>[],columns:string[]){return '\uFEFF'+Papa.unparse(rows,{columns,escapeFormulae:true,header:true,newline:'\r\n'});}
