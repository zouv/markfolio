import "../polyfills";
import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorker from "../pdf-worker.ts?worker&url";
import { readAsset, listAssets, listTrash, manageTrash, deleteEntry, writeAsset } from "../api";
import { useApp } from "../store";
import { displayError, fileName, parentPath, relativeLink, type AssetEntry, type TrashEntry } from "../types";
import { editorActions } from "../Editor";
import { fileAsBase64 } from "../conversion";

GlobalWorkerOptions.workerSrc = pdfWorker;
export function PdfViewer({url}:{url:string}) {
  const canvas=useRef<HTMLCanvasElement>(null);const [pdf,setPdf]=useState<PDFDocumentProxy>();const [page,setPage]=useState(1);const [zoom,setZoom]=useState(1.2);const [error,setError]=useState("");const rendering=useRef<Promise<void>>(Promise.resolve());
  useEffect(()=>{setPdf(undefined);setPage(1);setError("");let disposed=false;let loading:ReturnType<typeof getDocument>|undefined;
    try{const data=Uint8Array.from(atob(url.split(",")[1]),c=>c.charCodeAt(0));loading=getDocument({data,enableXfa:false,useSystemFonts:true,cMapUrl:"/pdf/cmaps/",cMapPacked:true,standardFontDataUrl:"/pdf/standard_fonts/",wasmUrl:"/pdf/wasm/"});void loading.promise.then(doc=>{if(!disposed)setPdf(doc);}).catch(e=>{if(!disposed)setError(displayError(e));});}catch(e){setError(displayError(e));}
    return()=>{disposed=true;void loading?.destroy().catch(()=>{});};},[url]);
  useEffect(()=>{if(!pdf||!canvas.current)return;const node=canvas.current;let cancelled=false;let renderTask:ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>|undefined;
    rendering.current=rendering.current.catch(()=>{}).then(async()=>{if(cancelled)return;const p=await pdf.getPage(page);if(cancelled)return;const viewport=p.getViewport({scale:zoom});node.width=viewport.width;node.height=viewport.height;renderTask=p.render({canvas:node,viewport});await renderTask.promise;}).catch(e=>{if(!cancelled)setError(displayError(e));});
    return()=>{cancelled=true;renderTask?.cancel();};},[pdf,page,zoom,url]);
  return <div className="pdf-reader"><div className="inline-options"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>{t("上一页")}</button><span>{page} / {pdf?.numPages??"…"}</span><button disabled={!pdf||page>=pdf.numPages} onClick={()=>setPage(p=>p+1)}>{t("下一页")}</button><input aria-label={t("PDF 缩放")} type="range" min="0.5" max="3" step="0.1" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></div>{error&&<p className="form-error">{error}</p>}<div className="pdf-pages"><canvas ref={canvas}/></div></div>;
}
export function MediaViewer({workspace,path}:{workspace:string;path:string}) {
  const [url,setUrl]=useState("");const [error,setError]=useState("");const [zoom,setZoom]=useState(100);const [width,setWidth]=useState(1200);const image=useRef<HTMLImageElement>(null);
  useEffect(()=>{let cancelled=false;setUrl("");setError("");setZoom(100);void readAsset(workspace,path).then(url=>{if(!cancelled)setUrl(url);}).catch(e=>{if(!cancelled)setError(displayError(e));});return()=>{cancelled=true;};},[workspace,path]);
  async function resize(){try{const node=image.current;if(!node?.naturalWidth)return;const canvas=document.createElement("canvas");canvas.width=Math.min(width,node.naturalWidth);canvas.height=Math.round(node.naturalHeight*canvas.width/node.naturalWidth);canvas.getContext("2d")?.drawImage(node,0,0,canvas.width,canvas.height);const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error(t("图片转换失败"))),"image/png"));const asset=await writeAsset(workspace,parentPath(path),`${fileName(path).replace(/\.[^.]+$/,"")}-${canvas.width}.png`,await fileAsBase64(blob));useApp.getState().setNotice(t("缩放图片已保存：{0}", asset));await useApp.getState().refresh(workspace);}catch(e){setError(displayError(e));}}
  if(error)return <p className="form-error">{error}</p>;if(!url)return <p>{t("正在读取附件…")}</p>;
  if(/\.pdf$/i.test(path))return <PdfViewer url={url}/>;
  if(/\.(mp3|wav|ogg|m4a)$/i.test(path))return <audio controls src={url}/>;
  if(/\.(mp4|webm)$/i.test(path))return <video controls src={url} style={{maxWidth:"100%"}}/>;
  return <><div className="inline-options"><label>{t("缩放")}<input aria-label={t("图片缩放")} type="range" min="10" max="300" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label><span>{zoom}%</span><label>{t("另存宽度")}<input type="number" min="16" max="8192" value={width} onChange={e=>setWidth(Number(e.target.value))}/></label><button className="secondary" onClick={()=>void resize()}>{t("保存缩放副本")}</button></div><div className="image-reader"><img ref={image} src={url} alt={fileName(path)} style={{width:`${zoom}%`,maxWidth:"none"}}/></div></>;
}
export function AttachmentManager({workspace}:{workspace:string}) {
  const [assets,setAssets]=useState<AssetEntry[]>([]);const [current,setCurrent]=useState("");const [error,setError]=useState("");const [unused,setUnused]=useState(false);
  useEffect(()=>{void listAssets(workspace).then(setAssets).catch(e=>setError(displayError(e)));},[workspace]);
  function insert(path:string){const file=useApp.getState().sessions[workspace]?.file;if(!file)return;editorActions.insert(workspace,`${/\.(png|jpe?g|gif|svg|webp)$/i.test(path)?"!":""}[${fileName(path)}](${relativeLink(file,path)})`);useApp.getState().setNotice(t("附件链接已插入"));}
  return <><h2>{t("附件管理")}</h2><label><input type="checkbox" checked={unused} onChange={e=>setUnused(e.target.checked)}/>{t("只显示未被引用的附件")}</label><div className="attachment-layout"><div className="attachment-list">{assets.filter(a=>!unused||!a.references.length).map(asset=><div className={asset.path===current?"selected":""} key={asset.path}><button onClick={()=>setCurrent(asset.path)}>{asset.path}<small>{Math.ceil(asset.size/1024)} KB · {asset.references.length} {t("篇引用")}</small></button><button onClick={()=>insert(asset.path)}>{t("插入链接")}</button><details><summary>{t("引用 / 删除")}</summary>{asset.references.map(p=><button key={p} onClick={()=>void useApp.getState().openDocument(workspace,p)}>{p}</button>)}<button onClick={()=>{if(window.confirm(t("将 {0} 移入回收站？", asset.path)))void deleteEntry(workspace,asset.path).then(()=>listAssets(workspace)).then(setAssets).catch(e=>setError(displayError(e)));}}>{t("移入回收站")}</button></details></div>)}</div><div className="attachment-preview">{current&&<MediaViewer workspace={workspace} path={current}/>}</div></div>{error&&<p className="form-error">{error}</p>}</>;
}
export function TrashManager({workspace}:{workspace:string}) {
  const [entries,setEntries]=useState<TrashEntry[]>([]);const [error,setError]=useState("");
  const load=()=>listTrash(workspace).then(setEntries);useEffect(()=>{void load().catch(e=>setError(displayError(e)));},[workspace]);
  async function act(entry:TrashEntry,action:"restore"|"purge"){try{if(action==="purge"&&!window.confirm(t("将 {0} 从应用垃圾箱移入系统回收站？", entry.path)))return;await manageTrash(workspace,entry.id,action);await load();await useApp.getState().refresh(workspace);void useApp.getState().reindex(workspace);}catch(e){setError(displayError(e));}}
  return <><h2>{t("垃圾箱")}</h2><p className="muted">{t("保留已删除的文件，恢复时不会覆盖同名文件。")}</p>{entries.map(entry=><div className="setting-row" key={entry.id}><div><strong>{entry.path}</strong><p>{new Date(entry.deleted).toLocaleString()}</p></div><button onClick={()=>void act(entry,"restore")}>{t("恢复")}</button><button onClick={()=>void act(entry,"purge")}>{t("移入系统回收站")}</button></div>)}{!entries.length&&<p>{t("垃圾箱为空")}</p>}{error&&<p className="form-error">{error}</p>}</>;
}
