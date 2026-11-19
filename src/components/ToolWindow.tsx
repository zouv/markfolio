import { t } from "../i18n";
import { useRef } from "react";
import { X } from "lucide-react";
import { AttachmentManager, TrashManager, MediaViewer } from "./Media";
import TransferDialog from "./TransferDialog";
import { UpdateDialog,LockDialog } from "./DesktopTools";
import OcrDialog from "./OcrDialog";
import Whiteboard from "./Whiteboard";
import { AiDialog,ApiDialog } from "./Integrations";
import ThirdPartyNotices from "./ThirdPartyNotices";
export type ToolTarget={type:string;workspace:string;path?:string};
export default function ToolWindow({target,close}:{target:ToolTarget;close():void}) {
  const closeGuard=useRef<()=>boolean>(()=>true);
  function leave(){if(closeGuard.current())close();}
  return <div className="modal-backdrop"><section className="modal tools-modal" role="dialog" aria-modal="true" aria-label={t("工作目录工具")} onKeyDown={e=>{if(e.key==="Escape"){e.stopPropagation();leave();}}}><button className="modal-close" aria-label={t("关闭工具")} onClick={leave}><X size={18}/></button>
    {target.type==="attachments"&&<AttachmentManager workspace={target.workspace}/>}
    {target.type==="trash"&&<TrashManager workspace={target.workspace}/>}
    {target.type==="transfer"&&<TransferDialog workspace={target.workspace}/>}
    {target.type==="updates"&&<UpdateDialog/>}
    {target.type==="notices"&&<ThirdPartyNotices/>}
    {target.type==="ocr"&&<OcrDialog workspace={target.workspace}/>}
    {target.type==="whiteboard"&&<Whiteboard workspace={target.workspace} registerCloseGuard={guard=>{closeGuard.current=guard;}}/>}
    {target.type==="ai"&&<AiDialog workspace={target.workspace}/>}
    {target.type==="api"&&<ApiDialog workspace={target.workspace}/>}
    {target.type==="lock"&&<LockDialog workspace={target.workspace} path={target.path} close={close}/>}
    {target.type==="media"&&target.path&&<><h2>{target.path}</h2><MediaViewer workspace={target.workspace} path={target.path}/></>}
  </section></div>;
}
