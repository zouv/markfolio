import { invoke } from "@tauri-apps/api/core";
import type {
  AppInfo,
  Snapshot,
  WorkspaceInfo,
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
export function closeWorkspace(workspaceId: string): Promise<null> {
  return invoke<null>("close_workspace", { workspaceId });
}
export function saveSettings(settings: Settings): Promise<null> {
  return invoke<null>("save_settings", { settings });
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
export function rebuildIndex(workspaceId: string): Promise<number> {
  return invoke<number>("rebuild_index", { workspaceId });
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
export function pluginFileRequest(workspaceId:string,pluginId:string,method:string,path:string,text=""):Promise<unknown> {
  return invoke<unknown>("plugin_file_request",{workspaceId,pluginId,method,path,text});
}
export function pluginRepository(url:string):Promise<unknown> {
  return invoke<unknown>("plugin_repository",{url});
}
export function installRemotePlugin(url:string,digest:string):Promise<PluginBundle> {
  return invoke<PluginBundle>("install_remote_plugin",{url,digest});
}
