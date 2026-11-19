import { X } from "lucide-react";
import { AttachmentManager, TrashManager, MediaViewer } from "./Media";
import TransferDialog from "./TransferDialog";
export type ToolTarget={type:string;workspace:string;path?:string};
export default function ToolWindow({target,close}:{target:ToolTarget;close():void}) {
  return <div className="modal-backdrop"><section className="modal tools-modal" role="dialog" aria-modal="true" aria-label="工作目录工具" onKeyDown={e=>{if(e.key==="Escape")close();}}><button className="modal-close" aria-label="关闭工具" onClick={close}><X size={18}/></button>
    {target.type==="attachments"&&<AttachmentManager workspace={target.workspace}/>}
    {target.type==="trash"&&<TrashManager workspace={target.workspace}/>}
    {target.type==="transfer"&&<TransferDialog workspace={target.workspace}/>}
    {target.type==="media"&&target.path&&<><h2>{target.path}</h2><MediaViewer workspace={target.workspace} path={target.path}/></>}
  </section></div>;
}
