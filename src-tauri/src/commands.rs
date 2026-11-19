use crate::library::{
    AppError, Document, FileEntry, Library, PluginBundle, Result, SearchHit, SharedLibrary,
    Snapshot, WorkspaceInfo,
};
use serde::Serialize;
use tauri::{AppHandle, State};

async fn access<T: Send + 'static>(
    state: State<'_, SharedLibrary>,
    action: impl FnOnce(&mut Library) -> Result<T> + Send + 'static,
) -> Result<T> {
    let library = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut library = library
            .lock()
            .map_err(|_| AppError::new("STATE", "应用状态暂不可用"))?;
        action(&mut library)
    })
    .await
    .map_err(|_| AppError::new("TASK", "后台任务未完成"))?
}

#[derive(Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}
#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        name: "MarkFolio".into(),
        version: app.package_info().version.to_string(),
    }
}
#[tauri::command]
pub async fn app_snapshot(state: State<'_, SharedLibrary>) -> Result<Snapshot> {
    access(state, |lib| Ok(lib.snapshot())).await
}
#[tauri::command]
pub async fn open_workspace(
    app: AppHandle,
    state: State<'_, SharedLibrary>,
) -> Result<Option<WorkspaceInfo>> {
    let directory = rfd::AsyncFileDialog::new()
        .set_title("打开 MarkFolio 工作目录")
        .pick_folder()
        .await;
    let Some(directory) = directory else {
        return Ok(None);
    };
    let root = directory.path().to_path_buf();
    access(state, move |lib| lib.open(root, Some(&app)).map(Some)).await
}
#[tauri::command]
pub async fn close_workspace(workspace_id: String, state: State<'_, SharedLibrary>) -> Result<()> {
    access(state, move |lib| lib.close(&workspace_id)).await
}
#[tauri::command]
pub async fn save_settings(
    settings: serde_json::Value,
    state: State<'_, SharedLibrary>,
) -> Result<()> {
    access(state, move |lib| lib.save_settings(settings)).await
}
#[tauri::command]
pub fn update_menu(app: AppHandle, updates: Vec<crate::menu_state::MenuUpdate>) -> Result<()> {
    crate::menu_state::update(&app, updates)
}
#[tauri::command]
pub async fn list_directory(
    workspace_id: String,
    path: String,
    show_hidden: bool,
    state: State<'_, SharedLibrary>,
) -> Result<Vec<FileEntry>> {
    access(state, move |lib| {
        lib.list(&workspace_id, &path, show_hidden)
    })
    .await
}
#[tauri::command]
pub async fn read_document(
    workspace_id: String,
    path: String,
    state: State<'_, SharedLibrary>,
) -> Result<Document> {
    access(state, move |lib| lib.read(&workspace_id, &path)).await
}
#[tauri::command]
pub async fn save_document(
    workspace_id: String,
    path: String,
    text: String,
    expected_version: String,
    encoding: String,
    state: State<'_, SharedLibrary>,
) -> Result<Document> {
    access(state, move |lib| {
        lib.write(&workspace_id, &path, &text, &expected_version, &encoding)
    })
    .await
}
#[tauri::command]
pub async fn create_entry(
    workspace_id: String,
    path: String,
    directory: bool,
    state: State<'_, SharedLibrary>,
) -> Result<()> {
    access(state, move |lib| {
        lib.create(&workspace_id, &path, directory)
    })
    .await
}
#[tauri::command]
pub async fn rename_entry(
    workspace_id: String,
    from: String,
    to: String,
    state: State<'_, SharedLibrary>,
) -> Result<()> {
    access(state, move |lib| lib.rename(&workspace_id, &from, &to)).await
}
#[tauri::command]
pub async fn delete_entry(
    workspace_id: String,
    path: String,
    state: State<'_, SharedLibrary>,
) -> Result<()> {
    access(state, move |lib| lib.delete(&workspace_id, &path)).await
}
#[tauri::command]
pub async fn duplicate_entry(
    workspace_id: String,
    path: String,
    state: State<'_, SharedLibrary>,
) -> Result<String> {
    access(state, move |lib| lib.duplicate(&workspace_id, &path)).await
}
#[tauri::command]
pub async fn rebuild_index(workspace_id: String, state: State<'_, SharedLibrary>) -> Result<usize> {
    access(state, move |lib| lib.reindex(&workspace_id)).await
}
#[tauri::command]
pub async fn search_documents(
    workspace_id: String,
    query: String,
    state: State<'_, SharedLibrary>,
) -> Result<Vec<SearchHit>> {
    access(state, move |lib| lib.search(&workspace_id, &query)).await
}
#[tauri::command]
pub async fn read_asset(
    workspace_id: String,
    path: String,
    state: State<'_, SharedLibrary>,
) -> Result<String> {
    access(state, move |lib| lib.asset(&workspace_id, &path)).await
}
#[tauri::command]
pub async fn attach_file(
    workspace_id: String,
    directory: String,
    state: State<'_, SharedLibrary>,
) -> Result<Option<String>> {
    let selected = rfd::AsyncFileDialog::new()
        .set_title("选择附件")
        .pick_file()
        .await;
    let Some(file) = selected else {
        return Ok(None);
    };
    let source = file.path().to_path_buf();
    access(state, move |lib| {
        lib.import_attachment(&workspace_id, &source, &directory)
            .map(Some)
    })
    .await
}
#[tauri::command]
pub async fn list_plugins(state: State<'_, SharedLibrary>) -> Result<Vec<PluginBundle>> {
    access(state, |lib| lib.plugins()).await
}
#[tauri::command]
pub async fn install_plugin(state: State<'_, SharedLibrary>) -> Result<Option<PluginBundle>> {
    let selected = rfd::AsyncFileDialog::new()
        .set_title("选择包含 manifest.json 的可信插件目录")
        .pick_folder()
        .await;
    let Some(folder) = selected else {
        return Ok(None);
    };
    let source = folder.path().to_path_buf();
    access(state, move |lib| lib.install_plugin(&source).map(Some)).await
}
#[tauri::command]
pub async fn open_local_file(
    workspace_id: String,
    path: String,
    state: State<'_, SharedLibrary>,
) -> Result<()> {
    access(state, move |lib| {
        let path = lib.resolve(&workspace_id, &path, true)?;
        #[cfg(target_os = "windows")]
        let result = std::process::Command::new("explorer.exe").arg(path).spawn();
        #[cfg(target_os = "macos")]
        let result = std::process::Command::new("open").arg(path).spawn();
        #[cfg(target_os = "linux")]
        let result = std::process::Command::new("xdg-open").arg(path).spawn();
        result.map_err(|_| AppError::new("OPEN", "无法使用系统程序打开文件"))?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn open_external_link(url: String, state: State<'_, SharedLibrary>) -> Result<()> {
    access(state, move |lib| {
        let url = lib.external_link(&url)?;
        #[cfg(target_os = "windows")]
        let result = std::process::Command::new("explorer.exe").arg(url).spawn();
        #[cfg(target_os = "macos")]
        let result = std::process::Command::new("open").arg(url).spawn();
        #[cfg(target_os = "linux")]
        let result = std::process::Command::new("xdg-open").arg(url).spawn();
        result.map_err(|_| AppError::new("OPEN", "无法打开系统浏览器"))?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn catalog_documents(
    workspace_id: String,
    state: State<'_, SharedLibrary>,
) -> Result<Vec<crate::library::NoteSummary>> {
    access(state, move |lib| lib.catalog(&workspace_id)).await
}
#[tauri::command]
pub async fn resolve_note_link(
    workspace_id: String,
    from: String,
    target: String,
    wiki: bool,
    state: State<'_, SharedLibrary>,
) -> Result<crate::library::LinkResolution> {
    access(state, move |lib| {
        lib.resolve_link(&workspace_id, &from, &target, wiki)
    })
    .await
}
#[tauri::command]
pub async fn write_asset(
    workspace_id: String,
    directory: String,
    name: String,
    content: String,
    state: State<'_, SharedLibrary>,
) -> Result<String> {
    access(state, move |lib| {
        lib.write_blob(&workspace_id, &directory, &name, &content)
    })
    .await
}
#[tauri::command]
pub async fn list_assets(
    workspace_id: String,
    state: State<'_, SharedLibrary>,
) -> Result<Vec<crate::library::AssetEntry>> {
    access(state, move |lib| lib.assets(&workspace_id)).await
}
#[tauri::command]
pub async fn list_trash(
    workspace_id: String,
    state: State<'_, SharedLibrary>,
) -> Result<Vec<crate::library::TrashEntry>> {
    access(state, move |lib| lib.trash_entries(&workspace_id)).await
}
#[tauri::command]
pub async fn manage_trash(
    workspace_id: String,
    token: String,
    action: String,
    state: State<'_, SharedLibrary>,
) -> Result<()> {
    access(state, move |lib| {
        lib.trash_action(&workspace_id, &token, &action)
    })
    .await
}

#[tauri::command]
pub async fn preview_import(format: String) -> Result<Option<crate::library::ImportPreview>> {
    if !["jex", "raw", "enex", "html", "onenote"].contains(&format.as_str()) {
        return Err(AppError::new("IMPORT", "导入格式无效"));
    }
    let dialog = rfd::AsyncFileDialog::new().set_title("选择要导入的导出文件或目录");
    let selected = if format == "raw" {
        dialog.pick_folder().await
    } else {
        dialog.pick_file().await
    };
    let Some(file) = selected else {
        return Ok(None);
    };
    let source = file.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        crate::library::import_preview(&source, &format).map(Some)
    })
    .await
    .map_err(|_| AppError::new("IMPORT", "导入读取失败"))?
}
#[tauri::command]
pub async fn commit_import(
    workspace_id: String,
    directory: String,
    files: Vec<crate::library::TransferFile>,
    state: State<'_, SharedLibrary>,
) -> Result<crate::library::TransferResult> {
    access(state, move |lib| {
        lib.commit_import(&workspace_id, &directory, files)
    })
    .await
}
#[tauri::command]
pub async fn export_documents(
    files: Vec<crate::library::TransferFile>,
    format: String,
    state: State<'_, SharedLibrary>,
) -> Result<Option<crate::library::TransferResult>> {
    let Some(folder) = rfd::AsyncFileDialog::new()
        .set_title("选择导出目录")
        .pick_folder()
        .await
    else {
        return Ok(None);
    };
    let destination = folder.path().to_path_buf();
    access(state, move |lib| {
        lib.export_batch(&destination, files, &format).map(Some)
    })
    .await
}

#[tauri::command]
pub async fn uninstall_plugin(plugin_id:String,state:State<'_,SharedLibrary>)->Result<()>{access(state,move |lib|lib.uninstall_plugin(&plugin_id)).await}
#[tauri::command]
pub async fn plugin_file_request(workspace_id:String,plugin_id:String,method:String,path:String,text:String,state:State<'_,SharedLibrary>)->Result<serde_json::Value>{access(state,move |lib|lib.plugin_request(&workspace_id,&plugin_id,&method,&path,&text)).await}
#[tauri::command]
pub async fn plugin_repository(url:String)->Result<serde_json::Value>{tauri::async_runtime::spawn_blocking(move ||crate::library::plugin_repository(&url)).await.map_err(|_|AppError::new("PLUGIN","仓库读取失败"))?}
#[tauri::command]
pub async fn install_remote_plugin(url:String,digest:String,state:State<'_,SharedLibrary>)->Result<PluginBundle>{access(state,move |lib|lib.install_remote_plugin(&url,&digest)).await}
