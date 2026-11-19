import DOMPurify from "dompurify";
import { loadIsolatedPlugin } from "./isolated";
import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import * as api from "../api";
import { codeMirror, editorActions } from "../Editor";
import { useApp } from "../store";
import { createTOC } from "../markdown";
import { displayError, joinPath, type PluginBundle } from "../types";
import type {
  Dispose,
  PluginCommand,
  PluginContext,
  PluginDefinition,
  SettingField,
} from "./sdk";

export type Command = PluginCommand & { workspace?: string; plugin?: string };
export type PluginPanel = {
  workspace: string;
  plugin: string;
  id: string;
  title: string;
  render(element: HTMLElement): void | Dispose;
};
export type Contribution={workspace:string;plugin:string;id:string;title:string;command:string};
export type PluginColumn={workspace:string;plugin:string;key:string;title:string;render:(note:import("../types").NoteSummary)=>string|Promise<string>};
export type PluginDialog={id:string;title:string;fields:SettingField[];resolve:(value:Record<string,unknown>|null)=>void};
type Registry = {
  commands: Command[];
  fields: Record<string, SettingField[]>;
  panels: PluginPanel[];
  errors: Record<string, string>;
  menuItems: Contribution[];
  toolbarItems: Contribution[];
  columns: PluginColumn[];
  dialogs: PluginDialog[];
};
export const useRegistry = create<Registry>(() => ({
  commands: [],
  fields: {},
  panels: [],
  errors: {}, menuItems: [], toolbarItems: [], columns: [], dialogs: [],
}));
export function registerCommand(command: Command): Dispose {
  const id =
    !command.workspace && !command.plugin
      ? command.id
      : `${command.workspace ?? "app"}:${command.plugin ?? "core"}:${command.id}`;
  const entry = { ...command, id };
  useRegistry.setState((state) => ({
    commands: [...state.commands.filter((item) => item.id !== id), entry],
  }));
  return () =>
    useRegistry.setState((state) => ({
      commands: state.commands.filter((item) => item !== entry),
    }));
}
const running = new Map<string, Dispose>();
const pending = new Map<string, symbol>();
const pendingCleanup = new Map<string, Dispose>();
function cancelPending(id: string) {
  pending.delete(id);
  pendingCleanup.get(id)?.();
  pendingCleanup.delete(id);
}
const blocks = new Map<
  string,
  {
    workspace: string;
    language: string;
    render: Parameters<PluginContext["registerCodeBlock"]>[1];
  }
>();

export const builtinPlugins: PluginDefinition[] = [
  {
    manifest: {
      id: "daily-note",
      name: "每日笔记",
      version: "1.0.0",
      sdkVersion: 1,
      description: "在当前目录创建或打开今天的笔记。",
      permissions: ["files:write", "commands"],
    },
    async load(context) {
      context.addSettings([
        { key: "prefix", label: "文件名前缀", type: "text", defaultValue: "" },
      ]);
      context.addCommand({
        id: "open-today",
        name: "每日笔记：打开今天",
        async run() {
          const now = new Date();
          const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
          const data = context.loadData({ prefix: "" });
          const path = joinPath(
            useApp.getState().sessions[context.workspace.id]?.folder ?? "",
            `${data.prefix}${date}.md`,
          );
          try {
            await context.files.read(path);
          } catch (error) {
            if (!(
              typeof error === "object" &&
              error &&
              "code" in error &&
              error.code === "NOT_FOUND"
            ))
              throw error;
            await context.files.write(path, `# ${date}\n\n`);
          }
          await useApp.getState().openDocument(context.workspace.id, path);
        },
      });
    },
  },
  {
    manifest: {
      id: "markdown-tools",
      name: "Markdown 工具",
      version: "1.0.0",
      sdkVersion: 1,
      description: "插入日期、目录和常用 Markdown 内容。",
      permissions: ["editor", "commands"],
    },
    load(context) {
      context.addCommand({
        id: "insert-date",
        name: "Markdown：插入日期时间",
        run() {
          context.editor.insert(
            new Date().toLocaleString("zh-CN", { hour12: false }),
          );
        },
      });
      context.addCommand({
        id: "insert-toc",
        name: "Markdown：插入文档目录",
        run() {
          const toc = createTOC(context.editor.getText());
          context.editor.insert(toc + "\n");
        },
      });
      context.addCommand({
        id: "insert-table",
        name: "Markdown：插入表格",
        run() {
          context.editor.insert(
            "| 标题 | 内容 |\n| --- | --- |\n| 示例 | 文本 |\n",
          );
        },
      });
    },
  },
  {
    manifest: {
      id: "word-statistics",
      name: "文档统计",
      version: "1.0.0",
      sdkVersion: 1,
      description: "在独立面板查看当前文档字数、字符与行数。",
      permissions: ["editor", "views"],
    },
    load(context) {
      context.registerPanel("statistics", "文档统计", (element) => {
        const update = () => {
          const text = context.editor.getText();
          const chinese = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
          const words = (
            text.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9]+/g) ?? []
          ).length;
          element.textContent = `字数 ${chinese + words}\n字符 ${text.length}\n行数 ${text.split("\n").length}`;
        };
        update();
        const timer = window.setInterval(update, 700);
        return () => clearInterval(timer);
      });
    },
  },
];

function contextFor(
  workspace: string,
  definition: PluginDefinition,
  dispose: Dispose[],
  alive: () => boolean,
): PluginContext {
  const id = `${workspace}:${definition.manifest.id}`;
  const register = (item: Dispose) => {
    if (alive()) dispose.push(item);
    else item();
    return item;
  };
  return {
    workspace: {
      id: workspace,
      name: useApp.getState().sessions[workspace].info.name,
    },
    manifest: definition.manifest,
    register,
    addCommand(command) {
      if (!alive()) return () => {};
      return register(
        registerCommand({
          ...command,
          workspace,
          plugin: definition.manifest.id,
        }),
      );
    },
    addSettings(fields) {
      if (!alive()) return () => {};
      useRegistry.setState((state) => ({
        fields: { ...state.fields, [id]: fields },
      }));
      return register(() =>
        useRegistry.setState((state) => {
          const fields = { ...state.fields };
          delete fields[id];
          return { fields };
        }),
      );
    },
    registerEditorExtension(extension) {
      if (!alive()) return () => {};
      return register(
        editorActions.addExtension(
          workspace,
          definition.manifest.id,
          extension,
        ),
      );
    },
    registerCodeBlock(language, render) {
      if (!alive()) return () => {};
      const key = `${id}:${language}`;
      blocks.set(key, { workspace, language, render });
      return register(() => {
        blocks.delete(key);
      });
    },
    registerPanel(panelId, title, render) {
      if (!alive()) return () => {};
      const panel = {
        workspace,
        plugin: definition.manifest.id,
        id: panelId,
        title,
        render,
      };
      useRegistry.setState((state) => ({ panels: [...state.panels, panel] }));
      return register(() =>
        useRegistry.setState((state) => ({
          panels: state.panels.filter((item) => item !== panel),
        })),
      );
    },
    onEvent(name,callback) {
      if(!alive()) return ()=>{};
      return register(useApp.subscribe((state,previous)=>{
        const current=state.sessions[workspace],before=previous.sessions[workspace];if(!current||!before)return;
        if(name==="file:opened"&&current.file!==before.file)callback({type:name,path:current.file});
        if(name==="workspace:activated"&&state.active===workspace&&previous.active!==workspace)callback({type:name});
        if(name==="settings:changed"&&state.settings!==previous.settings)callback({type:name});
        if(name==="file:changed"||name==="file:saved")for(const [path,buffer] of Object.entries(current.documents)){const old=before.documents[path];if(old&&(name==="file:changed"?buffer.text!==old.text:buffer.savedText!==old.savedText))callback({type:name,path});}
        if(name==="file:deleted")for(const path of Object.keys(before.documents))if(!current.documents[path])callback({type:name,path});
        if(name==="file:renamed")for(const [path,buffer] of Object.entries(current.documents))if(!before.documents[path]){const old=Object.entries(before.documents).find(([old,doc])=>!current.documents[old]&&doc.version===buffer.version);if(old)callback({type:name,path,previousPath:old[0]});}
      }));
    },
    addMenuItem(itemId,title,command) { const item={workspace,plugin:definition.manifest.id,id:itemId,title,command:command.startsWith(id+":")?command:id+":"+command};useRegistry.setState(s=>({menuItems:[...s.menuItems,item]}));return register(()=>useRegistry.setState(s=>({menuItems:s.menuItems.filter(i=>i!==item)}))); },
    addToolbarItem(itemId,title,command) { const item={workspace,plugin:definition.manifest.id,id:itemId,title,command:command.startsWith(id+":")?command:id+":"+command};useRegistry.setState(s=>({toolbarItems:[...s.toolbarItems,item]}));return register(()=>useRegistry.setState(s=>({toolbarItems:s.toolbarItems.filter(i=>i!==item)}))); },
    registerHtmlPanel(panelId,title,html) { return this.registerPanel(panelId,title,element=>{element.innerHTML=DOMPurify.sanitize(html);}); },
    registerListColumn(key,title,render) {const column={workspace,plugin:definition.manifest.id,key,title,render};useRegistry.setState(s=>({columns:[...s.columns,column]}));return register(()=>useRegistry.setState(s=>({columns:s.columns.filter(c=>c!==column)})));},
    showDialog(title,fields) {return new Promise(resolve=>{const dialog={id:crypto.randomUUID(),title,fields,resolve:(value:Record<string,unknown>|null)=>{useRegistry.setState(s=>({dialogs:s.dialogs.filter(d=>d!==dialog)}));resolve(value);}};useRegistry.setState(s=>({dialogs:[...s.dialogs,dialog]}));register(()=>dialog.resolve(null));});},
    onFileChange(callback) {
      if (!alive()) return () => {};
      let cancelled = false;
      let unlisten: Dispose | undefined;
      void listen<string>("workspace-changed", (event) => {
        if (event.payload === workspace) callback();
      }).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
      return register(() => {
        cancelled = true;
        unlisten?.();
      });
    },
    loadData<T>(defaults: T): T {
      const data =
        useApp.getState().settings.plugins[workspace]?.[definition.manifest.id]
          ?.data;
      return typeof defaults === "object" && defaults !== null
        ? { ...defaults, ...(typeof data === "object" && data ? data : {}) }
        : ((data ?? defaults) as T);
    },
    async saveData(data) {
      if (!alive()) throw new Error("插件已停止");
      const state = useApp.getState();
      const plugins = {
        ...state.settings.plugins,
        [workspace]: {
          ...state.settings.plugins[workspace],
          [definition.manifest.id]: { ...state.settings.plugins[workspace]?.[definition.manifest.id], enabled: true, data },
        },
      };
      state.updateSettings({ plugins });
    },
    notice(message) {
      if (alive()) useApp.getState().setNotice(message);
    },
    files: {
      async read(path) {
        if (!alive()) throw new Error("插件已停止");
        const isolated=!builtinPlugins.includes(definition)&&definition.manifest.runtime!=="trusted";
        if(isolated) { const doc=await api.pluginFileRequest(workspace,definition.manifest.id,"read",path); return (doc as import("../types").Document).text; }
        const cached = useApp.getState().sessions[workspace]?.documents[path];
        return cached
          ? cached.text
          : (await api.readDocument(workspace, path)).text;
      },
      async write(path, text) {
        if (!alive()) throw new Error("插件已停止");
        const state = useApp.getState();
        const isolated=!builtinPlugins.includes(definition)&&definition.manifest.runtime!=="trusted";
        if(isolated){if(state.sessions[workspace]?.documents[path]?.dirty)throw new Error("文档存在未保存内容");await api.pluginFileRequest(workspace,definition.manifest.id,"write",path,text);await state.refresh(workspace);void state.reindex(workspace);return;}
        if (!state.sessions[workspace]) throw new Error("工作区已关闭");
        try {
          await api.readDocument(workspace, path);
        } catch (error) {
          if (
            typeof error === "object" &&
            error &&
            "code" in error &&
            error.code === "NOT_FOUND"
          )
            await api.createEntry(workspace, path, false);
          else throw error;
        }
        const existing = useApp.getState().sessions[workspace]?.documents[path];
        if (!alive() || !useApp.getState().sessions[workspace])
          throw new Error("工作区已关闭");
        if (existing) {
          if (existing.dirty || existing.error)
            throw new Error("文档存在未保存内容，请先处理后再运行插件");
          state.edit(workspace, path, text.replace(/\r\n/g, "\n"));
          await state.save(workspace, path);
        } else {
          const doc = await api.readDocument(workspace, path);
          await api.saveDocument(workspace, {
            ...doc,
            text:
              doc.lineEnding === "crlf"
                ? text.replace(/\r?\n/g, "\r\n")
                : text.replace(/\r\n/g, "\n"),
          });
        }
        await state.refresh(workspace);
        void state.reindex(workspace);
      },
      async list(directory) {
        if (!alive()) throw new Error("插件已停止");
        if(!builtinPlugins.includes(definition)&&definition.manifest.runtime!=="trusted")return await api.pluginFileRequest(workspace,definition.manifest.id,"list",directory) as {name:string;path:string;isDirectory:boolean}[];
        return api.listDirectory(
          workspace,
          directory,
          useApp.getState().settings.showHidden,
        );
      },
    },
    editor: {
      codeMirror,
      getText() {
        const session = useApp.getState().sessions[workspace];
        return session?.documents[session.file]?.text ?? "";
      },
      getSelection() {
        return editorActions.select(workspace);
      },
      insert(text) {
        if (!alive()) return;
        editorActions.insert(workspace, text);
      },
      replaceSelection(text) {
        if (!alive()) return;
        editorActions.insert(workspace, text, "", "", true);
      },
    },
  };
}

const external = new Map<string, PluginDefinition>();
export async function importPlugin(bundle: PluginBundle): Promise<void> {
  for (const [id, cleanup] of running)
    if (id.endsWith(":" + bundle.manifest.id)) {
      cleanup();
      running.delete(id);
    }
  for (const id of pending.keys())
    if (id.endsWith(":" + bundle.manifest.id)) cancelPending(id);
  useRegistry.setState((state) => ({
    errors: Object.fromEntries(
      Object.entries(state.errors).filter(
        ([id]) => !id.endsWith(":" + bundle.manifest.id),
      ),
    ),
  }));
  external.set(bundle.manifest.id,{
    manifest: bundle.manifest,
    async load(context) {
      if(bundle.manifest.runtime !== "trusted") return loadIsolatedPlugin(bundle,context);
      const url=URL.createObjectURL(new Blob([bundle.source],{type:"text/javascript"}));
      try {
        const module=await import(/* @vite-ignore */ url);
        const instance=new module.default();
        if(bundle.styles){const style=document.createElement("style");style.dataset.plugin=bundle.manifest.id;style.textContent=bundle.styles;document.head.append(style);context.register(()=>style.remove());}
        const cleanup=await instance.onload(context);
        return ()=>{cleanup?.();instance.onunload?.();};
      }finally{URL.revokeObjectURL(url);}
    }
  });
}
export function removePlugin(id:string):void {
  for(const [key,cleanup] of running)if(key.endsWith(":"+id)){cleanup();running.delete(key);}
  for(const key of pending.keys())if(key.endsWith(":"+id))cancelPending(key);
  external.delete(id);
}

export function definitions(): PluginDefinition[] {
  return [...builtinPlugins, ...external.values()];
}
export function synchronizePlugins(): void {
  const state = useApp.getState();
  const desired = new Set<string>();
  for (const workspace of state.order)
    for (const definition of definitions()) {
      const enabled =
        state.settings.plugins[workspace]?.[definition.manifest.id]?.enabled ??
        builtinPlugins.includes(definition);
      if (!enabled || state.settings.safeMode || !state.sessions[workspace]?.info.available) continue;
      const id = `${workspace}:${definition.manifest.id}`;
      desired.add(id);
      if (
        running.has(id) ||
        pending.has(id) ||
        useRegistry.getState().errors[id]
      )
        continue;
      const token = Symbol(id);
      pending.set(id, token);
      const dispose: Dispose[] = [];
      const cleanup = () => {
        dispose
          .splice(0)
          .reverse()
          .forEach((fn) => {
            try {
              fn();
            } catch {
              /* Continue disposing the remaining registrations. */
            }
          });
      };
      pendingCleanup.set(id, cleanup);
      void Promise.resolve()
        .then(() =>
          pending.get(id) === token
            ? definition.load(
                contextFor(
                  workspace,
                  definition,
                  dispose,
                  () =>
                    pending.get(id) === token || running.get(id) === cleanup,
                ),
              )
            : undefined,
        )
        .then((result) => {
          if (result) dispose.push(result);
          if (pending.get(id) !== token) cleanup();
          else {
            pending.delete(id);
            pendingCleanup.delete(id);
            running.set(id, cleanup);
          }
        })
        .catch((error) => {
          cleanup();
          if (pending.get(id) === token) {
            pending.delete(id);
            useRegistry.setState((state) => ({
              errors: { ...state.errors, [id]: displayError(error) },
            }));
          }
        });
    }
  for (const [id, cleanup] of running)
    if (!desired.has(id)) {
      cleanup();
      running.delete(id);
    }
  for (const id of pending.keys()) if (!desired.has(id)) cancelPending(id);
  useRegistry.setState((state) => ({
    errors: Object.fromEntries(
      Object.entries(state.errors).filter(([id]) => desired.has(id)),
    ),
  }));
}
export function disposePlugins(): void {
  running.forEach((cleanup) => cleanup());
  running.clear();
  pendingCleanup.forEach((cleanup) => cleanup());
  pendingCleanup.clear();
  pending.clear();
}
export async function processPluginBlocks(
  workspace: string,
  root: HTMLElement,
  path: string,
): Promise<Dispose[]> {
  const cleanup: Dispose[] = [];
  for (const block of blocks.values())
    if (block.workspace === workspace)
      for (const code of root.querySelectorAll<HTMLElement>(
        `code.language-${CSS.escape(block.language)}`,
      )) {
        const container = code.parentElement;
        if (!container) continue;
        try {
          const dispose = await block.render(
            code.textContent ?? "",
            container,
            path,
          );
          if (dispose) cleanup.push(dispose);
        } catch (error) {
          container.textContent = displayError(error);
        }
      }
  return cleanup;
}
