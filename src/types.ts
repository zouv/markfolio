import { t } from "./i18n";
export type AppInfo = { name: string; version: string };
export type WorkspaceInfo = { id: string; name: string; available: boolean };
export type RecentWorkspace = { id: string; name: string; available: boolean };
export type FileEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: number;
};
export type Document = {
  path: string;
  text: string;
  version: string;
  encoding: string;
  lineEnding: "lf" | "crlf";
};
export type SearchHit = {
  path: string;
  title: string;
  snippet: string;
  modified: number;
  score?: number;
};
export type NoteSummary = {
  path: string; name: string; title: string; modified: number; created: number;
  size: number; metadata: import("./metadata").NoteMetadata; snippet: string;
};
export type LinkResolution = { path: string; fragment: string; candidates: string[] };
export type AssetEntry = { path: string; size: number; modified: number; references: string[] };
export type TrashEntry = { id: string; path: string; deleted: number };
export type TransferFile = { path:string; content:string; binary:boolean };
export type ImportPreview = { format:string; files:TransferFile[]; warnings:string[] };
export type TransferResult = { count:number; directory:string };
export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  sdkVersion: number;
  permissions?: string[];
  runtime?: "isolated" | "trusted";
  author?: string;
};
export type PluginBundle = {
  manifest: PluginManifest;
  source: string;
  styles: string;
};
export type Settings = {
  theme: "light" | "dark" | "system";
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  autoSave: boolean;
  autoSaveDelay: number;
  showHidden: boolean;
  showSidebar: boolean;
  showList: boolean;
  showNoteCounts: boolean;
  uncompletedTodosOnTop: boolean;
  showCompletedTodos: boolean;
  tabMovesFocus: boolean;
  layoutCycle: "split-editor-preview" | "editor-preview" | "editor-split" | "split-preview";
  mode: "split" | "editor" | "preview";
  wordWrap: boolean;
  lineNumbers: boolean;
  sidebarWidth: number;
  listWidth: number;
  sort: "name" | "modified" | "created" | "size" | "manual";
  perFolderSort:boolean;
  folderSorts:Record<string,Record<string,{sort:Settings["sort"];reverseSort:boolean}>>;
  folderSort:"name"|"modified";
  folderSortReverse:boolean;
  manualOrder: Record<string, string[]>;
  listStyle: "cards" | "details";
  editorMode: "markdown" | "rich";
  keyMode: "default" | "vim" | "emacs";
  spellcheck: boolean;
  inlineWidgets: boolean;
  htmlPaste: boolean;
  previewFontSize: number;
  previewFontFamily: string;
  previewWidth: number;
  customCss: string;
  rawHtml: boolean;
  remoteImages: boolean;
  zoom: number;
  layoutOrder: "tree-list-editor" | "tree-editor-list" | "list-tree-editor" | "list-editor-tree" | "editor-tree-list" | "editor-list-tree";
  menuVisible: boolean;
  locale: "zh-CN" | "en";
  indexMaxMb: number;
  bufferLimit: number;
  updateLinks: boolean;
  trashMode: "app" | "system";
  safeMode: boolean;
  tray: boolean;
  minimizeToTray: boolean;
  globalShortcut: string;
  updateUrl: string;
  pluginRepositories: string[];
  reverseSort: boolean;
  math: boolean;
  diagrams: boolean;
  markdownExtensions: MarkdownExtensions;
  shortcuts: Record<string, string>;
  externalLinkHosts: string[];
  activeWorkspace: string;
  sessions: Record<
    string,
    { folder: string; file: string; expanded: string[] }
  >;
  plugins: Record<string, Record<string, { enabled: boolean; data: unknown; permissions?:string[] }>>;
};
export type Snapshot = {
  workspaces: WorkspaceInfo[];
  settings: Partial<Settings>;
};
export type MarkdownExtensions = { footnotes:boolean; mark:boolean; sub:boolean; sup:boolean; deflist:boolean; abbr:boolean; ins:boolean; multiTable:boolean; toc:boolean; abc:boolean; fountain:boolean };
export const defaultMarkdownExtensions:MarkdownExtensions={footnotes:true,mark:true,sub:true,sup:true,deflist:true,abbr:true,ins:true,multiTable:true,toc:true,abc:true,fountain:true};
export const defaultSettings: Settings = {
  theme: "light",
  fontSize: 15,
  fontFamily: 'Consolas, "Microsoft YaHei", monospace',
  lineHeight: 1.75,
  autoSave: true,
  autoSaveDelay: 1200,
  showHidden: false,
  showSidebar: true,
  showList: true,
  showNoteCounts: true,
  uncompletedTodosOnTop: true,
  showCompletedTodos: true,
  tabMovesFocus: false,
  layoutCycle: "split-editor-preview",
  mode: "split",
  wordWrap: true,
  lineNumbers: true,
  sidebarWidth: 246,
  listWidth: 276,
  sort: "name",
  perFolderSort:false,folderSorts:{},folderSort:"name",folderSortReverse:false,
  manualOrder: {}, listStyle: "cards", editorMode: "markdown", keyMode: "default",
  spellcheck: false, inlineWidgets: true, htmlPaste: true,
  previewFontSize: 16, previewFontFamily: '"Microsoft YaHei", sans-serif', previewWidth: 860,
  customCss: "", rawHtml: true, remoteImages: false, zoom: 100,
  layoutOrder: "tree-list-editor", menuVisible: false, locale: "zh-CN",
  indexMaxMb: 512, bufferLimit: 24, updateLinks: true, trashMode: "app",
  safeMode: false, tray: true, minimizeToTray: false, globalShortcut: "Ctrl+Alt+M",
  updateUrl: "", pluginRepositories: [],
  reverseSort: false,
  math: true,
  diagrams: true,
  markdownExtensions: defaultMarkdownExtensions,
  shortcuts: {},
  externalLinkHosts: [],
  activeWorkspace: "",
  sessions: {},
  plugins: {},
};
export function displayError(error: unknown): string {
  if (typeof error === "object" && error && "message" in error)
    return t(String(error.message));
  return typeof error === "string" ? error : t("操作未完成，请重试");
}
export function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
export function joinPath(directory: string, name: string): string {
  return directory ? `${directory}/${name}` : name;
}
export function resolveLink(document: string, link: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(link.split("#")[0]);
  } catch {
    return null;
  }
  if (
    !decoded ||
    /^[a-z][a-z\d+.-]*:/i.test(decoded) ||
    decoded.startsWith("/")
  )
    return null;
  const parts = parentPath(document).split("/").filter(Boolean);
  for (const part of decoded.split("/")) {
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}
export function relativeLink(from: string, to: string): string {
  const origin = parentPath(from).split("/").filter(Boolean);
  const target = to.split("/");
  while (origin.length && target.length && origin[0] === target[0]) {
    origin.shift();
    target.shift();
  }
  return [...origin.map(() => ".."), ...target]
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export type Dialog = {
  type:
    | "new-file"
    | "new-todo"
    | "new-folder"
    | "rename"
    | "move"
    | "batch-move"
    | "batch-delete"
    | "delete"
    | "settings"
    | "palette"
    | "properties"
    | "statistics"
    | "about"
    | "conflict";
  workspace?: string;
  path?: string;
  paths?: string[];
  tab?: string;
};
