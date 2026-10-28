import { useEffect, useMemo, useRef, useState } from 'react';
import { geoMercator, geoPath, geoGraticule10 } from 'd3-geo';
import { LocateFixed, Minus, Plus, RotateCcw } from 'lucide-react';
import { routeKey, routeLabel, type Flight } from './domain';
import {automaticMapMode,mapProjection,mapRoute,type ChinaMap,type MapMode} from './mapGeometry';

export default function FlightMap({flights,onRoute,large=false}: {flights:Flight[];onRoute:(key:string)=>void;large?:boolean}) {
  const [land,setLand]=useState<object|null>(null);
  const [china,setChina]=useState<ChinaMap|null>(null);
  const [error,setError]=useState('');
  const [view,setView]=useState({x:0,y:0,k:1});
  const [hover,setHover]=useState('');
  const svg=useRef<SVGSVGElement>(null);
  const [width,setWidth]=useState(1000);
  const drag=useRef<{x:number;y:number}|null>(null);
  const [fit,setFit]=useState(false);
  const [choice,setChoice]=useState<MapMode|'auto'>('auto');
  const mode=choice==='auto'?automaticMapMode(flights):choice;
  const changeMode=(next:MapMode|'auto')=>{setChoice(next);setFit(false);setView({x:0,y:0,k:1});};
  useEffect(()=>{setView({x:0,y:0,k:1});},[mode]);
  useEffect(()=>{fetch('/land.geojson').then(r=>{if(!r.ok)throw new Error('离线底图加载失败');return r.json();}).then(setLand).catch(e=>setError(e.message));},[]);
  useEffect(()=>{fetch('/china-provinces.geojson').then(r=>{if(!r.ok)throw new Error('中国境界未导入 · 请按 README 从天地图官方入口导入');return r.json();}).then(setChina).catch(e=>setError(e.message));},[]);
  useEffect(()=>{const observer=new ResizeObserver(entries=>setWidth(entries[0].contentRect.width));if(svg.current)observer.observe(svg.current);return()=>observer.disconnect();},[]);
  const labelScale=Math.max(1,1100/width);
  const airports=[...new Map(flights.flatMap(f=>[f.origin_airport,f.destination_airport]).map(a=>[a.code,a])).values()];
  const projection=useMemo(()=>mapProjection(mode,flights,fit),[mode,fit,flights]);
  const path=geoPath(projection);
  const insetProjection=useMemo(()=>geoMercator().fitExtent([[8,26],[137,172]],{type:'MultiPoint',coordinates:[[106,2],[125,25]]}),[]);
  // Map geometry stays cached while dragging; only the view transform and labels change.
  const shapes=useMemo(()=>[projection,insetProjection].map(p=>{
    const draw=geoPath(p);
    return {land:land?draw(land as never)||'':'',fill:china?draw(china)||'':'',outline:china?draw(china.boundary_layers.outline)||'':'',provinces:china?draw(china.boundary_layers.provinces)||'':'',special:china?draw(china.boundary_layers.special)||'':''};
  }),[projection,insetProjection,land,china]);
  const routes=[...new Map(flights.map(f=>[routeKey(f),f])).values()];
  const frequencies=new Map<string,number>();for(const flight of flights)frequencies.set(routeKey(flight),(frequencies.get(routeKey(flight))||0)+1);
  const unit=labelScale/view.k;
  const nodes=airports.flatMap(a=>{const xy=projection([a.longitude,a.latitude]);return xy?[{a,xy}]:[];});
  const occupied=nodes.map(({xy:[x,y]})=>({left:x-5*unit,right:x+5*unit,top:y-5*unit,bottom:y+5*unit}));
  // ponytail: greedy label placement for personal airport counts; use spatial indexing only at larger scale.
  const labeled=nodes.map(node=>{
    const text=`${node.a.city} ${node.a.code}`;
    const textWidth=Array.from(text).reduce((n,c)=>n+(c.charCodeAt(0)>255?11:6.5),0)*unit;
    for(const dy of [-10,15,-26,31,-42,47,-58,63,-74,79])for(const side of [1,-1]){
      const x=10*side*unit,y=dy*unit;
      const left=node.xy[0]+x-(side<0?textWidth:0);
      const box={left:left-2*unit,right:left+textWidth+2*unit,top:node.xy[1]+y-11*unit,bottom:node.xy[1]+y+3*unit};
      if(occupied.every(b=>box.right<b.left||box.left>b.right||box.bottom<b.top||box.top>b.bottom)){
        occupied.push(box);return {...node,text,label:{x,y,side}};
      }
    }
    return {...node,text,label:null};
  });
  const zoom=(factor:number)=>setView(v=>{const k=Math.max(.5,Math.min(8,v.k*factor));return {x:550-(550-v.x)*k/v.k,y:270-(270-v.y)*k/v.k,k};});
  return <div className={`flight-map ${large?'map-large':''}`} data-map-mode={mode} data-map-ready={!!land}>
    <svg ref={svg} viewBox="0 0 1100 550" role="img" aria-label={`${mode==='world'?'全球':'中国及周边'}离线航线地图，可拖动和缩放`}
      onPointerDown={e=>{drag.current={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{
        if(!drag.current)return;
        const ratio=1100/(svg.current?.getBoundingClientRect().width||1100);
        const dx=(e.clientX-drag.current.x)*ratio,dy=(e.clientY-drag.current.y)*ratio;
        setView(v=>({...v,x:v.x+dx,y:v.y+dy}));
        drag.current={x:e.clientX,y:e.clientY};
      }}
      onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
      <defs><filter id="route-glow"><feGaussianBlur stdDeviation="2.2"/></filter><radialGradient id="map-ocean"><stop stopColor="#102f47"/><stop offset="1" stopColor="#061526"/></radialGradient><linearGradient id="map-land" x1="0" y1="0" x2="0.8" y2="1"><stop stopColor="#19394b"/><stop offset="1" stopColor="#0e293d"/></linearGradient></defs>
      <rect width="1100" height="550" fill="url(#map-ocean)"/>
      <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
        <path d={path(geoGraticule10())||''} className="graticule"/>
        {land&&<path d={shapes[0].land} className="land"/>}
        {china&&<g className="official-china-layer" data-province-count={china.features.length} data-special-line-features={china.boundary_layers.special.features.length}>
          <path d={shapes[0].fill} className="china-fill"/>
          <path d={shapes[0].provinces} className="province-borders"/>
          <path d={shapes[0].outline} className="country-outline"/>
          <path d={shapes[0].special} className="official-boundary-lines"/>
        </g>}
        {routes.map(f=>{const key=routeKey(f);const n=frequencies.get(key)!;
          const arc=mapRoute(f,projection,mode);if(!arc)return null;const d=arc.path;
          return <g key={key} className={`route-group ${hover===key?'is-active':''}`} onPointerDown={e=>e.stopPropagation()}><path d={d} className="route-glow" filter="url(#route-glow)" strokeWidth={(3+Math.log2(n+1))/view.k}/>
            <path d={d} className="route" style={{strokeWidth:(1.5+Math.log2(n+1))/view.k}}/>
            <path className="route-arrow" d="M-5,-3.5 L3,0 L-5,3.5" transform={`translate(${arc.arrow[0]},${arc.arrow[1]}) rotate(${arc.angle}) scale(${labelScale/view.k})`} aria-hidden="true"/>
            <path d={d} className="route-hit" strokeWidth={16/view.k} tabIndex={0} role="button" aria-label={`${routeLabel(f)}，${n} 次飞行，查看记录`}
              onMouseEnter={()=>setHover(key)} onMouseLeave={()=>setHover('')} onFocus={()=>setHover(key)} onBlur={()=>setHover('')}
              onClick={()=>onRoute(key)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onRoute(key);}}}><title>{routeLabel(f)} · {n} 次飞行 · 理论航线</title></path>
          </g>;})}
        {labeled.map(({a,xy,text,label})=><g key={a.code} transform={`translate(${xy[0]},${xy[1]})`}>
          <circle r={9*labelScale/view.k} className="airport-halo"/><circle r={3*labelScale/view.k} className="airport-dot"><title>{a.code} · {a.name}</title></circle>
          {label&&<><line x1={0} y1={0} x2={label.x} y2={label.y-4*unit} stroke="#8bbdc0" strokeOpacity=".4" strokeWidth={unit*.6}/><text x={label.x} y={label.y} textAnchor={label.side<0?'end':'start'} style={{fontSize:11*unit}}>{text}</text></>}
        </g>)}
      </g>
    </svg>
    {china&&mode==='china'&&<div className="south-china-inset"><svg viewBox="0 0 145 180" role="img" aria-label="南海诸岛官方境界小图">
      <rect width="145" height="180" fill="#071b2b"/>
      <path d={shapes[1].land} className="land"/>
      <path d={shapes[1].fill} className="china-fill"/>
      <path d={shapes[1].outline} className="country-outline"/>
      <path d={shapes[1].special} className="official-boundary-lines"/>
      <rect width="145" height="23" fill="#0b2335"/><text x="12" y="16">南海诸岛</text>
    </svg></div>}
    <div className="map-caption"><span className="live-dot"/>{mode==='world'?'全球足迹':'中国及周边'} <span>{mode==='world'?'AROUND THE WORLD':'CHINA & BEYOND'}</span></div>
    <div className="map-view-switch" role="group" aria-label="地图范围"><button className={mode==='china'?'selected':''} aria-pressed={mode==='china'} aria-label="切换到中国地图" onClick={()=>changeMode('china')}>中国</button><button className={mode==='world'?'selected':''} aria-pressed={mode==='world'} aria-label="切换到世界地图" onClick={()=>changeMode('world')}>世界</button></div>
    {china&&<div className="map-boundary-legend"><i/>国界/轮廓 <b/>省界</div>}
    <div className="map-tools"><button title="放大地图" aria-label="放大地图" onClick={()=>zoom(1.3)}><Plus size={16}/></button><button title="缩小地图" aria-label="缩小地图" onClick={()=>zoom(1/1.3)}><Minus size={16}/></button><button title="适配所有航线" aria-label="适配所有航线" onClick={()=>{setFit(true);setView({x:0,y:0,k:1});}}><LocateFixed size={16}/></button><button title="重置地图" aria-label="重置地图" onClick={()=>changeMode('auto')}><RotateCcw size={16}/></button></div>
    {!flights.length&&<div className="map-empty"><span>你的下一次起飞，<br/>将点亮这里。</span><small>添加航班，开启属于你的飞行地图</small></div>}
    <div className="map-legend"><i/>理论航线 <span>示意弧线 · 箭头表示飞行方向</span></div>
    <div className="map-credit">{error||(china?'中国境界：天地图 · 全球海岸线：Natural Earth':'官方境界加载中…')}</div>
    {hover&&<div className="map-tooltip">{routes.find(f=>routeKey(f)===hover)?routeLabel(routes.find(f=>routeKey(f)===hover)!):hover} · {frequencies.get(hover)} 次飞行</div>}
  </div>;
}
