import demo from '../data/demo.json' with {type:'json'};
import {ApiError,authRoute,json,readJson,requireUser,type Env} from './auth.ts';
import {airports,fields,normalize,materialize,parseImport,sameCandidate,suppliedFields,csv,type FlightData} from './flights.ts';
type Row={id:string;user_id:string;date:string;origin:string;destination:string;details:string;created_at:string;updated_at:string;deleted_at:string|null};
const data=(row:Row)=>JSON.parse(row.details) as FlightData;
const record=(row:Row)=>materialize(data(row),row.id,{created_at:row.created_at,updated_at:row.updated_at});
const ownedRows=async(env:Env,userId:string)=>(await env.DB.prepare('SELECT * FROM flights WHERE user_id=? AND deleted_at IS NULL ORDER BY date DESC,created_at DESC').bind(userId).all<Row>()).results;
async function owned(env:Env,userId:string,id:string){const row=await env.DB.prepare('SELECT * FROM flights WHERE user_id=? AND id=? AND deleted_at IS NULL').bind(userId,id).first<Row>();if(!row)throw new ApiError(404,'航班不存在');return row;}
function sourceStatement(env:Env,userId:string,id:string,f:FlightData,raw:Record<string,unknown>,stamp:string){return env.DB.prepare('INSERT INTO flight_sources(id,user_id,flight_id,name,original_json,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),userId,id,f.source||'未注明来源',JSON.stringify(raw),stamp);}
function saveStatements(env:Env,userId:string,f:FlightData,raw:Record<string,unknown>,id=crypto.randomUUID(),existing=false){
  const stamp=new Date().toISOString();
  const write=existing?env.DB.prepare('UPDATE flights SET date=?,origin=?,destination=?,details=?,updated_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL').bind(f.date,f.origin,f.destination,JSON.stringify(f),stamp,id,userId):env.DB.prepare('INSERT INTO flights(id,user_id,date,origin,destination,details,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(id,userId,f.date,f.origin,f.destination,JSON.stringify(f),stamp,stamp);
  return {id,statements:[write,sourceStatement(env,userId,id,f,raw,stamp)]};
}
function download(body:string,name:string,type:string){return new Response(body,{headers:{'Content-Type':type+'; charset=utf-8','Content-Disposition':`attachment; filename="${name}"`}});}
async function api(request:Request,env:Env,path:string){
  const method=request.method;
  if(path==='/api/health'&&method==='GET'){
    const ready=await env.DB.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('users','sessions','flights','flight_sources','auth_limits')").first<{count:number}>();
    if(ready?.count!==5)throw new ApiError(503,'账号数据库尚未初始化');
    return json({name:'Personal Flight Atlas',mode:'cloud',schema_version:3,airport_count:Object.keys(airports).length,data_scope:'account',browser_ocr:true});
  }
  if(path.startsWith('/api/auth/'))return authRoute(request,env,path);
  if(path==='/api/demo'&&method==='GET')return json(demo.map((raw,index)=>materialize(normalize(raw),`demo-${index}`,{is_demo:true})));
  if(path==='/api/airports'&&method==='GET'){
    const query=new URL(request.url).searchParams.get('q')?.trim().toLowerCase()||'';
    if(query.length>100)throw new ApiError(422,'查询条件过长');
    const values=Object.values(airports);const exact=values.find(a=>a.code.toLowerCase()===query);
    const results=values.filter(a=>a!==exact&&(!query||[a.code,a.city,a.name].join(' ').toLowerCase().includes(query))).slice(0,30);
    return json(exact?[exact,...results].slice(0,30):results);
  }
  if(path==='/api/template.csv'&&method==='GET')return download(csv([],fields),'flight-template.csv','text/csv');
  const user=await requireUser(request,env);
  if(path==='/api/flights'&&method==='GET'){
    const year=new URL(request.url).searchParams.get('year');
    return json((await ownedRows(env,user.id)).filter(row=>!year||row.date.startsWith(year+'-')).map(record));
  }
  if(path==='/api/flights'&&method==='POST'){
    const raw=await readJson(request,32_000);
    if(Object.keys(raw).some(key=>!fields.includes(key)))throw new ApiError(422,'航班包含未知字段');
    const flight=normalize(raw);const saved=saveStatements(env,user.id,flight,raw);
    await env.DB.batch(saved.statements);return json(record(await owned(env,user.id,saved.id)),201);
  }
  const id=/^\/api\/flights\/([a-zA-Z0-9-]{1,60})$/.exec(path)?.[1];
  if(id){
    const row=await owned(env,user.id,id);
    if(method==='GET'){
      const sources=(await env.DB.prepare('SELECT name,original_json,created_at FROM flight_sources WHERE user_id=? AND flight_id=? ORDER BY created_at').bind(user.id,id).all()).results;
      return json({...record(row),sources});
    }
    if(method==='PUT'){
      const raw=await readJson(request,32_000);if(Object.keys(raw).some(key=>!fields.includes(key)))throw new ApiError(422,'航班包含未知字段');
      const saved=saveStatements(env,user.id,normalize(raw),raw,id,true);await env.DB.batch(saved.statements);return json(record(await owned(env,user.id,id)));
    }
    if(method==='DELETE'){
      const stamp=new Date().toISOString();await env.DB.prepare('UPDATE flights SET deleted_at=?,updated_at=? WHERE user_id=? AND id=?').bind(stamp,stamp,user.id,id).run();return json({deleted:id});
    }
  }
  if((path==='/api/export.json'||path==='/api/export.csv')&&method==='GET'){
    const rows=await ownedRows(env,user.id);const flights=rows.map(record);
    if(path.endsWith('.csv'))return download(csv(flights,fields),'flight-atlas.csv','text/csv');
    const sources=(await env.DB.prepare('SELECT s.flight_id,s.name,s.original_json,s.created_at FROM flight_sources s JOIN flights f ON s.flight_id=f.id AND s.user_id=f.user_id WHERE s.user_id=? AND f.deleted_at IS NULL ORDER BY s.created_at').bind(user.id).all<{flight_id:string;name:string;original_json:string;created_at:string}>()).results;
    const byId=new Map<string,typeof sources>();for(const source of sources){const list=byId.get(source.flight_id)||[];list.push(source);byId.set(source.flight_id,list);}
    return download(JSON.stringify({schema_version:3,exported_at:new Date().toISOString(),flights:flights.map(f=>({...f,sources:byId.get(f.id)||[]}))},null,2),'flight-atlas.json','application/json');
  }
  if((path==='/api/import/preview'||path==='/api/import/commit')&&method==='POST'){
    const body=await readJson(request);const rows=parseImport(body.filename,body.content);const strategy=body.strategy||'skip';
    if(!['skip','keep','merge'].includes(String(strategy)))throw new ApiError(422,'重复处理策略无效');
    const existing=await ownedRows(env,user.id);
    // ponytail: bucket by date and airports; personal imports do not need a separate matching service.
    const buckets=new Map<string,{id:string;flight:FlightData}[]>();
    const key=(f:FlightData)=>`${f.date}:${f.origin}:${f.destination}`;
    const add=(id:string,flight:FlightData)=>{const list=buckets.get(key(flight))||[];list.push({id,flight});buckets.set(key(flight),list);};
    for(const row of existing)add(row.id,data(row));
    const result={created:0,merged:0,skipped:0,errors:[] as {row:number;error:string}[]};
    const statements:D1PreparedStatement[]=[];
    for(const row of rows){
      if(!row.flight||row.error){result.errors.push({row:row.row,error:row.error||'数据无效'});continue;}
      const f=row.flight;const match=buckets.get(key(f))?.find(item=>sameCandidate(f,item.flight));row.duplicate=!!match;
      if(path.endsWith('/preview')){if(!match)add(`preview-${row.row}`,f);continue;}
      if(match&&strategy==='skip'){result.skipped++;continue;}
      if(match&&strategy==='merge'){
        const merged={...match.flight};for(const field of suppliedFields(row.raw))if(fields.includes(field)&&(merged[field as keyof FlightData]===null||merged[field as keyof FlightData]===''))Object.assign(merged,{[field]:f[field as keyof FlightData]});
        try{const normalized=normalize(merged);statements.push(...saveStatements(env,user.id,normalized,row.raw,match.id,true).statements);match.flight=normalized;result.merged++;}catch(error){result.errors.push({row:row.row,error:error instanceof Error?error.message:'合并失败'});}
      }else{const saved=saveStatements(env,user.id,f,row.raw);statements.push(...saved.statements);add(saved.id,f);result.created++;}
    }
    if(path.endsWith('/preview'))return json({rows:rows.map(({raw:_,...r})=>r),valid:rows.filter(r=>!r.error).length,errors:rows.filter(r=>r.error).length,duplicates:rows.filter(r=>r.duplicate).length});
    for(let i=0;i<statements.length;i+=100)await env.DB.batch(statements.slice(i,i+100));
    return json(result);
  }
  if(path==='/api/scan')throw new ApiError(422,'在线版请使用网页中的浏览器识别入口');
  throw new ApiError(404,'接口不存在');
}
export async function handleApi(request:Request,env:Env){
  let response:Response;
  try{
    const path=new URL(request.url).pathname;
    if(!env.DB||!env.AUTH_PEPPER)throw new ApiError(503,'服务尚未配置完成');
    if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)throw new ApiError(403,'不允许跨站访问个人数据');
    if(request.method==='OPTIONS')throw new ApiError(403,'不允许跨站访问');
    response=await api(request,env,path);
  }catch(error){
    if(error instanceof ApiError)response=json({detail:error.message},error.status,error.status===429?{'Retry-After':'900'}:{});
    else{console.error(JSON.stringify({event:'api_error',path:new URL(request.url).pathname,error:error instanceof Error?error.name:'unknown'}));response=json({detail:'服务暂时不可用，请稍后重试'},500);}
  }
  response.headers.set('Cache-Control','no-store');response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Referrer-Policy','same-origin');
  return response;
}
