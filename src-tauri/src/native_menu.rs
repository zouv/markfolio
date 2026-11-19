use serde::Deserialize;
use tauri::{App, AppHandle, Emitter, Manager};
#[derive(Deserialize)]
struct Group {
    name: String,
    commands: Vec<Item>,
}
#[derive(Deserialize)]
struct Item {
    id: String,
    title: String,
}
pub fn translate(message: &str, locale: &str) -> String {
    if locale != "en" {
        return message.into();
    }
    static MESSAGES: std::sync::OnceLock<std::collections::HashMap<String, String>> =
        std::sync::OnceLock::new();
    MESSAGES
        .get_or_init(|| {
            serde_json::from_str(include_str!("../../src/translations.json")).unwrap_or_default()
        })
        .get(message)
        .cloned()
        .unwrap_or_else(|| message.into())
}
pub fn create(app: &AppHandle, locale: &str) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{CheckMenuItem, MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder};
    let groups: Vec<Group> = serde_json::from_str(include_str!("../menu.json"))
        .map_err(|e| tauri::Error::Io(std::io::Error::other(e.to_string())))?;
    let mut menu = MenuBuilder::new(app);
    for group in groups {
        let mut submenu = SubmenuBuilder::new(app, translate(&group.name, locale));
        for command in group.commands {
            // 自定义标题栏下快捷键由 WebView 命令系统统一处理；原生菜单只保留命令项，
            // 不再注册加速键，避免同一按键触发两次。
            let shortcut: Option<&str> = None;
            if [
                "view.sidebar",
                "view.list",
                "view.noteCounts",
                "view.todoTop",
                "view.completedTodos",
                "view.tabFocus",
                "view.sortName",
                "view.sortModified",
                "view.sortCreated",
                "view.sortSize",
                "view.sortManual",
                "view.sortReverse",
                "view.perFolderSort",
                "view.folderSortName",
                "view.folderSortModified",
                "view.folderSortReverse",
            ]
            .contains(&command.id.as_str())
            {
                submenu = submenu.item(&CheckMenuItem::with_id(
                    app,
                    &command.id,
                    translate(&command.title, locale),
                    true,
                    true,
                    shortcut,
                )?);
            } else {
                submenu = submenu.item(&MenuItem::with_id(
                    app,
                    &command.id,
                    translate(&command.title, locale),
                    true,
                    shortcut,
                )?);
            }
        }
        if group.name == "编辑" {
            submenu = submenu
                .separator()
                .item(&PredefinedMenuItem::cut(
                    app,
                    Some(&translate("剪切", locale)),
                )?)
                .item(&PredefinedMenuItem::copy(
                    app,
                    Some(&translate("复制内容", locale)),
                )?)
                .item(&PredefinedMenuItem::paste(
                    app,
                    Some(&translate("粘贴", locale)),
                )?);
        }
        menu = menu.item(&submenu.build()?);
    }
    menu.build()
}
pub fn localize(menu: &tauri::menu::Menu<tauri::Wry>, locale: &str) -> tauri::Result<()> {
    let groups: Vec<Group> = serde_json::from_str(include_str!("../menu.json"))
        .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;
    for (item, group) in menu.items()?.into_iter().zip(groups) {
        if let Some(submenu) = item.as_submenu() {
            submenu.set_text(translate(&group.name, locale))?;
            for command in group.commands {
                if let Some(item) = submenu.get(&command.id) {
                    if let Some(item) = item.as_menuitem() {
                        item.set_text(translate(&command.title, locale))?;
                    }
                    if let Some(item) = item.as_check_menuitem() {
                        item.set_text(translate(&command.title, locale))?;
                    }
                }
            }
            if group.name == "编辑" {
                let items = submenu.items()?;
                let labels = ["剪切", "复制内容", "粘贴"];
                for (item, label) in items.iter().rev().take(3).rev().zip(labels) {
                    if let Some(item) = item.as_predefined_menuitem() {
                        item.set_text(translate(label, locale))?;
                    }
                }
            }
        }
    }
    Ok(())
}
pub fn build(app: &App) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.set_menu(create(app.handle(), "zh-CN")?)?;
    }
    app.on_menu_event(|app, event| {
        if let Some(window) = app
            .webview_windows()
            .into_values()
            .find(|w| w.is_focused().unwrap_or(false))
        {
            let _ = window.emit("menu-command", event.id().as_ref());
        }
    });
    Ok(())
}
