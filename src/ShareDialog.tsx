import {useEffect,useRef,useState} from 'react';
import {Download,Share2,X} from 'lucide-react';
import type {Flight} from './domain';
import './share.css';

export default function ShareDialog({flights,year,demo,onClose}:{flights:Flight[];year:string;demo:boolean;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);const [image,setImage]=useState<{url:string;file:File}|null>(null);const [error,setError]=useState('');
  useEffect(()=>{dialog.current?.showModal();},[]);
  useEffect(()=>{let cancelled=false;let url='';import('./shareImage').then(m=>m.createShareImage(flights,year,demo)).then(blob=>{if(cancelled)return;url=URL.createObjectURL(blob);setImage({url,file:new File([blob],`flight-atlas-${year}${demo?'-demo':''}.png`,{type:'image/png'})});}).catch(e=>{if(!cancelled)setError(e.message||'分享图生成失败');});return()=>{cancelled=true;if(url)URL.revokeObjectURL(url);};},[flights,year,demo]);
  const canShare=!!image&&!!navigator.canShare?.({files:[image.file]});
  return <dialog ref={dialog} className="share-dialog" aria-label="分享飞行足迹" onCancel={onClose}><div className="dialog-head"><div><small>YOUR JOURNEY, SHARED.</small><h2>分享飞行足迹</h2></div><button aria-label="关闭分享" onClick={onClose}><X size={20}/></button></div><p className="small">{year==='all'?'全部年份':year+' 年'} · {flights.length} 次飞行 · {demo?'虚构演示':'当前账号'}<br/>分享图在浏览器内生成，只包含地图和汇总统计。</p>{image?<img className="share-preview" src={image.url} alt="飞行足迹分享图，包含航线图、覆盖率、圆形国旗与飞行统计"/>:!error&&<div className="share-pending" role="status">正在生成分享图…</div>}{error&&<p role="alert" className="error">{error}</p>}<div className="dialog-actions"><button onClick={onClose}>关闭</button>{image&&<a className="button primary" href={image.url} download={image.file.name}><Download size={16}/>保存 PNG 图片</a>}{canShare&&<button onClick={()=>{if(image)navigator.share({files:[image.file],title:'我的飞行足迹'}).catch(e=>{if(e.name!=='AbortError')setError('系统分享未完成，可保存图片后分享。');});}}><Share2 size={16}/>系统分享</button>}</div><p className="small">手机可保存图片后发布到朋友圈或小红书；也可以长按预览图保存。</p></dialog>;
}
