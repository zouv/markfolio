import { invoke } from "@tauri-apps/api/core";
import type {
  AppInfo,
  Snapshot,
  WorkspaceInfo,
  RecentWorkspace,
  FileEntry,
  Document,
  SearchHit,
  Settings,
  PluginBundle,
  NoteSummary, LinkResolution, AssetEntry, TrashEntry,
  TransferFile, ImportPreview, TransferResult,
} from "./types";
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
export function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("app_info");
}
export function getSnapshot(): Promise<Snapshot> {
  return invoke<Snapshot>("app_snapshot");
}
export function openWorkspace(): Promise<WorkspaceInfo | null> {
  return invoke<WorkspaceInfo | null>("open_workspace");
}
export function recentWorkspaces(): Promise<RecentWorkspace[]> {
  return invoke<RecentWorkspace[]>("recent_workspaces");
}
export function openRecentWorkspace(recentId: string): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("open_recent_workspace", { recentId });
}
export function closeWorkspace(workspaceId: string): Promise<null> {
  return invoke<null>("close_workspace", { workspaceId });
}
export function isMainWindow(): boolean {
  return typeof location === "undefined" || !new URLSearchParams(location.search).has("note");
}
export function windowContext(): {workspace:string|null;note:string|null} {
  const params=new URLSearchParams(typeof location==="undefined"?"":location.search);
  return {workspace:params.get("workspace"),note:params.get("note")};
}
export function saveSettings(settings: Settings, baseSettings?: Settings): Promise<Settings> {
  return invoke<Settings>("save_settings", { settings, baseSettings });
}
export function requestExit(): Promise<string> {
  return invoke<string>("request_exit");
}
export function exitResponse(requestId: string, ready: boolean): Promise<null> {
  return invoke<null>("exit_response", { requestId, ready });
}
export type MenuUpdate = {
  id: string;
  enabled: boolean;
  checked?: boolean;
  shortcut: string;
};
export function updateMenu(updates: MenuUpdate[]): Promise<null> {
  return invoke<null>("update_menu", { updates });
}
export function listDirectory(
  workspaceId: string,
  path: string,
  showHidden: boolean,
): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_directory", {
    workspaceId,
    path,
    showHidden,
  });
}
export function readDocument(
  workspaceId: string,
  path: string,
): Promise<Document> {
  return invoke<Document>("read_document", { workspaceId, path });
}
export function saveDocument(
  workspaceId: string,
  document: Document,
): Promise<Document> {
  return invoke<Document>("save_document", {
    workspaceId,
    path: document.path,
    text: document.text,
    expectedVersion: document.version,
    encoding: document.encoding,
  });
}
export function createEntry(
  workspaceId: string,
  path: string,
  directory: boolean,
): Promise<null> {
  return invoke<null>("create_entry", { workspaceId, path, directory });
}
export function renameEntry(
  workspaceId: string,
  from: string,
  to: string,
): Promise<null> {
  return invoke<null>("rename_entry", { workspaceId, from, to });
}
export function deleteEntry(workspaceId: string, path: string): Promise<null> {
  return invoke<null>("delete_entry", { workspaceId, path });
}
export function duplicateEntry(
  workspaceId: string,
  path: string,
): Promise<string> {
  return invoke<string>("duplicate_entry", { workspaceId, path });
}
export function rebuildIndex(workspaceId: string, force = false): Promise<number> {
  return invoke<number>("rebuild_index", { workspaceId, force });
}
export function searchDocuments(
  workspaceId: string,
  query: string,
): Promise<SearchHit[]> {
  return invoke<SearchHit[]>("search_documents", { workspaceId, query });
}
export function readAsset(workspaceId: string, path: string): Promise<string> {
  return invoke<string>("read_asset", { workspaceId, path });
}
export function attachFile(
  workspaceId: string,
  directory: string,
): Promise<string | null> {
  return invoke<string | null>("attach_file", { workspaceId, directory });
}
export function listPlugins(): Promise<PluginBundle[]> {
  return invoke<PluginBundle[]>("list_plugins");
}
export function installPlugin(): Promise<PluginBundle | null> {
  return invoke<PluginBundle | null>("install_plugin");
}
export function openLocalFile(
  workspaceId: string,
  path: string,
): Promise<null> {
  return invoke<null>("open_local_file", { workspaceId, path });
}

export function copyEntryPath(
  workspaceId: string,
  path: string,
): Promise<null> {
  return invoke<null>("copy_entry_path", { workspaceId, path });
}

export function openExternalLink(url: string): Promise<null> {
  return invoke<null>("open_external_link", { url });
}
export function catalogDocuments(workspaceId: string): Promise<NoteSummary[]> {
  return invoke<NoteSummary[]>("catalog_documents", { workspaceId });
}
export function resolveNoteLink(workspaceId: string, from: string, target: string, wiki = false): Promise<LinkResolution> {
  return invoke<LinkResolution>("resolve_note_link", { workspaceId, from, target, wiki });
}
export function writeAsset(workspaceId: string, directory: string, name: string, content: string): Promise<string> {
  return invoke<string>("write_asset", { workspaceId, directory, name, content });
}
export function listAssets(workspaceId: string): Promise<AssetEntry[]> {
  return invoke<AssetEntry[]>("list_assets", { workspaceId });
}
export function listTrash(workspaceId: string): Promise<TrashEntry[]> {
  return invoke<TrashEntry[]>("list_trash", { workspaceId });
}
export function manageTrash(workspaceId: string, token: string, action: "restore" | "purge"): Promise<null> {
  return invoke<null>("manage_trash", { workspaceId, token, action });
}
export function previewImport(format:string):Promise<ImportPreview|null> {
  return invoke<ImportPreview|null>("preview_import", {format});
}
export function commitImport(workspaceId:string,directory:string,files:TransferFile[]):Promise<TransferResult> {
  return invoke<TransferResult>("commit_import",{workspaceId,directory,files});
}
export function exportDocuments(files:TransferFile[],format:"md"|"html"|"pdf"):Promise<TransferResult|null> {
  return invoke<TransferResult|null>("export_documents",{files,format});
}
export function uninstallPlugin(pluginId:string):Promise<null> {
  return invoke<null>("uninstall_plugin",{pluginId});
}
export function pluginFileRequest(workspaceId:string,pluginId:string,method:string,path:string,text="",expectedVersion?:string):Promise<unknown> {
  return invoke<unknown>("plugin_file_request",{workspaceId,pluginId,method,path,text,expectedVersion});
}
export function pluginRepository(url:string):Promise<unknown> {
  return invoke<unknown>("plugin_repository",{url});
}
export function installRemotePlugin(url:string,digest:string):Promise<PluginBundle> {
  return invoke<PluginBundle>("install_remote_plugin",{url,digest});
}
export type Release = { version:string;url:string;sha256:string;notes:string };
export function desktopPreferences(preferences:{zoom:number;menuVisible:boolean;globalShortcut:string;tray:boolean;locale:string}):Promise<null> {
  return invoke<null>("desktop_preferences",{preferences});
}
export function openNoteWindow(workspaceId:string,path:string):Promise<null> {
  return invoke<null>("open_note_window",{workspaceId,path});
}
export function notifyReminder(title:string):Promise<null> {
  return invoke<null>("notify_reminder",{title});
}
export function checkUpdate(url:string):Promise<Release> {
  return invoke<Release>("check_update",{url});
}
export function installUpdate(release:Release):Promise<null> {
  return invoke<null>("install_update",{release});
}
export function selectExternalEditor():Promise<string|null> {
  return invoke<string|null>("select_external_editor");
}
export type ExternalSession={workspace:string;path:string};
export function externalEdit(workspaceId:string,path:string,action:"start"|"stop"):Promise<ExternalSession[]> {
  return invoke<ExternalSession[]>("external_edit",{workspaceId,path,action});
}
export function externalEditorSessions():Promise<ExternalSession[]> {
  return invoke<ExternalSession[]>("external_editor_sessions");
}
export function revealEntry(workspaceId:string,path:string):Promise<null> {
  return invoke<null>("reveal_entry",{workspaceId,path});
}
export function lockDocument(workspaceId:string,path:string,action:"lock"|"unlock"|"decrypt"|"close",password="",expectedVersion?:string):Promise<string> {
  return invoke<string>("lock_document",{workspaceId,path,action,password,expectedVersion});
}
export type AiConfig={endpoint:string;model:string;hasKey:boolean};
export type ApiStatus={running:boolean;port:number;token:string;workspace:string;writable:boolean};
export function aiConfig():Promise<AiConfig>{return invoke<AiConfig>("ai_config");}
export function configureAi(endpoint:string,model:string,apiKey:string,removeKey=false):Promise<AiConfig>{return invoke<AiConfig>("configure_ai",{endpoint,model,apiKey,removeKey});}
export function aiGenerate(prompt:string,context:string):Promise<string>{return invoke<string>("ai_generate",{prompt,context});}
export function localApiStatus():Promise<ApiStatus>{return invoke<ApiStatus>("local_api_status");}
export function localApiControl(workspaceId:string,port:number,writable:boolean,action:"start"|"stop"):Promise<ApiStatus>{return invoke<ApiStatus>("local_api_control",{workspaceId,port,writable,action});}
export function initialLinks():Promise<string[]>{return invoke<string[]>("initial_links");}
export function loadRemoteImage(url:string):Promise<string>{return invoke<string>("load_remote_image",{url});}
