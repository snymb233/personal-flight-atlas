import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';

const config=JSON.parse(await readFile('cloudflare-deploy.json','utf8'));
const credential=process.env.CLOUDFLARE_API_TOKEN;
if(!credential)throw Error('Set CLOUDFLARE_API_TOKEN with Pages Edit and D1 permissions.');
const endpoint=`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/pages/projects/${config.project}`;
const headers={Authorization:`Bearer ${credential}`,'Content-Type':'application/json'};
const schema=await readFile('migrations/0001_accounts.sql','utf8');
const database=`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/query`;
// Execute separately: this account's REST query endpoint executes only the first statement of a SQL string.
for(const statement of schema.split(';').map(sql=>sql.trim()).filter(Boolean)){
  const response=await fetch(database,{method:'POST',headers,body:JSON.stringify({sql:statement})});
  const result=await response.json();if(!response.ok||!result.success||result.result.some(row=>!row.success))throw Error(`Database schema initialization failed (${response.status})`);
}
const check=await fetch(database,{method:'POST',headers,body:JSON.stringify({sql:"SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('users','sessions','flights','flight_sources','auth_limits')"})});
const checked=await check.json();if(checked.result?.[0]?.results?.[0]?.count!==5)throw Error('Database schema verification failed; deployment stopped.');
const current=await fetch(endpoint,{headers});const snapshot=await current.json();
if(!current.ok||!snapshot.success)throw Error(`Cannot read target Pages project (${current.status})`);
const production={d1_databases:{DB:{id:config.databaseId}},compatibility_date:'2026-10-28',compatibility_flags:[],fail_open:false};
// Never replace an existing password pepper: redeploys must not invalidate users' passwords.
if(!snapshot.result.deployment_configs?.production?.env_vars?.AUTH_PEPPER){
  await mkdir('output',{recursive:true});
  let pepper;try{pepper=JSON.parse(await readFile('output/cloudflare-secrets.json','utf8')).AUTH_PEPPER;}catch{pepper=randomBytes(32).toString('base64url');await writeFile('output/cloudflare-secrets.json',JSON.stringify({AUTH_PEPPER:pepper}),{mode:0o600});}
  if(typeof pepper!=='string'||pepper.length<32)throw Error('Invalid local auth secret.');
  production.env_vars={AUTH_PEPPER:{type:'secret_text',value:pepper}};
}
const response=await fetch(endpoint,{method:'PATCH',headers,body:JSON.stringify({deployment_configs:{production,preview:{compatibility_date:'2026-10-28',fail_open:false}}})});
const result=await response.json();if(!response.ok||!result.success)throw Error(`Pages configuration failed (${response.status}): ${result.errors?.map(e=>e.code).join(',')}`);
console.log(JSON.stringify({project:result.result.name,url:`https://${result.result.subdomain}`,databaseBound:!!result.result.deployment_configs.production.d1_databases?.DB,secretConfigured:!!result.result.deployment_configs.production.env_vars?.AUTH_PEPPER}));
