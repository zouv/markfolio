mod commands;
mod library;
mod menu_state;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

fn menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
    let make = |id: &str, label: &str, shortcut: Option<&str>| {
        MenuItem::with_id(app, id, label, true, shortcut)
    };
    let open = make("workspace.open", "打开工作目录…", Some("CmdOrCtrl+O"))?;
    let close = make("workspace.close", "关闭工作目录", Some("CmdOrCtrl+Shift+W"))?;
    let new = make("file.new", "新建笔记", Some("CmdOrCtrl+N"))?;
    let folder = make("folder.new", "新建文件夹", Some("CmdOrCtrl+Shift+N"))?;
    let save = make("file.save", "保存", Some("CmdOrCtrl+S"))?;
    let print = make("file.print", "打印 / 导出 PDF…", Some("CmdOrCtrl+P"))?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = make("app.quit", "退出", Some("CmdOrCtrl+Q"))?;
    let file = Submenu::with_items(
        app,
        "文件",
        true,
        &[&open, &close, &sep, &new, &folder, &save, &print, &quit],
    )?;
    let undo = make("edit.undo", "撤销", Some("CmdOrCtrl+Z"))?;
    let redo = make("edit.redo", "重做", Some("CmdOrCtrl+Shift+Z"))?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let select = PredefinedMenuItem::select_all(app, None)?;
    let find = make("edit.find", "查找 / 替换", Some("CmdOrCtrl+F"))?;
    let edit = Submenu::with_items(
        app,
        "编辑",
        true,
        &[&undo, &redo, &cut, &copy, &paste, &select, &find],
    )?;
    let sidebar =
        CheckMenuItem::with_id(app, "view.sidebar", "显示侧栏", true, true, None::<&str>)?;
    let list = CheckMenuItem::with_id(app, "view.list", "显示文件列表", true, true, None::<&str>)?;
    let layout = make("view.cycle", "切换编辑布局", Some("CmdOrCtrl+L"))?;
    let reset = make("view.reset", "重置布局", None)?;
    let view = Submenu::with_items(app, "视图", true, &[&sidebar, &list, &layout, &reset])?;
    let back = make("nav.back", "后退", Some("Alt+Left"))?;
    let forward = make("nav.forward", "前进", Some("Alt+Right"))?;
    let focus_search = make("focus.search", "聚焦全文搜索", Some("CmdOrCtrl+Shift+F"))?;
    let focus_tree = make("focus.tree", "聚焦文件树", None)?;
    let focus_list = make("focus.list", "聚焦文档列表", None)?;
    let focus_editor = make("focus.editor", "聚焦编辑器", None)?;
    let go = Submenu::with_items(
        app,
        "转到",
        true,
        &[
            &back,
            &forward,
            &focus_search,
            &focus_tree,
            &focus_list,
            &focus_editor,
        ],
    )?;
    let rename = make("file.rename", "重命名", Some("F2"))?;
    let attach = make("file.attach", "附加文件…", None)?;
    let properties = make("file.properties", "文档属性", None)?;
    let external = make("file.external", "使用系统程序打开", None)?;
    let duplicate = make("file.duplicate", "复制笔记", Some("CmdOrCtrl+D"))?;
    let move_files = make("file.move", "移动选中文件…", None)?;
    let delete_files = make("file.delete", "选中文件移入回收站…", None)?;
    let select_files = make("files.selectAll", "选中全部文件", None)?;
    let note = Submenu::with_items(
        app,
        "笔记",
        true,
        &[
            &rename,
            &attach,
            &properties,
            &external,
            &duplicate,
            &move_files,
            &delete_files,
            &select_files,
        ],
    )?;
    let settings = make("app.settings", "选项…", Some("CmdOrCtrl+,"))?;
    let palette = make("app.palette", "命令面板", Some("CmdOrCtrl+Shift+P"))?;
    let plugins = make("app.plugins", "插件管理", None)?;
    let reindex = make("index.rebuild", "重建搜索索引", None)?;
    let tools = Submenu::with_items(
        app,
        "工具",
        true,
        &[&palette, &settings, &plugins, &reindex],
    )?;
    let about = make("app.about", "关于 MarkFolio", None)?;
    let help = Submenu::with_items(app, "帮助", true, &[&about])?;
    app.set_menu(Menu::with_items(
        app,
        &[&file, &edit, &view, &go, &note, &tools, &help],
    )?)?;
    app.on_menu_event(|app, event| {
        let _ = app.emit("menu-command", event.id().as_ref());
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let mut library = library::Library::new(app.path().app_data_dir()?)
                .map_err(|e| std::io::Error::other(e.message))?;
            library.restore(app.handle());
            app.manage(Arc::new(Mutex::new(library)) as library::SharedLibrary);
            menu(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::app_snapshot,
            commands::open_workspace,
            commands::close_workspace,
            commands::save_settings,
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
            commands::install_remote_plugin
        ])
        .run(tauri::generate_context!())
        .expect("failed to run MarkFolio");
}
