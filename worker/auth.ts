const encoder=new TextEncoder();
const SESSION_SECONDS=14*24*60*60;
export type Env={DB:D1Database;AUTH_PEPPER:string};
export type User={id:string;username:string;display_name:string;created_at:string};
type Account=User&{password_hash:string};
export class ApiError extends Error {status:number;constructor(status:number,message:string){super(message);this.status=status;}}
export const json=(data:unknown,status=200,headers:HeadersInit={})=>Response.json(data,{status,headers});
export const base64=(bytes:ArrayBuffer)=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unbase64=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export const digest=async(value:string)=>base64(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
export const token=()=>base64(crypto.getRandomValues(new Uint8Array(32)).buffer);
async function passwordKey(password:string,salt:string,pepper:string){
  const secret=await crypto.subtle.importKey('raw',encoder.encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const input=await crypto.subtle.sign('HMAC',secret,encoder.encode(password));
  const key=await crypto.subtle.importKey('raw',input,'PBKDF2',false,['deriveKey']);
  // Workers caps PBKDF2 at 100k iterations. A separate server secret also protects a database-only leak.
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:unbase64(salt),iterations:100_000,hash:'SHA-256'},key,{name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
}
export async function hashPassword(password:string,pepper:string){
  const salt=token();const key=await passwordKey(password,salt,pepper);
  return JSON.stringify({version:1,salt,verifier:base64(await crypto.subtle.sign('HMAC',key,encoder.encode('flight-atlas-password-v1')))});
}
export async function verifyPassword(password:string,stored:string,pepper:string){
  const hash=JSON.parse(stored) as {version:number;salt:string;verifier:string};
  if(hash.version!==1)return false;
  const key=await passwordKey(password,hash.salt,pepper);
  return crypto.subtle.verify('HMAC',key,unbase64(hash.verifier),encoder.encode('flight-atlas-password-v1'));
}
export function passwordInput(value:unknown){
  if(typeof value!=='string'||value.length<12||value.length>128)throw new ApiError(422,'密码需为 12–128 个字符');
  return value;
}
export function usernameInput(value:unknown){
  if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}$/.test(value))throw new ApiError(422,'用户名需为 3–32 位字母、数字、下划线或短横线');
  return value.toLowerCase();
}
export async function readJson(request:Request,limit=3_000_000):Promise<Record<string,unknown>>{
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new ApiError(415,'请使用 JSON 请求');
  const reader=request.body?.getReader();if(!reader)throw new ApiError(422,'请求内容为空');
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new ApiError(413,'请求文件过大');}chunks.push(value);}
  const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
  try{const data:unknown=JSON.parse(new TextDecoder().decode(all));if(!data||Array.isArray(data)||typeof data!=='object')throw Error();return data as Record<string,unknown>;}catch{throw new ApiError(422,'JSON 格式无效');}
}
const cookieName=(request:Request)=>new URL(request.url).protocol==='https:'?'__Host-flight_atlas':'flight_atlas';
export function cookie(request:Request,value:string,maxAge=SESSION_SECONDS){return `${cookieName(request)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
export function sessionToken(request:Request){return request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName(request)+'='))?.slice(cookieName(request).length+1)||'';}
export async function currentUser(request:Request,env:Env){
  const raw=sessionToken(request);if(!/^[\w-]{43}$/.test(raw))return null;
  return env.DB.prepare('SELECT u.id,u.username,u.display_name,u.created_at FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?').bind(await digest(raw),Math.floor(Date.now()/1000)).first<User>();
}
export async function requireUser(request:Request,env:Env){const user=await currentUser(request,env);if(!user)throw new ApiError(401,'请先登录');return user;}
async function rateLimit(request:Request,env:Env,kind:string,username:string){
  const now=Math.floor(Date.now()/1000);const ip=request.headers.get('CF-Connecting-IP')||'local';
  for(const scope of [`ip:${ip}`,`username:${username}`]){
    const key=await digest(`${env.AUTH_PEPPER}:${kind}:${scope}`);
    const row=await env.DB.prepare('INSERT INTO auth_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END RETURNING count').bind(key,now+900,now,now,now+900).first<{count:number}>();
    if(row&&row.count>(kind==='register'?8:20))throw new ApiError(429,'操作过于频繁，请 15 分钟后再试');
  }
}
async function newSession(request:Request,env:Env,user:User){
  const raw=token();const now=Math.floor(Date.now()/1000);
  await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now),env.DB.prepare('DELETE FROM auth_limits WHERE expires_at<=?').bind(now),env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await digest(raw),user.id,now+SESSION_SECONDS)]);
  return json({user},200,{'Set-Cookie':cookie(request,raw)});
}
export async function authRoute(request:Request,env:Env,path:string){
  if(path==='/api/auth/me'&&request.method==='GET')return json({user:await currentUser(request,env),mode:'cloud'});
  if(path==='/api/auth/logout'&&request.method==='POST'){
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(sessionToken(request))).run();
    return json({ok:true},200,{'Set-Cookie':cookie(request,'',0)});
  }
  if(path==='/api/auth/register'&&request.method==='POST'){
    const body=await readJson(request,4096);const username=usernameInput(body.username);const password=passwordInput(body.password);
    const display_name=typeof body.display_name==='string'?body.display_name.trim()||username:username;
    if(display_name.length>50)throw new ApiError(422,'昵称最多 50 个字符');
    await rateLimit(request,env,'register',username);
    const user={id:crypto.randomUUID(),username,display_name,created_at:new Date().toISOString()};
    const hash=await hashPassword(password,env.AUTH_PEPPER);
    try{await env.DB.prepare('INSERT INTO users(id,username,display_name,password_hash,created_at) VALUES (?,?,?,?,?)').bind(user.id,username,display_name,hash,user.created_at).run();}catch(error){if(String(error).includes('UNIQUE'))throw new ApiError(409,'用户名已被使用');throw error;}
    return newSession(request,env,user);
  }
  if(path==='/api/auth/login'&&request.method==='POST'){
    const body=await readJson(request,4096);const username=usernameInput(body.username);const password=passwordInput(body.password);
    await rateLimit(request,env,'login',username);
    const row=await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(username).first<Account>();
    const stored=row?.password_hash||JSON.stringify({version:1,salt:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',verifier:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'});
    const valid=await verifyPassword(password,stored,env.AUTH_PEPPER);
    if(!row||!valid)throw new ApiError(401,'用户名或密码不正确');
    const {password_hash:_,...user}=row;
    return newSession(request,env,user);
  }
  if(path==='/api/auth/password'&&request.method==='POST'){
    const user=await requireUser(request,env);const body=await readJson(request,4096);
    const old=passwordInput(body.current_password);const next=passwordInput(body.new_password);
    await rateLimit(request,env,'password',user.username);
    const account=await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(user.id).first<Account>();
    if(!account||!await verifyPassword(old,account.password_hash,env.AUTH_PEPPER))throw new ApiError(401,'当前密码不正确');
    const hash=await hashPassword(next,env.AUTH_PEPPER);
    await env.DB.batch([env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(hash,user.id),env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id)]);
    return json({ok:true},200,{'Set-Cookie':cookie(request,'',0)});
  }
  throw new ApiError(404,'接口不存在');
}
