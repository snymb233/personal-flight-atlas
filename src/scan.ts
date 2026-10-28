import dictionary from '../worker/ocr-airports.json' with {type:'json'};
type Candidate={date:string;origin:string;destination:string;flight_number:string;marked_duration_minutes:number|null;source:string;verification:string;notes:string;raw_ocr_text:string};
const codes=new Set(dictionary.codes);
const aliases=dictionary.aliases;
export function scanCandidates(text:string,filename='图片'):Candidate[]{
  text=text.normalize('NFKC').replace(/[–—−]/g,'-');
  const datePattern=/((?:19|20)\d{2})[年.\/一-](\d{1,2})[月.\/-](\d{1,2})日?/g;
  const dates=[...text.matchAll(datePattern)];
  const flightPattern=/(?<![A-Z0-9])([A-Z][A-Z0-9]|[0-9][A-Z])\s?(\d{3,4})[A-Z]?(?![A-Z0-9])/g;
  const headers=[...text.toUpperCase().matchAll(flightPattern)];
  const anchors=headers.length>1&&(!dates.length||headers[0].index<dates[0].index)?headers:dates.length>1?dates:headers.length>1?headers:[];
  const chunks=anchors.length>1?anchors.map((match,index)=>text.slice(match.index,anchors[index+1]?.index??text.length)):[text];
  return chunks.slice(0,100).map(rawChunk=>{
    const chunk=rawChunk.replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g,'$1');
    const date=[...chunk.matchAll(datePattern)][0];
    const matches=[...chunk.toUpperCase().matchAll(/(?<![A-Z])([A-Z]{3})(?![A-Z])/g)].filter(m=>codes.has(m[1]));
    const route=[...new Set(matches.map(m=>m[1]))];
    if(route.length<2){const named=aliases.map(a=>({code:a.code,index:chunk.indexOf(a.name.replace(/机场$/,''))})).filter(a=>a.index>=0).sort((a,b)=>a.index-b.index);for(const {code} of named)if(!route.includes(code))route.push(code);}
    if(route.length<2){
      const cityMatches=new Map<string,string[]>();
      for(const a of aliases)if(chunk.includes(a.city)){const list=cityMatches.get(a.city)||[];list.push(a.code);cityMatches.set(a.city,list);}
      for(const [,list] of [...cityMatches].sort((a,b)=>chunk.indexOf(a[0])-chunk.indexOf(b[0])))if(list.length===1&&!route.includes(list[0]))route.push(list[0]);
    }
    const flight=[...chunk.toUpperCase().matchAll(flightPattern)][0];
    const hours=chunk.match(/(?:飞行时长|飞行时间|时长|DURATION)\s*[:：]?\s*(\d+)\s*(?:小时|H)\s*(\d+)?\s*(?:分钟|分|M)?/i);
    const mins=chunk.match(/(?:飞行时长|飞行时间|时长|DURATION)\s*[:：]?\s*(\d+)\s*(?:分钟|分|MIN)/i);
    return {date:date?`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`:'',origin:route[0]||'',destination:route[1]||'',flight_number:flight?(flight[1]==='H0'?'HO':flight[1])+flight[2]:'',marked_duration_minutes:hours?Number(hours[1])*60+Number(hours[2]||0):mins?Number(mins[1]):null,source:`图片识别：${filename}`.slice(0,200),verification:'pending',notes:'浏览器识别候选，请对照原图核对。',raw_ocr_text:rawChunk.slice(0,80_000)};
  });
}
export async function recognizeInBrowser(file:File,onProgress:(message:string)=>void){
  if(file.size>8_000_000)throw new Error('图片不能超过 8 MB');
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('请选择 JPG、PNG 或 WebP 图片');
  const image=await createImageBitmap(file);
  if(image.width*image.height>40_000_000){image.close();throw new Error('图片像素过大，请先缩小后重试');}
  const scale=Math.min(1,2600/Math.max(image.width,image.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
  canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);image.close();
  onProgress('正在加载浏览器识别资源，首次使用需要稍候…');
  const {createWorker}=await import('tesseract.js');
  const worker=await createWorker('chi_sim+eng',1,{workerPath:'/ocr/worker.min.js',corePath:'/ocr',langPath:'/ocr',workerBlobURL:false,logger:message=>{if(message.status==='recognizing text')onProgress(`正在识别文字 ${Math.round(message.progress*100)}%`);}});
  try{const {data}=await worker.recognize(canvas);return {text:data.text,flights:scanCandidates(data.text,file.name)};}finally{await worker.terminate();canvas.width=0;canvas.height=0;}
}
