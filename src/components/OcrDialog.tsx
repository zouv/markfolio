import { t } from "../i18n";
import { useEffect,useRef,useState } from "react";
import { type Worker } from "tesseract.js";
import { createLocalOcrWorker,type OcrLanguage } from "../ocr";
import { useApp } from "../store";
import { readAsset } from "../api";
import { displayError } from "../types";
import { editorActions } from "../Editor";
export default function OcrDialog({workspace}:{workspace:string}) {
  const session=useApp(s=>s.sessions[workspace]);const [path,setPath]=useState("");const [file,setFile]=useState<File>();const [language,setLanguage]=useState<OcrLanguage>("eng+chi_sim");const [text,setText]=useState("");const [error,setError]=useState("");const [progress,setProgress]=useState(0);const [busy,setBusy]=useState(false);const worker=useRef<Worker>();
  const generation=useRef(0);
  useEffect(()=>()=>{generation.current++;void worker.current?.terminate();},[workspace]);
  async function recognize(){const token=++generation.current;setBusy(true);setProgress(0);setError("");let instance:Worker|undefined;try{const input=file??await readAsset(workspace,path);const size=typeof input==="string"?input.length*3/4:input.size;if(size>32*1024*1024)throw new Error(t("图片不能超过 32 MB"));if(token!==generation.current)return;instance=await createLocalOcrWorker(language,message=>{if(token===generation.current)setProgress(message.progress??0);});if(token!==generation.current)return;worker.current=instance;const result=await instance.recognize(input);if(token===generation.current)setText(result.data.text);}catch(e){if(token===generation.current)setError(displayError(e));}finally{if(instance)await instance.terminate().catch(()=>{});if(worker.current===instance)worker.current=undefined;if(token===generation.current)setBusy(false);}}
  return <><h2>{t("图片文字识别")}</h2><p className="muted">{t("中英文模型随应用打包，识别在本机完成。")}</p><fieldset disabled={busy} className="settings-fields"><label className="form-label">{t("工作目录内的图片路径")}<input value={path} onChange={e=>{setPath(e.target.value);setFile(undefined);}} placeholder="attachments/image.png"/></label><label className="form-label">{t("或选择图片")}<input type="file" accept="image/*" onChange={e=>setFile(e.target.files?.[0])}/></label><div className="inline-options"><select value={language} onChange={e=>setLanguage(e.target.value as OcrLanguage)}><option value="eng+chi_sim">{t("中文与英文")}</option><option value="eng">{t("英文")}</option><option value="chi_sim">{t("简体中文")}</option></select><button className="primary" disabled={!path&&!file} onClick={()=>void recognize()}>{t("识别文字")}</button></div></fieldset>{busy&&<p>{t("正在识别")}{Math.round(progress*100)}%</p>}<textarea className="source-input ocr-result" aria-label={t("识别文字")} value={text} onChange={e=>setText(e.target.value)}/><button className="secondary" disabled={!text||!session?.file} onClick={()=>{editorActions.insert(workspace,text);useApp.getState().setNotice(t("识别文字已插入笔记"));}}>{t("插入当前笔记")}</button>{error&&<p className="form-error">{error}</p>}</>;
}
