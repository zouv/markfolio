import { t } from "../i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { Tags, Star, Files, SquareCheck, Search, X, Folder, Tag } from "lucide-react";
import { useApp, type Session } from "../store";
import { fileName, parentPath, relativeLink, displayError, type Settings, type NoteSummary } from "../types";
import { readMetadata, updateMetadata, metadataPatch, stringList } from "../metadata";
import { editorActions } from "../Editor";
import { headingSlug } from "../markdown";
import { documentStatistics } from "../noteTools";
import { noteSortFor } from "../settings";
import { coreCommands } from "../commands";
import { effectiveShortcut } from "../shortcuts";

export function visibleNotes(session: Session, settings: Settings): NoteSummary[] {
  const catalog = session.catalog?.length ? session.catalog : (session.tree[session.folder] ?? []).filter(e => !e.isDirectory && /\.(md|markdown|txt|mflock)$/i.test(e.path)).map(e => ({ ...e, title: fileName(e.path).replace(/\.[^.]+$/, ""), created: e.modified, metadata: readMetadata(session.documents[e.path]?.text ?? ""), snippet: session.documents[e.path]?.text.slice(0,100) ?? e.path }));
  const notes = catalog.map(n => session.documents[n.path] ? { ...n, metadata: readMetadata(session.documents[n.path].text), snippet: session.documents[n.path].text.slice(0,100) } : n).filter(n => {
    if (!settings.showCompletedTodos && n.metadata.todo && n.metadata.completed) return false;
    if (session.view === "tag") return n.metadata.tags.includes(session.tag);
    if (session.view === "todo") return n.metadata.todo;
    if (session.view === "pinned") return n.metadata.pinned;
    if (session.view === "all") return true;
    return n.path.slice(0, n.path.lastIndexOf("/") < 0 ? 0 : n.path.lastIndexOf("/")) === session.folder;
  });
  const order = settings.manualOrder?.[`${session.info.id}:${session.view}:${session.tag || session.folder}`] ?? [];
  const sorting=noteSortFor(settings,session.info.id,session.folder,session.view);
  return notes.sort((a,b) => Number(b.metadata.pinned) - Number(a.metadata.pinned) || (settings.uncompletedTodosOnTop ? Number(b.metadata.todo&&!b.metadata.completed)-Number(a.metadata.todo&&!a.metadata.completed) : 0) || (sorting.sort === "modified" ? b.modified-a.modified : sorting.sort === "created" ? b.created-a.created : sorting.sort === "size" ? b.size-a.size : sorting.sort === "manual" ? (order.indexOf(a.path)<0?1e9:order.indexOf(a.path))-(order.indexOf(b.path)<0?1e9:order.indexOf(b.path)) : a.title.localeCompare(b.title,stateLocale(settings),{numeric:true})) * (sorting.reverseSort?-1:1));
}
function stateLocale(settings: Settings) { return settings.locale === "en" ? "en" : "zh-CN"; }
export function StatisticsDialog({text}:{text:string}) {
  const stats=documentStatistics(text);
  return <><h2>{t("笔记内容统计")}</h2><dl className="properties">{([["characters","字符数"],["words","词数"],["lines","行数"],["bytes","文件字节数（UTF-8）"]] as const).map(([key,label])=><div key={key}><dt>{t(label)}</dt><dd>{stats[key].toLocaleString()}</dd></div>)}</dl><p className="muted">{t("正文统计不包含 Front Matter，文件字节数包含属性。")}</p></>;
}
export function TagSidebar({ session }: { session: Session }) {
  const state=useApp(); const tags=new Map<string,number>();
  for(const note of session.catalog ?? []) for(const tag of note.metadata.tags) tags.set(tag,(tags.get(tag)??0)+1);
  return <div className="smart-sidebar">
    {[["all",t("全部笔记"),Files],["pinned",t("置顶笔记"),Star],["todo",t("待办笔记"),SquareCheck]].map(([id,title,Icon])=>{const Glyph=Icon as typeof Files; return <button key={String(id)} className={session.view===id?"selected":""} onClick={()=>state.setView(session.info.id,id as Session["view"])}><Glyph size={14}/>{String(title)}</button>;})}
    <div className="tags-heading"><Tags size={14}/>{t("标签")}<span>{tags.size}</span></div>
    {[...tags].sort(([a],[b])=>a.localeCompare(b)).map(([tag,count])=><button key={tag} className={session.view==="tag"&&session.tag===tag?"selected":""} onClick={()=>state.setView(session.info.id,"tag",tag)}><span>#{tag}</span><small>{count}</small></button>)}
  </div>;
}
export function PropertiesDialog({ workspace, path, close }: { workspace:string;path:string;close():void }) {
  const state=useApp();const buffer=state.sessions[workspace]?.documents[path];
  const [baseline]=useState(()=>readMetadata(buffer?.text??""));const [meta,setMeta]=useState(baseline);const [extras,setExtras]=useState("{}");const [error,setError]=useState("");
  const [tags,setTags]=useState(meta.tags.join(", "));const [aliases,setAliases]=useState(meta.aliases.join(", "));
  async function save(){try {if(!buffer)throw new Error(t("文档未打开"));const extra=JSON.parse(extras);if(!extra||typeof extra!=="object"||Array.isArray(extra))throw new Error(t("附加属性需要 JSON 对象"));
    const current=useApp.getState().sessions[workspace]?.documents[path];if(!current)throw new Error(t("文档未打开"));
    const text=updateMetadata(current.text,{...extra,...metadataPatch(baseline,{...meta,tags:stringList(tags),aliases:stringList(aliases)})});
    editorActions.replaceDocument(workspace,path,text);await useApp.getState().save(workspace,path);void state.reindex(workspace);close();}catch(e){setError(displayError(e));}}
  return <><h2>{t("文档属性")}</h2><p className="muted">{path} · {buffer?.encoding.toUpperCase()}</p>
    <label className="form-label">{t("标题")}<input value={meta.title} onChange={e=>setMeta({...meta,title:e.target.value})}/></label>
    <label className="form-label">{t("标签（逗号分隔）")}<input value={tags} onChange={e=>setTags(e.target.value)}/></label>
    <label className="form-label">{t("别名（逗号分隔）")}<input value={aliases} onChange={e=>setAliases(e.target.value)}/></label>
    <div className="inline-options"><label><input type="checkbox" checked={meta.todo} onChange={e=>setMeta({...meta,todo:e.target.checked})}/>{t("待办笔记")}</label><label><input type="checkbox" checked={meta.completed} onChange={e=>setMeta({...meta,completed:e.target.checked})}/>{t("已完成")}</label><label><input type="checkbox" checked={meta.pinned} onChange={e=>setMeta({...meta,pinned:e.target.checked})}/>{t("置顶")}</label></div>
    <label className="form-label">{t("到期时间")}<input type="datetime-local" value={meta.due} onChange={e=>setMeta({...meta,due:e.target.value})}/></label>
    <label className="form-label">{t("来源")}<input value={meta.source} onChange={e=>setMeta({...meta,source:e.target.value})}/></label>
    <details><summary>{t("附加属性（JSON，会合并并保留原有属性）")}</summary><textarea className="source-input" value={extras} onChange={e=>setExtras(e.target.value)}/></details>
    {error&&<p className="form-error">{error}</p>}<div className="modal-actions"><button className="secondary" onClick={close}>{t("取消")}</button><button className="primary" onClick={()=>void save()}>{t("保存属性")}</button></div></>;
}
function fuzzy(text:string,query:string):number {text=text.toLowerCase();query=query.toLowerCase();if(!query)return 1000;if(text.includes(query))return 1000-text.indexOf(query);let index=0;let score=0;for(const c of query){const next=text.indexOf(c,index);if(next<0)return -1;score+=10-(next-index);index=next+1;}return score;}
function escapeRegExp(value:string){return value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}
function NoteHighlight({text,query}:{text:string;query:string}) {
  const tokens=query.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if(!tokens.length||!text)return <>{text}</>;
  const matcher=new RegExp(`^(?:${tokens.join("|")})$`,"i");
  return <>{text.split(new RegExp(`(${tokens.join("|")})`,"gi")).map((part,index)=>matcher.test(part)?<mark className="quick-hit" key={index}>{part}</mark>:<span key={index}>{part}</span>)}</>;
}
type QuickEntry={note:NoteSummary;workspace:string;workspaceName:string;score:number};
function sessionNotes(session:Session):NoteSummary[] {
  if(session.catalog?.length)return session.catalog;
  const seen=new Set<string>();const notes:NoteSummary[]=[];
  for(const entries of Object.values(session.tree))for(const entry of entries){
    if(entry.isDirectory||seen.has(entry.path)||!/\.(md|markdown|txt)$/i.test(entry.path))continue;
    seen.add(entry.path);
    const text=session.documents[entry.path]?.text??"";
    notes.push({...entry,title:fileName(entry.path).replace(/\.[^.]+$/,""),created:entry.modified,metadata:readMetadata(text),snippet:text.slice(0,160)||entry.path});
  }
  return notes;
}
export function QuickOpen({ workspace, insertLink=false, close }: { workspace:string;insertLink?:boolean;close():void }) {
  const state=useApp();const session=state.sessions[workspace];
  const quickCommand=coreCommands.find(([id])=>id==="nav.quickOpen");const quickShortcut=quickCommand?effectiveShortcut({id:"nav.quickOpen",name:quickCommand[1],shortcut:quickCommand[2]},state.settings.shortcuts):"";
  const [query,setQuery]=useState("");const [selected,setSelected]=useState(0);const selectedRef=useRef<HTMLButtonElement>(null);
  const [name,fragment]=query.split("#");const queryText=name.trim();
  const sessions=useMemo(()=>{
    const ids=insertLink?[workspace]:state.order;
    return ids.map(id=>state.sessions[id]).filter((item):item is Session=>!!item);
  },[insertLink,workspace,state.order,state.sessions]);
  const notes=useMemo(()=>{
    const entries:QuickEntry[]=[];
    const needle=queryText.toLowerCase();
    for(const item of sessions)for(const note of sessionNotes(item)){
      const haystack=`${note.title} ${note.path} ${note.metadata.aliases.join(" ")} ${note.metadata.tags.join(" ")}`;
      let score=fuzzy(haystack,queryText);
      if(score<0)continue;
      if(needle&&note.title.toLowerCase().includes(needle))score+=500;
      if(needle&&note.path.toLowerCase().includes(needle))score+=100;
      entries.push({note,workspace:item.info.id,workspaceName:item.info.name,score});
    }
    entries.sort((a,b)=>b.score-a.score||Number(b.note.metadata.pinned)-Number(a.note.metadata.pinned)||b.note.modified-a.note.modified||a.note.title.localeCompare(b.note.title,stateLocale(state.settings),{numeric:true}));
    return entries.slice(0,100);
  },[sessions,queryText,state.settings]);
  useEffect(()=>{setSelected(0);},[query]);
  useEffect(()=>{if(selected>=notes.length)setSelected(Math.max(0,notes.length-1));},[selected,notes.length]);
  useEffect(()=>{selectedRef.current?.scrollIntoView({block:"nearest"});},[selected]);
  async function open(entry:QuickEntry){
    try{
      if(insertLink&&session?.file)editorActions.insert(workspace,`[${entry.note.title}](${relativeLink(session.file,entry.note.path)}${fragment?"#"+headingSlug(fragment):""})`);
      else{
        const current=useApp.getState();
        if(entry.workspace!==current.active)current.activate(entry.workspace);
        await useApp.getState().openDocument(entry.workspace,entry.note.path);
        if(fragment)useApp.setState(s=>({sessions:{...s.sessions,[entry.workspace]:{...s.sessions[entry.workspace],fragment:headingSlug(fragment)}}}));
      }
      close();
    }catch(e){state.setNotice(displayError(e));}
  }
  return <>
    <div className="quick-search"><Search size={19}/><input autoFocus aria-label={t("快速搜索")} placeholder={t("搜索标题、路径、标签；#标题可跳转")} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{
      if(e.key==="ArrowDown"){e.preventDefault();setSelected(i=>Math.min(i+1,notes.length-1));}
      if(e.key==="ArrowUp"){e.preventDefault();setSelected(i=>Math.max(0,i-1));}
      if(e.key==="Enter"&&notes[selected])void open(notes[selected]);
      if(e.key==="Escape")close();
    }}/><button className="quick-clear" aria-label={t("清空搜索")} onClick={()=>setQuery("")}><X size={15}/></button>{quickShortcut&&<kbd>{quickShortcut}</kbd>}</div>
    <div className="quick-results" role="listbox" aria-label={t("快速搜索结果")}>
      {notes.map((entry,index)=><button key={`${entry.workspace}:${entry.note.path}`} ref={index===selected?selectedRef:undefined} role="option" aria-selected={index===selected} className={`quick-result ${index===selected?"selected":""}`} onMouseEnter={()=>setSelected(index)} onClick={()=>void open(entry)}>
        <div className="quick-result-title"><span className="quick-workspace">[{entry.workspaceName}]</span><strong><NoteHighlight text={entry.note.title} query={name}/></strong>{entry.note.metadata.pinned&&<Star size={12} className="quick-pinned"/>}{entry.note.metadata.todo&&<span className={`quick-todo ${entry.note.metadata.completed?"completed":""}`}><SquareCheck size={11}/>{entry.note.metadata.completed?t("已完成"):t("待办")}</span>}</div>
        <div className="quick-result-meta"><span><Folder size={11}/><NoteHighlight text={parentPath(entry.note.path)||t("工作目录根目录")} query={name}/></span>{entry.note.metadata.tags.slice(0,5).map(tag=><span className="quick-tag" key={tag}><Tag size={10}/>#{tag}</span>)}{entry.note.metadata.tags.length>5&&<span className="quick-more">+{entry.note.metadata.tags.length-5}</span>}</div>
        {queryText&&<div className="quick-result-snippet"><NoteHighlight text={entry.note.snippet.replace(/\s+/g," ").slice(0,180)} query={name}/></div>}
      </button>)}
      {!notes.length&&<p className="quick-empty">{t("没有匹配的笔记")}</p>}
    </div>
    <div className="quick-footer"><span>{t("{0} 个匹配", notes.length)}</span><span>{t("↑↓ 选择")} · {t("Enter 打开")} · {t("Esc 关闭")}</span></div>
  </>;
}
