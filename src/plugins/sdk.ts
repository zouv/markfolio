import type { Extension } from "@codemirror/state";
import type { PluginManifest } from "../types";

export type Dispose = () => void;
export type PluginEventName = "file:opened" | "file:changed" | "file:saved" | "file:renamed" | "file:deleted" | "workspace:activated" | "settings:changed";
export type PluginEvent = { type:PluginEventName; path?:string; previousPath?:string };
export type PluginCommand = {
  id: string;
  name: string;
  shortcut?: string;
  run(): void | Promise<void>;
};
export type SettingField = {
  key: string;
  label: string;
  type: "text" | "number" | "toggle";
  description?: string;
  defaultValue?: string | number | boolean;
};
export function validateFields(fields: SettingField[]): SettingField[] {
  if(!Array.isArray(fields)||fields.length>80)throw new Error("Invalid plugin fields");
  const keys=new Set<string>();
  for(const field of fields){if(!field||typeof field.key!=="string"||!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(field.key)||["__proto__","constructor","prototype"].includes(field.key)||keys.has(field.key)||typeof field.label!=="string"||field.label.length>300||!["text","number","toggle"].includes(field.type)||field.defaultValue!==undefined&&!["string","number","boolean"].includes(typeof field.defaultValue))throw new Error("Invalid plugin field");keys.add(field.key);}
  return fields;
}
export type PluginContext = {
  readonly workspace: { id: string; name: string };
  readonly manifest: PluginManifest;
  addCommand(command: PluginCommand): Dispose;
  addSettings(fields: SettingField[]): Dispose;
  registerEditorExtension(extension: Extension): Dispose;
  registerCodeBlock(
    language: string,
    render: (
      source: string,
      element: HTMLElement,
      path: string,
    ) => void | Dispose | Promise<void | Dispose>,
  ): Dispose;
  registerPanel(
    id: string,
    title: string,
    render: (element: HTMLElement) => void | Dispose,
  ): Dispose;
  register(dispose: Dispose): void;
  onFileChange(callback: () => void): Dispose;
  loadData<T>(defaults: T): T;
  saveData(data: unknown): Promise<void>;
  notice(message: string): void;
  onEvent(name:PluginEventName,callback:(event:PluginEvent)=>void):Dispose;
  addMenuItem(id:string,title:string,command:string):Dispose;
  addToolbarItem(id:string,title:string,command:string):Dispose;
  registerHtmlPanel(id:string,title:string,html:string):Dispose;
  registerListColumn(key:string,title:string,render:(note:import("../types").NoteSummary)=>string|Promise<string>):Dispose;
  showDialog(title:string,fields:SettingField[]):Promise<Record<string,unknown>|null>;
  files: {
    read(path: string): Promise<string>;
    write(path: string, text: string): Promise<void>;
    list(
      directory: string,
    ): Promise<{ name: string; path: string; isDirectory: boolean }[]>;
  };
  editor: {
    readonly codeMirror: {
      state: typeof import("@codemirror/state");
      view: typeof import("@codemirror/view");
    };
    getText(): string;
    getSelection(): string;
    insert(text: string): void;
    replaceSelection(text: string): void;
  };
};
export type PluginDefinition = {
  manifest: PluginManifest;
  load(context: PluginContext): Promise<void | Dispose> | void | Dispose;
};
