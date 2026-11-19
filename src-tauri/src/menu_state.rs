use crate::library::{AppError, Result};
use serde::Deserialize;
use tauri::{menu::MenuItemKind, WebviewWindow};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuUpdate {
    pub id: String,
    pub enabled: bool,
    pub checked: Option<bool>,
    pub shortcut: String,
}
pub fn update(window: &WebviewWindow, updates: Vec<MenuUpdate>) -> Result<()> {
    if updates.len() > 256 {
        return Err(AppError::new("MENU", "菜单配置过多"));
    }
    let menu = window
        .menu()
        .ok_or_else(|| AppError::new("MENU", "菜单不可用"))?;
    let mut resolved = Vec::new();
    for update in updates {
        if update.id.len() > 100 || update.shortcut.len() > 64 {
            return Err(AppError::new("MENU", "菜单配置无效"));
        }
        let item = menu
            .items()
            .map_err(|_| AppError::new("MENU", "菜单不可用"))?
            .into_iter()
            .find_map(|item| {
                item.as_submenu()
                    .and_then(|submenu| submenu.get(&update.id))
            });
        let item = item.ok_or_else(|| AppError::new("MENU", "未知菜单命令"))?;
        if !matches!(item, MenuItemKind::MenuItem(_) | MenuItemKind::Check(_)) {
            return Err(AppError::new("MENU", "菜单类型不支持"));
        }
        resolved.push((item, update));
    }
    // Clear old bindings first so swapped shortcuts never overlap during reassignment.
    for (item, _) in &resolved {
        match item {
            MenuItemKind::MenuItem(item) => item.set_accelerator(None::<&str>),
            MenuItemKind::Check(item) => item.set_accelerator(None::<&str>),
            _ => unreachable!(),
        }
        .map_err(|_| AppError::new("MENU", "快捷键更新失败"))?;
    }
    for (item, update) in resolved {
        let accelerator = if update.shortcut.is_empty() || update.shortcut == "Delete" {
            None
        } else {
            Some(update.shortcut.replace("Ctrl", "CmdOrCtrl"))
        };
        match item {
            MenuItemKind::MenuItem(item) => item
                .set_enabled(update.enabled)
                .and_then(|()| item.set_accelerator(accelerator.as_deref())),
            MenuItemKind::Check(item) => item
                .set_enabled(update.enabled)
                .and_then(|()| item.set_checked(update.checked.unwrap_or(false)))
                .and_then(|()| item.set_accelerator(accelerator.as_deref())),
            _ => unreachable!(),
        }
        .map_err(|_| AppError::new("MENU", "菜单更新失败"))?;
    }
    Ok(())
}
