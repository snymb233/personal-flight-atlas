import {geoPath,geoMercator} from 'd3-geo';
import {shareSummary,fmt,routeKey,type Flight} from './domain';
import {automaticMapMode,mapProjection,mapRoute,type ChinaMap} from './mapGeometry';

const font='"Microsoft YaHei","PingFang SC",system-ui,sans-serif';
function loadImage(source:string){return new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('图片资源加载失败'));image.src=source;});}
export async function createShareImage(flights:Flight[],year:string,demo:boolean){
  if(!flights.length)throw new Error('添加航班后即可生成分享图');
  const s=shareSummary(flights);const mode=automaticMapMode(flights);
  const [land,china]=await Promise.all([
    fetch('/land.geojson').then(r=>{if(!r.ok)throw Error('全球底图未加载，请重试');return r.json();}),
    fetch('/china-provinces.geojson').then(r=>r.ok?r.json():null).catch(()=>null),
  ]) as [object,ChinaMap|null];
  const flags=await Promise.all(s.countryCodes.map(code=>loadImage(`/flags/${code.toLowerCase()}.svg`).catch(()=>null)));
  const flagColumns=14,flagRows=Math.ceil(flags.length/flagColumns),extra=Math.max(0,flagRows-1)*70;
  const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1620+extra;
  const c=canvas.getContext('2d');if(!c)throw Error('浏览器不支持生成图片');
  const ink='#123c4b',teal='#168c87',muted='#62818c';
  const background=c.createLinearGradient(0,0,1080,canvas.height);background.addColorStop(0,'#f6fbfc');background.addColorStop(1,'#edf5f7');c.fillStyle=background;c.fillRect(0,0,1080,canvas.height);
  c.fillStyle='#6ba9b317';for(let y=20;y<canvas.height;y+=28)for(let x=20;x<1080;x+=28){c.beginPath();c.arc(x,y,1.2,0,Math.PI*2);c.fill();}
  const text=(value:string,x:number,y:number,size:number,color=ink,weight=500,maxWidth=952)=>{while(size>16){c.font=`${weight} ${size}px ${font}`;if(c.measureText(value).width<=maxWidth)break;size--;}c.fillStyle=color;c.fillText(value,x,y);};
  const rule=(y:number)=>{c.strokeStyle='#b7d4dc';c.lineWidth=1;c.beginPath();c.moveTo(64,y);c.lineTo(1016,y);c.stroke();};
  text('PERSONAL FLIGHT ATLAS',64,72,25,teal,700);
  text('我的飞行足迹',64,151,62,ink,800);
  c.textAlign='right';text(year==='all'?'累计飞行档案':`${year} 年度飞行档案`,1016,72,23,muted,500,390);c.textAlign='left';
  text('每一段旅程，都值得被记住。',66,191,25,muted);
  c.save();c.translate(30,224);c.scale(1020/1100,510/550);
  c.beginPath();c.roundRect(0,0,1100,550,22);c.clip();c.fillStyle='#e9f3f7';c.fillRect(0,0,1100,550);
  const projection=mapProjection(mode);const path=geoPath(projection);
  const fill=(d:string|null,color:string,stroke?:string,width=1)=>{if(!d)return;const shape=new Path2D(d);c.fillStyle=color;if(color!=='transparent')c.fill(shape);if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke(shape);}};
  fill(path(land as never),'#a9cbd7');
  const drawChina=(p:ReturnType<typeof mapProjection>)=>{if(!china)return;const draw=geoPath(p);fill(draw(china),'#a3c9d2');fill(draw(china.boundary_layers.provinces),'transparent','#77a9b8',.6);fill(draw(china.boundary_layers.outline),'transparent','#608fa0',1);fill(draw(china.boundary_layers.special),'transparent','#608fa0',1);};
  drawChina(projection);
  const routes=[...new Map(flights.map(f=>[routeKey(f),f])).values()];
  for(const flight of routes){const arc=mapRoute(flight,projection,mode);if(!arc)continue;c.strokeStyle='#155768';c.lineWidth=2.6;c.lineCap='round';c.stroke(new Path2D(arc.path));c.save();c.translate(...arc.arrow);c.rotate(arc.angle*Math.PI/180);c.strokeStyle=teal;c.lineWidth=2;c.beginPath();c.moveTo(-5,-3);c.lineTo(2,0);c.lineTo(-5,3);c.stroke();c.restore();}
  for(const airport of s.airports){const xy=projection([airport.longitude,airport.latitude]);if(!xy)continue;c.beginPath();c.arc(xy[0],xy[1],4.8,0,Math.PI*2);c.fillStyle=ink;c.fill();c.lineWidth=1.6;c.strokeStyle='#fff';c.stroke();}
  if(china&&mode==='china'){
    c.save();c.translate(910,348);c.fillStyle='#edf6f8';c.fillRect(0,0,168,190);c.strokeStyle='#8bb2bf';c.lineWidth=1;c.strokeRect(0,0,168,190);c.beginPath();c.rect(0,0,168,190);c.clip();
    const inset=geoMercator().fitExtent([[8,25],[160,182]],{type:'MultiPoint',coordinates:[[106,2],[125,25]]});
    fill(geoPath(inset)(land as never),'#a9cbd7');drawChina(inset);c.fillStyle=ink;c.font=`14px ${font}`;c.fillText('南海诸岛',10,19);c.restore();
  }
  c.restore();
  c.textAlign='center';text(`${s.coverage.toFixed(1)}% 全球覆盖`,540,801,43,teal,800,930);text(s.coverageText,540,849,30,ink,600,930);
  for(let i=0;i<flags.length;i++){
    const row=Math.floor(i/flagColumns),n=Math.min(flagColumns,flags.length-row*flagColumns);const x=540-(n-1)*34+(i%flagColumns)*68,y=905+row*70;
    c.save();c.beginPath();c.arc(x,y,26,0,Math.PI*2);c.clip();c.fillStyle='#d3e5e9';c.fillRect(x-27,y-27,54,54);if(flags[i])c.drawImage(flags[i]!,x-27,y-27,54,54);else{text(s.countryCodes[i],x,y+7,18,ink,600,48);}c.restore();c.strokeStyle='#fff';c.lineWidth=3;c.beginPath();c.arc(x,y,26,0,Math.PI*2);c.stroke();
  }
  c.textAlign='left';rule(982+extra);
  text(fmt(s.count),64,1115+extra,100,ink,800,620);text('航班',67,1164+extra,30,ink,600);
  text(year==='all'?'全部已记录年份':`${year} 年`,650,1080+extra,27,teal,600,360);
  text(demo?'虚构演示数据':'我的飞行档案',650,1123+extra,25,muted,500,360);
  const total=Math.round(s.minutes||0),days=Math.floor(total/1440),hours=Math.floor(total%1440/60),mins=total%60;
  const time=s.minutes===null?'待补充':days?`${days}天 ${hours}小时 ${mins}分`:hours?`${hours}小时 ${mins}分`:`${mins}分钟`;
  const length=s.distance>=100000?`${(s.distance/10000).toFixed(1).replace(/\.0$/,'')} 万 km`:`${fmt(s.distance)} km`;
  const metric=(value:string,label:string,x:number,y:number)=>{text(value,x,y,56,ink,800,410);text(label,x,y+43,27,ink,600,410);};
  metric(length,'理论飞行距离',64,1290+extra);metric(String(s.airports.length),'机场',600,1290+extra);
  metric(time,'飞行时间',64,1442+extra);metric(s.airlineCount?String(s.airlineCount):'待补充','航空公司',600,1442+extra);
  text(`航班标注时长覆盖 ${s.timedCount}/${s.count} 条 · ${demo?'虚构演示 · ':''}机场间理论航线`,64,1512+extra,20,muted,400,952);
  text(s.coverageFootnote,64,1545+extra,18,muted,400,952);
  text(china?'中国境界：天地图 · 全球海岸线：Natural Earth · 国旗：flag-icons':'全球海岸线：Natural Earth · 国旗：flag-icons',64,1576+extra,17,muted,400,952);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('图片生成失败，请重试')),'image/png'));
  canvas.width=0;canvas.height=0;return blob;
}
