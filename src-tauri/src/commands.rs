use crate::library::{
    AppError, Document, FileEntry, Library, PluginBundle, RecentWorkspace, Result, SearchHit,
    SharedLibrary, Snapshot, WorkspaceInfo,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

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
pub async fn recent_workspaces(state: State<'_, SharedLibrary>) -> Result<Vec<RecentWorkspace>> {
    access(state, |lib| Ok(lib.recent())).await
}
#[tauri::command]
pub async fn open_recent_workspace(
    app: AppHandle,
    recent_id: String,
    state: State<'_, SharedLibrary>,
) -> Result<WorkspaceInfo> {
    access(state, move |lib| lib.open_recent(&recent_id, Some(&app))).await
}
#[tauri::command]
pub async fn close_workspace(
    app: AppHandle,
    workspace_id: String,
    state: State<'_, SharedLibrary>,
) -> Result<()> {
    use tauri::Manager;
    if app.webview_windows().values().any(|window| {
        window.label() != "main"
            && window.url().is_ok_and(|url| {
                url.query_pairs()
                    .any(|(key, value)| key == "workspace" && value == workspace_id)
            })
    }) {
        return Err(AppError::new("WINDOW", "请先关闭该工作目录的独立笔记窗口"));
    }
    let closed = workspace_id.clone();
    access(state, move |lib| lib.close(&workspace_id)).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let service = app.state::<crate::api_server::LocalApi>();
        if service.status()?.workspace == closed {
            service.stop()?;
            let _ = app.emit("local-api-changed", ());
        }
        Ok(())
    })
    .await
    .map_err(|_| AppError::new("API", "本地服务停止失败"))?
}
#[tauri::command]
pub async fn save_settings(
    app: AppHandle,
    window: tauri::WebviewWindow,
    settings: serde_json::Value,
    base_settings: Option<serde_json::Value>,
    state: State<'_, SharedLibrary>,
) -> Result<serde_json::Value> {
    let settings = access(state, move |lib| {
        let merged = base_settings
            .map(|base| crate::library::merge_settings(&lib.snapshot().settings, &base, &settings))
            .unwrap_or(settings);
        lib.save_settings(merged.clone())?;
        Ok(merged)
    })
    .await?;
    let _ = app.emit(
        "settings-changed",
        serde_json::json!({"origin":window.label(),"settings":settings}),
    );
    Ok(settings)
}
#[tauri::command]
pub fn request_exit(app: AppHandle) -> Result<String> {
    crate::desktop::request_exit(&app)
}
#[tauri::command]
pub fn exit_response(
    app: AppHandle,
    window: tauri::WebviewWindow,
    request_id: String,
    ready: bool,
) -> Result<()> {
    crate::desktop::exit_response(&app, window.label(), &request_id, ready)
}
#[tauri::command]
pub fn update_menu(
    window: tauri::WebviewWindow,
    updates: Vec<crate::menu_state::MenuUpdate>,
) -> Result<()> {
    crate::menu_state::update(&window, updates)
}

#[tauri::command]
pub fn initial_links(app: AppHandle) -> Vec<String> {
    use tauri_plugin_deep_link::DeepLinkExt;
    app.deep_link()
        .get_current()
        .ok()
        .flatten()
        .unwrap_or_default()
        .into_iter()
        .map(|url| url.into())
        .collect()
}
#[tauri::command]
pub async fn load_remote_image(url: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = crate::library::remote_download(&url, 16 * 1024 * 1024)?;
        let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            "image/png"
        } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
            "image/jpeg"
        } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
            "image/gif"
        } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
            "image/webp"
        } else {
            return Err(AppError::new("ASSET", "远程图片格式不支持"));
        };
        use base64::Engine;
        Ok(format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    })
    .await
    .map_err(|_| AppError::new("TASK", "图片加载未完成"))?
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
pub async fn rebuild_index(
    workspace_id: String,
    force: Option<bool>,
    state: State<'_, SharedLibrary>,
) -> Result<usize> {
    access(state, move |lib| {
        lib.update_index(&workspace_id, force.unwrap_or(false))
    })
    .await
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
pub async fn install_plugin(
    app: AppHandle,
    state: State<'_, SharedLibrary>,
) -> Result<Option<PluginBundle>> {
    let selected = rfd::AsyncFileDialog::new()
        .set_title("选择包含 manifest.json 的插件目录")
        .pick_folder()
        .await;
    let Some(folder) = selected else {
        return Ok(None);
    };
    let source = folder.path().to_path_buf();
    let (bundle, settings) = access(state, move |lib| {
        let bundle = lib.install_plugin(&source)?;
        Ok((bundle, lib.snapshot().settings))
    })
    .await?;
    let _ = app.emit(
        "settings-changed",
        serde_json::json!({"origin":"","settings":settings}),
    );
    let _ = app.emit("plugins-changed", &bundle.manifest["id"]);
    Ok(Some(bundle))
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
pub async fn uninstall_plugin(
    app: AppHandle,
    plugin_id: String,
    state: State<'_, SharedLibrary>,
) -> Result<()> {
    let removed = plugin_id.clone();
    let settings = access(state, move |lib| {
        lib.uninstall_plugin(&plugin_id)?;
        Ok(lib.snapshot().settings)
    })
    .await?;
    let _ = app.emit(
        "settings-changed",
        serde_json::json!({"origin":"","settings":settings}),
    );
    let _ = app.emit("plugins-changed", removed);
    Ok(())
}
#[tauri::command]
pub async fn plugin_file_request(
    workspace_id: String,
    plugin_id: String,
    method: String,
    path: String,
    text: String,
    expected_version: Option<String>,
    state: State<'_, SharedLibrary>,
) -> Result<serde_json::Value> {
    access(state, move |lib| {
        lib.plugin_request(
            &workspace_id,
            &plugin_id,
            &method,
            &path,
            &text,
            expected_version.as_deref(),
        )
    })
    .await
}
#[tauri::command]
pub async fn plugin_repository(url: String) -> Result<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || crate::library::plugin_repository(&url))
        .await
        .map_err(|_| AppError::new("PLUGIN", "仓库读取失败"))?
}
#[tauri::command]
pub async fn install_remote_plugin(
    app: AppHandle,
    url: String,
    digest: String,
    state: State<'_, SharedLibrary>,
) -> Result<PluginBundle> {
    let (bundle, settings) = access(state, move |lib| {
        let bundle = lib.install_remote_plugin(&url, &digest)?;
        Ok((bundle, lib.snapshot().settings))
    })
    .await?;
    let _ = app.emit(
        "settings-changed",
        serde_json::json!({"origin":"","settings":settings}),
    );
    let _ = app.emit("plugins-changed", &bundle.manifest["id"]);
    Ok(bundle)
}

#[tauri::command]
pub fn desktop_preferences(app: AppHandle, preferences: crate::desktop::Preferences) -> Result<()> {
    crate::desktop::apply(&app, preferences)
}
#[tauri::command]
pub fn open_note_window(
    app: AppHandle,
    workspace_id: String,
    path: String,
    state: State<'_, SharedLibrary>,
) -> Result<()> {
    crate::desktop::note_window(&app, state.inner(), &workspace_id, &path)
}
#[tauri::command]
pub fn notify_reminder(app: AppHandle, title: String) -> Result<()> {
    crate::desktop::reminder(&app, &title)
}
#[tauri::command]
pub async fn check_update(url: String) -> Result<crate::desktop::Release> {
    tauri::async_runtime::spawn_blocking(move || crate::desktop::check_update(&url))
        .await
        .map_err(|_| AppError::new("UPDATE", "更新检查失败"))?
}
#[tauri::command]
pub async fn install_update(app: AppHandle, release: crate::desktop::Release) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || crate::desktop::install_update(&app, release))
        .await
        .map_err(|_| AppError::new("UPDATE", "更新安装失败"))?
}
#[tauri::command]
pub async fn select_external_editor(state: State<'_, SharedLibrary>) -> Result<Option<String>> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("选择外部编辑器程序")
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let path = file.path().to_path_buf();
    access(state, move |lib| lib.set_external_editor(&path).map(Some)).await
}
#[tauri::command]
pub async fn external_edit(
    app: AppHandle,
    workspace_id: String,
    path: String,
    action: String,
    state: State<'_, SharedLibrary>,
) -> Result<Vec<crate::library::ExternalSession>> {
    access(state, move |lib| {
        lib.external_edit(&workspace_id, &path, &action)?;
        let sessions = lib.external_sessions()?;
        let _ = app.emit("external-edit-sessions", &sessions);
        Ok(sessions)
    })
    .await
}
#[tauri::command]
pub async fn external_editor_sessions(
    state: State<'_, SharedLibrary>,
) -> Result<Vec<crate::library::ExternalSession>> {
    access(state, |lib| lib.external_sessions()).await
}
#[tauri::command]
pub async fn reveal_entry(
    workspace_id: String,
    path: String,
    state: State<'_, SharedLibrary>,
) -> Result<()> {
    access(state, move |lib| lib.reveal(&workspace_id, &path)).await
}
#[tauri::command]
pub async fn lock_document(
    app: AppHandle,
    workspace_id: String,
    path: String,
    action: String,
    password: String,
    expected_version: Option<String>,
    state: State<'_, SharedLibrary>,
) -> Result<String> {
    use tauri::Manager;
    if action != "unlock"
        && app.webview_windows().values().any(|window| {
            window.label() != "main"
                && window.url().is_ok_and(|url| {
                    url.query_pairs()
                        .any(|(key, value)| key == "workspace" && value == workspace_id)
                })
        })
    {
        return Err(AppError::new(
            "WINDOW",
            "请先关闭此工作目录的独立笔记窗口，再进行锁定或加密转换",
        ));
    }
    let changed = workspace_id.clone();
    let old_path = path.clone();
    let closing = action != "unlock";
    let result = access(state, move |lib| {
        lib.lock_action(
            &workspace_id,
            &path,
            &action,
            password,
            expected_version.as_deref(),
        )
    })
    .await?;
    if closing {
        let _ = app.emit(
            "note-locked",
            serde_json::json!({"workspace":changed,"path":old_path}),
        );
    }
    Ok(result)
}

#[tauri::command]
pub async fn ai_config(state: State<'_, SharedLibrary>) -> Result<crate::library::AiConfig> {
    access(state, |lib| lib.ai_config()).await
}
#[tauri::command]
pub async fn configure_ai(
    endpoint: String,
    model: String,
    api_key: String,
    remove_key: bool,
    state: State<'_, SharedLibrary>,
) -> Result<crate::library::AiConfig> {
    access(state, move |lib| {
        lib.configure_ai(&endpoint, &model, api_key, remove_key)
    })
    .await
}
#[tauri::command]
pub async fn ai_generate(
    prompt: String,
    context: String,
    state: State<'_, SharedLibrary>,
) -> Result<String> {
    let config = access(state, |lib| lib.ai_config()).await?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::library::ai_generate(config, &prompt, &context)
    })
    .await
    .map_err(|_| AppError::new("AI", "AI 请求失败"))?
}
#[tauri::command]
pub async fn local_api_status(app: AppHandle) -> Result<crate::api_server::ApiStatus> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        app.state::<crate::api_server::LocalApi>().status()
    })
    .await
    .map_err(|_| AppError::new("API", "服务状态不可用"))?
}
#[tauri::command]
pub async fn local_api_control(
    app: AppHandle,
    workspace_id: String,
    port: u16,
    writable: bool,
    action: String,
    library: State<'_, SharedLibrary>,
) -> Result<crate::api_server::ApiStatus> {
    let library = library.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let service = app.state::<crate::api_server::LocalApi>();
        let status = match action.as_str() {
            "start" => service.start(app.clone(), library, workspace_id, port, writable),
            "stop" => service.stop(),
            _ => Err(AppError::new("API", "服务操作无效")),
        }?;
        let _ = app.emit("local-api-changed", ());
        Ok(status)
    })
    .await
    .map_err(|_| AppError::new("API", "本地服务操作未完成"))?
}
