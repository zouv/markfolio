mod api_server;
mod commands;
mod desktop;
mod library;
mod menu_state;
mod native_menu;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(api_server::LocalApi::default())
        .manage(desktop::ExitCoordinator::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            desktop::show(app);
            let _ = app.emit_to("main", "second-instance", args);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let mut library = library::Library::new(app.path().app_data_dir()?)
                .map_err(|e| std::io::Error::other(e.message))?;
            library.restore(app.handle());
            app.manage(Arc::new(Mutex::new(library)) as library::SharedLibrary);
            native_menu::build(app)?;
            desktop::setup(app)?;
            use tauri_plugin_deep_link::DeepLinkExt;
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            let _ = app.deep_link().register_all();
            let deep_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let _ = deep_handle.emit_to("main", "open-deep-link", event.urls());
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Focused(true))
                && window.is_visible().unwrap_or(false)
            {
                // 外部 WinShow/WinActivate 只改变 Win32 状态；聚焦时经 Tauri 同步
                // 内部可见状态，避免后续 hide/maximize 因缓存过期而失效。隐藏后的
                // 延迟焦点事件不满足可见条件，不会把窗口重新显示。
                let _ = window.show();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::app_snapshot,
            commands::open_workspace,
            commands::recent_workspaces,
            commands::open_recent_workspace,
            commands::close_workspace,
            commands::save_settings,
            commands::request_exit,
            commands::exit_response,
            commands::update_menu,
            commands::list_directory,
            commands::read_document,
            commands::save_document,
            commands::create_entry,
            commands::rename_entry,
            commands::delete_entry,
            commands::duplicate_entry,
            commands::rebuild_index,
            commands::search_documents,
            commands::read_asset,
            commands::attach_file,
            commands::list_plugins,
            commands::install_plugin,
            commands::open_local_file,
            commands::open_external_link,
            commands::catalog_documents,
            commands::resolve_note_link,
            commands::write_asset,
            commands::list_assets,
            commands::list_trash,
            commands::manage_trash,
            commands::preview_import,
            commands::commit_import,
            commands::export_documents,
            commands::uninstall_plugin,
            commands::plugin_file_request,
            commands::plugin_repository,
            commands::install_remote_plugin,
            commands::desktop_preferences,
            commands::open_note_window,
            commands::notify_reminder,
            commands::check_update,
            commands::install_update,
            commands::select_external_editor,
            commands::external_edit,
            commands::external_editor_sessions,
            commands::copy_entry_path,
            commands::reveal_entry,
            commands::lock_document,
            commands::ai_config,
            commands::configure_ai,
            commands::ai_generate,
            commands::local_api_status,
            commands::local_api_control,
            commands::initial_links,
            commands::load_remote_image
        ])
        .run(tauri::generate_context!())
        .expect("failed to run MarkFolio");
}
