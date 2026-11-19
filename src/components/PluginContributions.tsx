import { t } from "../i18n";
import { useEffect, useState } from "react";
import { useRegistry,type PluginColumn,type PluginDialog } from "../plugins/runtime";
import { useApp } from "../store";
import type { NoteSummary } from "../types";
export function PluginButtons({workspace,kind}:{workspace:string;kind:"menu"|"toolbar"}){
  const registry=useRegistry();return <>{(kind==="menu"?registry.menuItems:registry.toolbarItems).filter(i=>i.workspace===workspace).map(item=><button key={`${item.plugin}:${item.id}`} title={item.title} onClick={()=>{const command=registry.commands.find(c=>c.id===item.command);void Promise.resolve(command?.run()).catch(e=>useApp.getState().setNotice(String(e.message)));}}>{item.title}</button>)}</>;
}
export function PluginColumnValue({column,note}:{column:PluginColumn;note:NoteSummary}) {
  const [text,setText]=useState("");useEffect(()=>{let cancelled=false;void Promise.resolve(column.render(note)).then(value=>{if(!cancelled)setText(value);}).catch(()=>{});return()=>{cancelled=true;};},[column,note]);return <small title={column.title}>{column.title}: {text}</small>;
}
function Dialog({dialog}:{dialog:PluginDialog}) {
  const [values,setValues]=useState<Record<string,unknown>>(()=>Object.fromEntries(dialog.fields.map(f=>[f.key,f.defaultValue??""])));
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label={dialog.title}><h2>{dialog.title}</h2>{dialog.fields.map(field=><label className="form-label" key={field.key}>{field.label}<input type={field.type==="toggle"?"checkbox":field.type==="number"?"number":"text"} checked={field.type==="toggle"?Boolean(values[field.key]):undefined} value={field.type==="toggle"?undefined:String(values[field.key]??"")} onChange={e=>setValues(v=>({...v,[field.key]:field.type==="toggle"?e.target.checked:field.type==="number"?Number(e.target.value):e.target.value}))}/></label>)}<div className="modal-actions"><button className="secondary" onClick={()=>dialog.resolve(null)}>{t("取消")}</button><button className="primary" onClick={()=>dialog.resolve(values)}>{t("确定")}</button></div></section></div>;
}
export function PluginDialogs(){const dialogs=useRegistry(s=>s.dialogs);return <>{dialogs.slice(-1).map(dialog=><Dialog key={dialog.id} dialog={dialog}/>)}</>;}
