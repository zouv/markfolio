import { useMemo, useState } from "react";
import { Tags, Star, Files, SquareCheck, Search, X } from "lucide-react";
import { useApp, type Session } from "../store";
import { fileName, relativeLink, displayError, type Settings, type NoteSummary } from "../types";
import { readMetadata, updateMetadata, stringList } from "../metadata";
import { editorActions } from "../Editor";
import { headingSlug } from "../markdown";

export function visibleNotes(session: Session, settings: Settings): NoteSummary[] {
  const catalog = session.catalog?.length ? session.catalog : (session.tree[session.folder] ?? []).filter(e => !e.isDirectory && /\.(md|markdown|txt)$/i.test(e.path)).map(e => ({ ...e, title: fileName(e.path).replace(/\.[^.]+$/, ""), created: e.modified, metadata: readMetadata(session.documents[e.path]?.text ?? ""), snippet: session.documents[e.path]?.text.slice(0,100) ?? e.path }));
  const notes = catalog.map(n => session.documents[n.path] ? { ...n, metadata: readMetadata(session.documents[n.path].text), snippet: session.documents[n.path].text.slice(0,100) } : n).filter(n => {
    if (session.view === "tag") return n.metadata.tags.includes(session.tag);
    if (session.view === "todo") return n.metadata.todo;
    if (session.view === "pinned") return n.metadata.pinned;
    if (session.view === "all") return true;
    return n.path.slice(0, n.path.lastIndexOf("/") < 0 ? 0 : n.path.lastIndexOf("/")) === session.folder;
  });
  const order = settings.manualOrder?.[`${session.info.id}:${session.view}:${session.tag || session.folder}`] ?? [];
  return notes.sort((a,b) => Number(b.metadata.pinned) - Number(a.metadata.pinned) || (settings.sort === "modified" ? b.modified-a.modified : settings.sort === "created" ? b.created-a.created : settings.sort === "size" ? b.size-a.size : settings.sort === "manual" ? (order.indexOf(a.path)<0?1e9:order.indexOf(a.path))-(order.indexOf(b.path)<0?1e9:order.indexOf(b.path)) : a.title.localeCompare(b.title,"zh-CN",{numeric:true})) * (settings.reverseSort?-1:1));
}
export function TagSidebar({ session }: { session: Session }) {
  const state=useApp(); const tags=new Map<string,number>();
  for(const note of session.catalog ?? []) for(const tag of note.metadata.tags) tags.set(tag,(tags.get(tag)??0)+1);
  return <div className="smart-sidebar">
    {[["all","全部笔记",Files],["pinned","置顶笔记",Star],["todo","待办笔记",SquareCheck]].map(([id,title,Icon])=>{const Glyph=Icon as typeof Files; return <button key={String(id)} className={session.view===id?"selected":""} onClick={()=>state.setView(session.info.id,id as Session["view"])}><Glyph size={14}/>{String(title)}</button>;})}
    <div className="tags-heading"><Tags size={14}/>标签 <span>{tags.size}</span></div>
    {[...tags].sort(([a],[b])=>a.localeCompare(b)).map(([tag,count])=><button key={tag} className={session.view==="tag"&&session.tag===tag?"selected":""} onClick={()=>state.setView(session.info.id,"tag",tag)}><span>#{tag}</span><small>{count}</small></button>)}
  </div>;
}
export function PropertiesDialog({ workspace, path, close }: { workspace:string;path:string;close():void }) {
  const state=useApp();const buffer=state.sessions[workspace]?.documents[path];
  const [meta,setMeta]=useState(()=>readMetadata(buffer?.text??""));const [extras,setExtras]=useState("{}");const [error,setError]=useState("");
  const [tags,setTags]=useState(meta.tags.join(", "));const [aliases,setAliases]=useState(meta.aliases.join(", "));
  async function save(){try {if(!buffer)throw new Error("文档未打开");const extra=JSON.parse(extras);if(!extra||typeof extra!=="object"||Array.isArray(extra))throw new Error("附加属性需要 JSON 对象");
    const text=updateMetadata(buffer.text,{...extra,title:meta.title,tags:stringList(tags),aliases:stringList(aliases),type:meta.todo?"todo":undefined,completed:meta.completed||undefined,pinned:meta.pinned||undefined,due:meta.due,source:meta.source});
    editorActions.replaceDocument(workspace,path,text);await useApp.getState().save(workspace,path);void state.reindex(workspace);close();}catch(e){setError(displayError(e));}}
  return <><h2>文档属性</h2><p className="muted">{path} · {buffer?.encoding.toUpperCase()}</p>
    <label className="form-label">标题<input value={meta.title} onChange={e=>setMeta({...meta,title:e.target.value})}/></label>
    <label className="form-label">标签（逗号分隔）<input value={tags} onChange={e=>setTags(e.target.value)}/></label>
    <label className="form-label">别名（逗号分隔）<input value={aliases} onChange={e=>setAliases(e.target.value)}/></label>
    <div className="inline-options"><label><input type="checkbox" checked={meta.todo} onChange={e=>setMeta({...meta,todo:e.target.checked})}/>待办笔记</label><label><input type="checkbox" checked={meta.completed} onChange={e=>setMeta({...meta,completed:e.target.checked})}/>已完成</label><label><input type="checkbox" checked={meta.pinned} onChange={e=>setMeta({...meta,pinned:e.target.checked})}/>置顶</label></div>
    <label className="form-label">到期时间<input type="datetime-local" value={meta.due} onChange={e=>setMeta({...meta,due:e.target.value})}/></label>
    <label className="form-label">来源<input value={meta.source} onChange={e=>setMeta({...meta,source:e.target.value})}/></label>
    <details><summary>附加属性（JSON，会合并并保留原有属性）</summary><textarea className="source-input" value={extras} onChange={e=>setExtras(e.target.value)}/></details>
    {error&&<p className="form-error">{error}</p>}<div className="modal-actions"><button className="secondary" onClick={close}>取消</button><button className="primary" onClick={()=>void save()}>保存属性</button></div></>;
}
function fuzzy(text:string,query:string):number {text=text.toLowerCase();query=query.toLowerCase();if(text.includes(query))return 1000-text.indexOf(query);let index=0;let score=0;for(const c of query){const next=text.indexOf(c,index);if(next<0)return -1;score+=10-(next-index);index=next+1;}return score;}
export function QuickOpen({ workspace, insertLink=false, close }: { workspace:string;insertLink?:boolean;close():void }) {
  const state=useApp();const session=state.sessions[workspace];const [query,setQuery]=useState("");const [selected,setSelected]=useState(0);
  const [name,fragment]=query.split("#");
  const notes=useMemo(()=> (session?.catalog??[]).map(n=>({note:n,score:fuzzy(`${n.title} ${n.path} ${n.metadata.aliases.join(" ")}`,name.trim())})).filter(n=>n.score>=0).sort((a,b)=>b.score-a.score).slice(0,100),[session?.catalog,name]);
  async function open(note:NoteSummary){try {if(insertLink&&session?.file) editorActions.insert(workspace,`[${note.title}](${relativeLink(session.file,note.path)}${fragment?"#"+headingSlug(fragment):""})`);
    else{await state.openDocument(workspace,note.path);if(fragment)useApp.setState(s=>({sessions:{...s.sessions,[workspace]:{...s.sessions[workspace],fragment:headingSlug(fragment)}}}));}close();}catch(e){state.setNotice(displayError(e));}}
  return <><h2>{insertLink?"选择笔记链接":"快速打开"}</h2><div className="palette-search"><Search size={17}/><input autoFocus aria-label="快速打开笔记" placeholder="文件名、路径、别名；#标题可跳转" value={query} onChange={e=>{setQuery(e.target.value);setSelected(0);}} onKeyDown={e=>{if(e.key==="ArrowDown"){e.preventDefault();setSelected(i=>Math.min(i+1,notes.length-1));}if(e.key==="ArrowUp"){e.preventDefault();setSelected(i=>Math.max(0,i-1));}if(e.key==="Enter"&&notes[selected])void open(notes[selected].note);if(e.key==="Escape")close();}}/><button onClick={()=>setQuery("")}><X size={14}/></button></div>
    <div className="palette-results">{notes.map(({note},i)=><button key={note.path} className={i===selected?"selected":""} onMouseEnter={()=>setSelected(i)} onClick={()=>void open(note)}><span>{note.title}</span><small>{note.path}</small></button>)}{!notes.length&&<p className="muted">没有匹配的笔记</p>}</div></>;
}
