import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Printer } from 'lucide-react';
import FlightMap from './FlightMap';
import { annualSummary, duration, fmt, routeKey, routeLabel, airportLabel, type Flight } from './domain';
import reportStyles from './report.css?inline';
import './report.css';

export default function AnnualReport({all,year,demo,onRoute}:{all:Flight[];year:string;demo:boolean;onRoute:(key:string)=>void}) {
  const report=useRef<HTMLElement>(null);
  const [exportError,setExportError]=useState('');
  const s=annualSummary(all,year);
  useEffect(()=>{const previous=document.title;document.title=`${year} 年飞行报告${demo?' · 虚构演示':''} · Personal Flight Atlas`;return()=>{document.title=previous;};},[year,demo]);
  const date=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
  const ready=()=>{const ok=!!report.current?.querySelector('.flight-map[data-map-ready="true"]');setExportError(ok?'':'底图正在加载或加载失败，请待地图显示完整后导出。');return ok;};
  const download=()=>{
    if(!report.current||!ready())return;
    const copy=report.current.cloneNode(true) as HTMLElement;
    // Preserve SVG paints/fonts offline, including local gradient references.
    const original=report.current.querySelectorAll('svg'),clones=copy.querySelectorAll('svg');
    original.forEach((svg,i)=>{
      const nodes=[svg,...svg.querySelectorAll('*')],targets=[clones[i],...clones[i].querySelectorAll('*')];
      nodes.forEach((node,j)=>{
        const style=getComputedStyle(node);
        for(const key of ['fill','stroke','stroke-width','stroke-dasharray','stroke-linecap','stroke-linejoin','opacity','fill-opacity','stroke-opacity','font-size','font-family','font-weight','text-anchor','paint-order','vector-effect'])
          (targets[j] as SVGElement).style.setProperty(key,style.getPropertyValue(key).replace(/url\(["']?[^)]*#([^"')]+)["']?\)/g,'url(#$1)'));
      });
    });
    copy.querySelectorAll('button').forEach(node=>node.remove());
    copy.querySelectorAll('[role="button"]').forEach(node=>{node.removeAttribute('role');node.removeAttribute('tabindex');});
    const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${year} 年飞行报告${demo?' · 虚构演示':''}</title><style>${reportStyles}</style><body class="saved-report">${copy.outerHTML}</body></html>`;
    const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=`flight-atlas-${year}${demo?'-demo':''}.html`;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const rank=(title:string,items:[string,number][],format=(key:string)=>key)=><section className="report-ranking"><h3>{title}</h3>{items.length?<ol>{items.slice(0,5).map(([name,count])=><li key={name}><span>{format(name)}</span><b>{count} 次</b></li>)}</ol>:<p>待补充记录</p>}</section>;
  return <><div className="report-actions"><span>按已保存的航班生成 · {demo?'虚构演示数据':'个人记录'}</span><button onClick={download} disabled={!s.count}><ArrowDownToLine size={16}/>下载离线报告</button><button onClick={()=>{if(ready())window.print();}} disabled={!s.count}><Printer size={16}/>打印／保存 PDF</button></div>{exportError&&<p role="alert" className="error">{exportError}</p>}
    <article className="annual-report" ref={report} data-year={year}>
      <header className="report-cover"><div><span className="report-kicker">PERSONAL FLIGHT ATLAS · ANNUAL REPORT</span><h2>{year}<small>我的年度飞行报告</small></h2><p>{s.count?`${s.firstDate} — ${s.lastDate} · 每一段旅程，都留下足迹。`:'这一年还没有航班记录。'}</p></div><div className="report-seal">{s.count}<small>次飞行</small></div></header>
      {demo&&<p className="report-demo">虚构演示报告 · 不代表个人真实行程</p>}
      <div className="report-metrics">{[[fmt(s.distance),'理论里程 / km'],[duration(s.minutes),'航班标注时长'],[String(s.routes),'有向航线'],[`${s.cities} / ${s.airports.length}`,'城市 / 机场']].map(([n,label])=><section key={label}><strong>{n}</strong><span>{label}</span></section>)}</div>
      <section className="report-section report-map"><h3>这一年的飞行足迹</h3><FlightMap key={year} flights={s.flights} onRoute={onRoute}/></section>
      <div className="report-highlights"><section><h3>飞行节奏</h3><p>{s.peakMonths.length?`${s.peakMonths.map(m=>m+'月').join('、')}最忙，每月 ${s.peakCount} 次飞行。`:'待记录飞行。'}</p><p>{s.yoy===null?'上一年没有记录，不计算同比。':`飞行次数较 ${Number(year)-1} 年${s.yoy>=0?'增加':'减少'} ${Math.abs(s.yoy)}%。`}</p><p>共在 {s.days} 天出行，到访 {s.countries} 个国家或地区。</p></section><section><h3>新抵达的机场</h3><p className="report-airports">{s.newAirports.length?s.newAirports.map(a=><span key={a.code}>{a.city} <b>{a.code}</b></span>):'本年没有记录中新出现的机场。'}</p><small>相对更早年份的已保存记录，新增 {s.newAirports.length} 座机场。</small></section></div>
      <section className="report-section"><h3>十二个月的旅程</h3><div className="report-months" role="img" aria-label={s.monthly.map((n,i)=>`${i+1}月 ${n} 次`).join('，')}>{s.monthly.map((n,i)=><div key={i}><b>{n||'—'}</b><div><i style={{height:`${n/Math.max(1,s.peakCount)*100}%`}}/></div><small>{i+1}月</small></div>)}</div></section>
      <div className="report-ranks">{rank('最常飞的航线',s.topRoutes,key=>{const f=s.flights.find(f=>routeKey(f)===key);return f?routeLabel(f):key;})}{rank('常用航空公司',s.airlines)}{rank('最常出发机场',s.topAirports,key=>{const a=s.airports.find(a=>a.code===key);return a?airportLabel(a,true):key;})}{rank('乘坐机型',s.aircraft)}</div>
      <div className="report-extremes">{[['最长一段',s.longest],['最短一段',s.shortest]].map(([title,flight])=>{const f=flight as Flight|null;return <section key={title as string}><h3>{title as string}</h3><b>{f?routeLabel(f):'待记录'}</b><p>{f?`${f.date} · ${f.flight_number||'航班号待补充'} · ${fmt(f.theoretical_distance_km)} km`:'—'}</p></section>})}</div>
      <section className="report-section report-records"><h3>年度航班清单 <small>{s.count} 条</small></h3><div className="report-table-wrap"><table><thead><tr><th>日期</th><th>航班</th><th>航线</th><th>理论 km</th><th>标注时长</th><th>机型</th></tr></thead><tbody>{s.flights.map(f=><tr key={f.id}><td>{f.date}</td><td>{f.flight_number||'待补充'}</td><td>{routeLabel(f)}</td><td>{fmt(f.theoretical_distance_km)}</td><td>{duration(f.flight_duration_minutes)}</td><td>{f.aircraft||'待补充'}</td></tr>)}</tbody></table></div></section>
      <footer className="report-footnote"><b>记录范围与统计口径</b><p>依据已保存记录，截至 {date} 生成。标注时长覆盖 {s.timedCount}/{s.count} 条；机型覆盖 {s.aircraftCoverage}/{s.count} 条；待核验 {s.pendingCount} 条。缺失信息不填为 0，不推测机型。{Number(year)===new Date().getFullYear()?'当前年份报告会随后续录入更新。':''}</p><p>里程为起降机场间理论大圆距离；弧线为方向示意。往返为两条有向航线，到访按起降机场统计；“新增机场”仅相对个人已保存历史。中国境界来自用户提供的天地图官方导出，全球海岸线来自 Natural Earth。</p><span>PERSONAL FLIGHT ATLAS · {year}{demo?' · 虚构演示':''}</span></footer>
    </article></>;
}
