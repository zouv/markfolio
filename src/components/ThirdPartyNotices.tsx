import { useEffect, useState } from "react";
import { t } from "../i18n";

type Dependency = { ecosystem:string; name:string; version:string; license:string; licenseFiles:string[]; sourceArchive?:string };
export default function ThirdPartyNotices() {
  const [dependencies,setDependencies]=useState<Dependency[]>([]),[query,setQuery]=useState(""),[error,setError]=useState(""),[text,setText]=useState(""),[loading,setLoading]=useState(false);
  useEffect(()=>{const controller=new AbortController();void fetch("/third-party/dependencies.json",{signal:controller.signal}).then(response=>{if(!response.ok)throw new Error(t("无法读取第三方声明"));return response.json();}).then(data=>setDependencies(data.dependencies)).catch(error=>{if(!controller.signal.aborted)setError(String(error));});return()=>controller.abort();},[]);
  async function read(file:string){setLoading(true);setError("");try{const response=await fetch(`/third-party/${file}`);if(!response.ok)throw new Error(t("无法读取第三方声明"));setText(await response.text());}catch(error){setError(String(error));}finally{setLoading(false);}}
  const matches=dependencies.filter(item=>`${item.ecosystem} ${item.name} ${item.license}`.toLowerCase().includes(query.toLowerCase()));
  return <><h2>{t("第三方许可证与资源")}</h2><p className="muted">{t("依赖许可全文及相关组件源码随安装与免安装包提供。")}</p><input aria-label={t("搜索第三方依赖")} value={query} onChange={event=>setQuery(event.target.value)}/><div style={{maxHeight:220,overflow:"auto",marginTop:12}}>{matches.map(item=><div className="setting-row" key={`${item.ecosystem}/${item.name}/${item.version}`}><div><strong>{item.name} {item.version}</strong><p>{item.license}</p>{item.sourceArchive&&<small>{item.sourceArchive}</small>}</div><div>{item.licenseFiles.map(file=><button className="secondary" disabled={loading} key={file} onClick={()=>void read(file)}>{file.split("/").pop()}</button>)}</div></div>)}</div>{text&&<pre style={{whiteSpace:"pre-wrap",maxHeight:300,overflow:"auto",fontSize:12}}>{text}</pre>}{error&&<p className="form-error">{error}</p>}</>;
}
