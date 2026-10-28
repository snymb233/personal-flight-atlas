import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

await mkdir('worker',{recursive:true});
const raw=JSON.parse(await readFile('data/airports.json','utf8'));
// Reuse the local application's existing Chinese airport names without maintaining a second dictionary.
const backend=await readFile('backend.py','utf8');
const aliases=Object.fromEntries([...backend.matchAll(/"([A-Z]{3})": \("([^"]+)", "([^"]+)"\)/g)].map(m=>[m[1],[m[2],m[3]]]));
const airports={};
for(const a of raw){const code=a.iata_code;if(!airports[code]||a.type==='large_airport')airports[code]={code,name:aliases[code]?.[1]||a.name,city:aliases[code]?.[0]||a.municipality||a.name,country:a.iso_country,continent:a.continent,latitude:Number(a.latitude_deg),longitude:Number(a.longitude_deg)};}
await writeFile('worker/airports.json',JSON.stringify(airports));
await writeFile('worker/ocr-airports.json',JSON.stringify({codes:Object.keys(airports),aliases:Object.values(airports).filter(a=>/[\u4e00-\u9fff]/.test(a.name)).map(({code,name,city})=>({code,name,city}))}));
await mkdir('public/ocr',{recursive:true});
await copyFile('node_modules/tesseract.js/dist/worker.min.js','public/ocr/worker.min.js');
for(const name of await readdir('node_modules/tesseract.js-core'))if(/\.wasm(?:\.js)?$/.test(name))await copyFile(join('node_modules/tesseract.js-core',name),join('public/ocr',name));
for(const language of ['eng','chi_sim']){
  const file=`public/ocr/${language}.traineddata.gz`;
  try{await readFile(file);}catch{
    const response=await fetch(`https://cdn.jsdelivr.net/npm/@tesseract.js-data/${language}@1.0.0/4.0.0_best_int/${language}.traineddata.gz`);
    if(!response.ok)throw Error(`Language data download failed: ${language} (${response.status})`);
    await writeFile(file,new Uint8Array(await response.arrayBuffer()));
  }
}
const models=[];for(const language of ['eng','chi_sim']){const bytes=await readFile(`public/ocr/${language}.traineddata.gz`);if(bytes[0]!==31||bytes[1]!==139)throw Error(`Invalid OCR language archive: ${language}`);models.push({language,source:`https://cdn.jsdelivr.net/npm/@tesseract.js-data/${language}@1.0.0/4.0.0_best_int/${language}.traineddata.gz`,sha256:createHash('sha256').update(bytes).digest('hex')});}
await writeFile('audit/ocr-assets.json',JSON.stringify({license:'Apache-2.0',models},null,2)+'\n');
console.log(`Prepared ${Object.keys(airports).length} airports and same-origin browser OCR assets.`);
