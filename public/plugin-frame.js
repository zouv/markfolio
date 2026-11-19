"use strict";
window.addEventListener("message", function initialize(event) {
  if(event.source!==parent || event.data?.type!=="markfolio-plugin-init" || !event.ports[0])return;
  window.removeEventListener("message",initialize);
  const port=event.ports[0];
  const bootstrap=`
    const calls=new Map(),callbacks=new Map();let sequence=0;
    function call(method,...args){const requestId=++sequence;postMessage({type:'call',method,args,requestId});return new Promise((resolve,reject)=>calls.set(requestId,{resolve,reject}));}
    function register(method,args,callback){const callbackId=++sequence;if(callback)callbacks.set(callbackId,callback);const pending=call(method,...args,callbackId);pending.catch(error=>postMessage({type:'error',message:String(error.message)}));return ()=>{callbacks.delete(callbackId);void pending.then(id=>call('dispose',id));};}
    onmessage=async event=>{
      const message=event.data;
      if(message.type==='result'){const pending=calls.get(message.requestId);if(pending){calls.delete(message.requestId);message.error?pending.reject(new Error(message.error)):pending.resolve(message.value);}return;}
      if(message.type==='callback'){try{const value=await callbacks.get(message.callbackId)?.(...(message.args??[]));postMessage({type:'callbackResult',requestId:message.requestId,value});}catch(error){postMessage({type:'callbackResult',requestId:message.requestId,error:String(error.message)});}return;}
      if(message.type!=='init')return;
      const disposers=[];
      const context={workspace:message.workspace,manifest:message.manifest,
        addCommand:command=>register('addCommand',[{id:command.id,name:command.name,shortcut:command.shortcut}],command.run),
        addSettings:fields=>register('addSettings',[fields]),
        register:dispose=>disposers.push(dispose),
        onFileChange:callback=>register('onEvent',['file:changed'],callback),
        onEvent:(name,callback)=>register('onEvent',[name],callback),
        addMenuItem:(id,title,command)=>register('addMenuItem',[id,title,command]),
        addToolbarItem:(id,title,command)=>register('addToolbarItem',[id,title,command]),
        registerHtmlPanel:(id,title,html)=>register('registerHtmlPanel',[id,title,html]),
        registerListColumn:(key,title,render)=>register('registerListColumn',[key,title],render),
        showDialog:(title,fields)=>call('showDialog',title,fields),
        loadData:defaults=>typeof defaults==='object'&&defaults!==null?{...defaults,...message.data}:message.data??defaults,
        saveData:data=>call('saveData',data),notice:text=>call('notice',text),
        files:{read:path=>call('files.read',path),write:(path,text)=>call('files.write',path,text),list:path=>call('files.list',path)},
        editor:{getText:()=>message.document?.text??'',getSelection:()=>message.document?.selection??'',insert:text=>call('editor.insert',text),replaceSelection:text=>call('editor.replaceSelection',text)},
        registerPanel:()=>{throw new Error('隔离插件请使用 registerHtmlPanel，或明确选择可信运行模式');},
        registerCodeBlock:()=>{throw new Error('DOM 渲染扩展需要可信运行模式');},
        registerEditorExtension:()=>{throw new Error('CodeMirror 扩展需要可信运行模式');}
      };
      try{const blob=new Blob([message.source],{type:'text/javascript'});const url=URL.createObjectURL(blob);const module=await import(url);URL.revokeObjectURL(url);const instance=new module.default();const result=await instance.onload(context);postMessage({type:'ready'});}
      catch(error){postMessage({type:'error',message:String(error.message)});}
    };
  `;
  const url=URL.createObjectURL(new Blob([bootstrap],{type:"text/javascript"}));
  const worker=new Worker(url,{type:"module"});URL.revokeObjectURL(url);
  worker.onmessage=event=>port.postMessage(event.data);
  worker.onerror=event=>port.postMessage({type:"error",message:event.message});
  port.onmessage=event=>worker.postMessage(event.data);
  port.start();worker.postMessage({type:"init",...event.data});
});
