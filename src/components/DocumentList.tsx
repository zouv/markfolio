import { t } from "../i18n";
import { useState, type RefObject } from "react";
import { Search, X, FilePlus2, FileText, ListOrdered, Star, SquareCheck } from "lucide-react";
import { useApp, type Session } from "../store";
import { visibleNotes } from "./NoteManagement";
import { displayError, fileName } from "../types";
import { useRegistry } from "../plugins/runtime";
import { PluginColumnValue } from "./PluginContributions";
import { IconButton } from "./Controls";
import {noteSortFor,noteSortPatch} from "../settings";

export default function DocumentList({ session,query,setQuery,searchRef,run }: {session:Session;query:string;setQuery(q:string):void;searchRef:RefObject<HTMLInputElement>;run(id:string):void}) {
  const state=useApp();const settings=state.settings;const [completed,setCompleted]=useState("all");
  const [menu,setMenu]=useState<{x:number;y:number}>();
  const notes=visibleNotes(session,settings).filter(n=>session.view!=="todo"||completed==="all"||n.metadata.completed===(completed==="yes"));
  const cards=(session.query?session.hits.map(h=>({...h,name:fileName(h.path),metadata:session.catalog?.find(n=>n.path===h.path)?.metadata,size:0})):notes).filter(n=>settings.showCompletedTodos||!n.metadata?.todo||!n.metadata.completed);
  const columns=useRegistry(s=>s.columns).filter(c=>c.workspace===session.info.id);
  const id=session.info.id;const paths=cards.map(n=>n.path);
  const sorting=noteSortFor(settings,id,session.folder,session.view);
  function choose(path:string,event:{ctrlKey:boolean;metaKey:boolean;shiftKey:boolean}) {
    if(event.shiftKey){const a=paths.indexOf(session.selectionAnchor),b=paths.indexOf(path);state.selectFiles(id,a<0?[path]:paths.slice(Math.min(a,b),Math.max(a,b)+1),session.selectionAnchor||path);}
    else if(event.ctrlKey||event.metaKey){state.selectFiles(id,session.selected.includes(path)?session.selected.filter(p=>p!==path):[...session.selected,path],path);return;}
    else state.selectFiles(id,[path]);
    void state.openDocument(id,path).catch(e=>state.setNotice(displayError(e)));
  }
  return <section className={`file-list list-${settings.listStyle}`} style={{width:settings.listWidth,order:settings.layoutOrder.split("-").indexOf("list")*2}}>
    <div className="list-heading"><div><h2>{session.query?t("搜索结果"):session.view==="all"?t("全部笔记"):session.view==="tag"?`#${session.tag}`:session.view==="todo"?t("待办笔记"):session.view==="pinned"?t("置顶笔记"):fileName(session.folder)||t("根目录")}</h2><span>{cards.length} {t("篇文档")}</span></div><IconButton label={t("新建笔记")} onClick={()=>run("file.new")}><FilePlus2 size={17}/></IconButton></div>
    <div className="search-box"><Search size={15}/><input ref={searchRef} aria-label={t("搜索当前工作目录")} title={t("title:标题 tag:标签 -body:排除 OR \"短语\"")} placeholder={t("搜索文档…")} value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label={t("清除搜索")} onClick={()=>setQuery("")}><X size={13}/></button>}</div>
    <div className="sort-bar"><select aria-label={t("文档排序")} value={sorting.sort} onChange={e=>state.updateSettings(noteSortPatch(settings,id,session.folder,session.view,{sort:e.target.value as typeof settings.sort}))}>{[["name",t("名称")],["modified",t("修改时间")],["created",t("创建时间")],["size",t("大小")],["manual",t("手动排序")]].map(([v,l])=><option value={v} key={v}>{l}</option>)}</select><button title={t("反转排序")} onClick={()=>state.updateSettings(noteSortPatch(settings,id,session.folder,session.view,{reverseSort:!sorting.reverseSort}))}><ListOrdered size={14}/></button><button onClick={()=>state.updateSettings({listStyle:settings.listStyle==="cards"?"details":"cards"})}>{settings.listStyle==="cards"?t("详细"):t("摘要")}</button></div>
    {session.view==="todo"&&<select aria-label={t("完成状态")} value={completed} onChange={e=>setCompleted(e.target.value)}><option value="all">{t("全部待办")}</option><option value="no">{t("未完成")}</option><option value="yes">{t("已完成")}</option></select>}
    {session.selected.length>0&&<div className="selection-bar"><span>{t("已选 {0} 项",session.selected.length)}</span>{[["file.duplicate",t("复制")],["file.move",t("移动")],["file.delete",t("删除")]].map(([cmd,label])=><button key={cmd} disabled={session.mutating} onClick={()=>run(cmd)}>{label}</button>)}<button onClick={()=>state.selectFiles(id,[])}>{t("取消选择")}</button></div>}
    {settings.listStyle==="details"&&<div className="detail-head"><span>{t("标题")}</span><span>{t("修改 / 大小")}</span></div>}
    <div className="file-list-scroll" tabIndex={0} role="listbox" aria-label={t("文档列表")} aria-multiselectable="true" onKeyDown={e=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="a"){e.preventDefault();state.selectFiles(id,paths);return;}
      const keys=["ArrowDown","ArrowUp","Home","End"];if(keys.includes(e.key)&&paths.length){e.preventDefault();const i=paths.indexOf(session.selectionAnchor||session.file);const next=e.key==="Home"?0:e.key==="End"?paths.length-1:Math.max(0,Math.min(paths.length-1,i+(e.key==="ArrowDown"?1:-1)));choose(paths[next],e);e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')[next]?.focus();}
      if(e.key==="Enter"&&session.selectionAnchor){e.preventDefault();void state.openDocument(id,session.selectionAnchor);}
    }}>
      {cards.map(entry=><button className={`document-card ${session.selected.includes(entry.path)?"selected":""} ${entry.path===session.file?"current-document":""}`} role="option" aria-selected={session.selected.includes(entry.path)} key={entry.path} draggable={!session.mutating} onDragStart={e=>{e.dataTransfer.setData("application/x-markfolio-entry",JSON.stringify({workspace:id,paths:session.selected.includes(entry.path)?session.selected:[entry.path]}));e.dataTransfer.setData("text/markfolio-order",entry.path);}} onDragOver={e=>{if(sorting.sort==="manual")e.preventDefault();}} onDrop={e=>{if(sorting.sort!=="manual")return;e.preventDefault();const from=e.dataTransfer.getData("text/markfolio-order");if(!paths.includes(from)||from===entry.path)return;const order=paths.filter(p=>p!==from);order.splice(order.indexOf(entry.path),0,from);state.updateSettings({manualOrder:{...settings.manualOrder,[`${id}:${session.view}:${session.tag||session.folder}`]:order}});}} onClick={e=>choose(entry.path,e)} onContextMenu={e=>{e.preventDefault();if(!session.selected.includes(entry.path))state.selectFiles(id,[entry.path]);setMenu({x:Math.min(e.clientX,window.innerWidth-210),y:Math.min(e.clientY,window.innerHeight-240)});}}>
        <div><FileText size={15}/><strong>{entry.title||entry.name.replace(/\.(md|markdown)$/i,"")}</strong>{entry.metadata?.pinned&&<Star size={12}/>} {entry.metadata?.todo&&<SquareCheck size={12}/>} {session.documents[entry.path]?.dirty&&<span className="dirty-dot"/>}</div><p>{entry.snippet||t("空白文档")}</p><span>{entry.modified?new Date(entry.modified).toLocaleDateString(settings.locale):t("刚刚创建")}{settings.listStyle==="details"&&` · ${Math.ceil(entry.size/1024)} KB`}</span>{entry.metadata?.tags.length?<small className="note-tags">{entry.metadata.tags.map(t=>`#${t}`).join(" ")}</small>:null}
      {columns.map(column=>{const note=session.catalog?.find(n=>n.path===entry.path);return note?<PluginColumnValue key={column.key} column={column} note={note}/>:null;})}</button>)}{!cards.length&&<div className="list-empty"><FileText size={28}/><p>{session.query?t("没有匹配的文档"):t("此视图还没有笔记")}</p><button onClick={()=>run("file.new")}>{t("新建第一篇笔记")}</button></div>}
    </div>
    {menu&&<><div className="context-backdrop" onClick={()=>setMenu(undefined)}/><div className="context-menu" style={{left:menu.x,top:menu.y}} role="menu">{[["file.duplicate",t("复制笔记")],["file.move",t("移动到…")],["file.delete",t("移入回收站")],["files.selectAll",t("全选文件")],["file.properties",t("文档属性")],["file.copyLink",t("复制笔记链接")]].map(([cmd,label])=><button role="menuitem" key={cmd} onClick={()=>{setMenu(undefined);run(cmd);}}>{label}</button>)}</div></>}
  </section>;
}
