import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("隔离插件无法访问页面或网络，文档快照更新且停止后清理注册", async ({ page }) => {
  page.on("console",message=>{if(message.type()==="error")process.stderr.write(`Plugin browser: ${message.text()}\n`);});
  page.on("pageerror",error=>process.stderr.write(`Plugin page: ${error.message}\n`));
  page.on("requestfailed",request=>process.stderr.write(`Plugin request: ${request.url()} ${request.failure()?.errorText}\n`));
  await page.goto("/tests/ui/fixture.html");
  const result = await page.evaluate(async () => {
    const path = "/src/plugins/isolated.ts";
    const { loadIsolatedPlugin } = await import(path);
    const commands = new Map<string, {run():Promise<void>}>();
    const listeners = new Map<string,Set<()=>void>>();
    const saved: unknown[] = [];
    let text = "first document";
    const registrations: (()=>void)[] = [];
    const context = {
      workspace:{id:"test",name:"Synthetic"},manifest:{id:"sandbox-test",name:"Sandbox",version:"1.0.0",sdkVersion:2},
      editor:{getText:()=>text,getSelection:()=>"selection",insert:()=>{throw new Error("Permission required: editor");},replaceSelection:()=>{}},
      addCommand(command:{id:string;run():Promise<void>}){commands.set(command.id,command);return()=>commands.delete(command.id);},
      register(dispose:()=>void){registrations.push(dispose);},
      onEvent(name:string,callback:()=>void){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(callback);return()=>listeners.get(name)!.delete(callback);},
      loadData:()=>({}),saveData:async(value:unknown)=>{saved.push(value);},notice:()=>{},
      files:{read:async()=>{throw new Error("Permission required: files:read");},write:async()=>{},list:async()=>[]},
    };
    const source = `export default class {
      async onload(context) {
        let network = false;try {await fetch('https://example.com/markfolio-sandbox-test');network=true;}catch{}
        await context.saveData({dom:typeof document,window:typeof window,network,text:context.editor.getText()});
        context.addCommand({id:'check',name:'Check',run:async()=>{
          let denied=false;try{await context.editor.insert('blocked');}catch{denied=true;}
          await context.saveData({text:context.editor.getText(),denied});
        }});
        return ()=>{};
      }
    }`;
    const dispose = await loadIsolatedPlugin({manifest:context.manifest,source,styles:""},context);
    text = "second document";
    for (const callback of listeners.get("file:opened") ?? []) callback();
    await commands.get("check")!.run();
    dispose();
    await new Promise(resolve=>setTimeout(resolve,600));
    return {saved,commands:commands.size,frames:document.querySelectorAll('iframe[src$="plugin-frame.html"]').length,listeners:[...listeners.values()].reduce((count,set)=>count+set.size,0)};
  });
  expect(result.saved[0]).toEqual({dom:"undefined",window:"undefined",network:false,text:"first document"});
  expect(result.saved[1]).toEqual({text:"second document",denied:true});
  expect(result.commands).toBe(0);expect(result.frames).toBe(0);expect(result.listeners).toBe(0);
});
test("随项目提供的隔离插件示例能启用、更新面板并在停用时清理",async({page})=>{
  await page.goto("/tests/ui/fixture.html");
  const manifest=JSON.parse(readFileSync(new URL("../../examples/plugins/reading-time/manifest.json",import.meta.url),"utf8"));
  const source=readFileSync(new URL("../../examples/plugins/reading-time/main.js",import.meta.url),"utf8");
  await page.evaluate(async bundle=>{const store="/src/store.ts";const {useApp}=await import(store);const state=useApp.getState();useApp.setState({plugins:[bundle],settings:{...state.settings,plugins:{...state.settings.plugins,notes:{...state.settings.plugins.notes,"reading-time":{enabled:true,data:{},permissions:["editor"]}}}}});},{manifest,source,styles:""});
  await expect.poll(async()=>page.evaluate(async()=>{const module="/src/plugins/runtime.ts";const {useRegistry}=await import(module);return useRegistry.getState().commands.some(command=>command.id==="notes:reading-time:estimate");})).toBe(true);
  await page.evaluate(async()=>{const module="/src/plugins/runtime.ts";const {useRegistry}=await import(module);await useRegistry.getState().commands.find(command=>command.id==="notes:reading-time:estimate")!.run();});
  await expect(page.getByText("预计阅读 1 分钟",{exact:true})).toBeVisible();
  await page.evaluate(async()=>{const store="/src/store.ts";const {useApp}=await import(store);const state=useApp.getState();state.edit("notes",state.sessions.notes.file,"word ".repeat(1000));});
  await expect.poll(async()=>page.evaluate(async()=>{const module="/src/plugins/runtime.ts";const {useRegistry}=await import(module);const panel=useRegistry.getState().panels.find(panel=>panel.plugin==="reading-time");const node=document.createElement("div");panel?.render(node);return node.textContent;})).toBe("约 12 分钟");
  await page.evaluate(async()=>{const store="/src/store.ts";const {useApp}=await import(store);const state=useApp.getState();state.updateSettings({safeMode:true});});
  await expect.poll(async()=>page.evaluate(async()=>{const module="/src/plugins/runtime.ts";const {useRegistry}=await import(module);const registry=useRegistry.getState();return [...registry.commands,...registry.panels,...registry.menuItems,...registry.toolbarItems].filter(item=>item.plugin==="reading-time").length;})).toBe(0);
  await expect(page.locator('iframe[src$="plugin-frame.html"]')).toHaveCount(0);
});
