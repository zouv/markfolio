import { t } from "../i18n";
import type { PluginBundle } from "../types";
import type { PluginContext, Dispose, PluginEventName } from "./sdk";
import { validateFields } from "./sdk";

export async function loadIsolatedPlugin(bundle:PluginBundle,context:PluginContext):Promise<Dispose> {
  const frame=document.createElement("iframe");frame.hidden=true;frame.sandbox.add("allow-scripts");frame.src="/plugin-frame.html";
  const channel=new MessageChannel();const registrations=new Map<number,Dispose>();let registrationId=0;let callbackId=0;
  let disposed=false;
  const documentSnapshot=()=>({text:context.editor.getText(),selection:context.editor.getSelection()});
  const updateDocument=()=>{if(!disposed)channel.port1.postMessage({type:"document",document:documentSnapshot()});};
  const updateListeners=[context.onEvent("file:opened",updateDocument),context.onEvent("file:changed",updateDocument),context.onEvent("file:deleted",updateDocument),context.onEvent("settings:changed",updateDocument)];
  const callbackResults=new Map<number,{resolve(value:unknown):void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>}>();
  const callback=(id:number,args:unknown[])=>new Promise<unknown>((resolve,reject)=>{if(disposed||callbackResults.size>=64){reject(new Error(t("插件已停止")));return;}updateDocument();const requestId=++callbackId;const timer=setTimeout(()=>{callbackResults.delete(requestId);reject(new Error(t("插件响应超时")));},30000);callbackResults.set(requestId,{resolve,reject,timer});channel.port1.postMessage({type:"callback",callbackId:id,args,requestId});});
  const register=(dispose:Dispose)=>{if(registrations.size>=256){dispose();throw new Error("Too many plugin registrations");}const id=++registrationId;registrations.set(id,dispose);return id;};
  let readyResolve:()=>void=()=>{};let readyReject:(error:Error)=>void=()=>{};
  const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  channel.port1.onmessage=async event=>{
    const message=event.data;
    if(disposed){if(message?.type==="stopped")frame.remove();else if(message?.type==="call")channel.port1.postMessage({type:"result",requestId:message.requestId,error:t("插件已停止")});return;}
    if(message.type==="ready"){readyResolve();return;}
    if(message.type==="error"){readyReject(new Error(message.message));context.notice(message.message);return;}
    if(message.type==="callbackResult"){const result=callbackResults.get(message.requestId);if(result){clearTimeout(result.timer);callbackResults.delete(message.requestId);message.error?result.reject(new Error(message.error)):result.resolve(message.value);}return;}
    if(message.type!=="call"||!Number.isSafeInteger(message.requestId)||!Array.isArray(message.args)||message.args.length>5)return;
    try {
      const a=message.args;let value:unknown;
      switch(message.method){
        case "addCommand":if(!a[0]||typeof a[0].id!=="string"||!/^[a-zA-Z][\w.-]{0,79}$/.test(a[0].id)||typeof a[0].name!=="string"||a[0].name.length>300)throw new Error("Invalid plugin command");value=register(context.addCommand({...a[0],run:async()=>{await callback(a[1],[]);}}));break;
        case "addSettings":value=register(context.addSettings(validateFields(a[0])));break;
        case "onEvent":if(!["file:opened","file:changed","file:saved","file:renamed","file:deleted","workspace:activated","settings:changed"].includes(a[0])||!Number.isSafeInteger(a[1]))throw new Error("Invalid plugin event");value=register(context.onEvent(a[0] as PluginEventName,event=>{void callback(a[1],[event]).catch(error=>context.notice(error.message));}));break;
        case "addMenuItem":value=register(context.addMenuItem(a[0],a[1],a[2]));break;
        case "addToolbarItem":value=register(context.addToolbarItem(a[0],a[1],a[2]));break;
        case "registerHtmlPanel":value=register(context.registerHtmlPanel(a[0],a[1],a[2]));break;
        case "registerListColumn":value=register(context.registerListColumn(a[0],a[1],async note=>String(await callback(a[2],[note]))));break;
        case "showDialog":if(typeof a[0]!=="string"||a[0].length>300)throw new Error("Invalid dialog title");value=await context.showDialog(a[0],validateFields(a[1]));break;
        case "saveData":if((JSON.stringify(a[0])??"").length>1024*1024)throw new Error("Plugin data is too large");await context.saveData(a[0]);break;
        case "notice":context.notice(String(a[0]).slice(0,2000));break;
        case "files.read":value=await context.files.read(a[0]);break;
        case "files.write":await context.files.write(a[0],a[1]);break;
        case "files.list":value=await context.files.list(a[0]);break;
        case "editor.insert":context.editor.insert(a[0]);break;
        case "editor.replaceSelection":context.editor.replaceSelection(a[0]);break;
        case "dispose":registrations.get(a[0])?.();registrations.delete(a[0]);break;
        default:throw new Error(t("插件请求了未提供的宿主能力"));
      }
      channel.port1.postMessage({type:"result",requestId:message.requestId,value});
    }catch(error){channel.port1.postMessage({type:"result",requestId:message.requestId,error:error instanceof Error?error.message:t("插件操作失败")});}
  };
  frame.onload=()=>frame.contentWindow?.postMessage({type:"markfolio-plugin-init",source:bundle.source,manifest:bundle.manifest,workspace:context.workspace,data:context.loadData({}),document:{text:context.editor.getText(),selection:context.editor.getSelection()}},"*",[channel.port2]);
  frame.onerror=()=>readyReject(new Error(t("无法启动隔离插件")));
  document.body.append(frame);
  const dispose=()=>{if(disposed)return;disposed=true;updateListeners.forEach(dispose=>dispose());channel.port1.postMessage({type:"stop"});for(const registration of registrations.values())registration();registrations.clear();for(const result of callbackResults.values()){clearTimeout(result.timer);result.reject(new Error(t("插件已停止")));}callbackResults.clear();setTimeout(()=>{frame.remove();channel.port1.close();},500);};
  context.register(dispose);
  const timeout=setTimeout(()=>readyReject(new Error(t("插件启动超时"))),30000);
  try{await ready;return dispose;}catch(error){dispose();throw error;}finally{clearTimeout(timeout);}
}
