use crate::library::{AppError,Result,SharedLibrary};
use serde::{Deserialize, Serialize};
use tauri::{Emitter,Manager,WebviewUrl,WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt,ShortcutState};
use tauri_plugin_notification::NotificationExt;
#[derive(Clone,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Preferences { pub zoom:u32,pub menu_visible:bool,pub global_shortcut:String,pub tray:bool }
pub fn apply(app:&tauri::AppHandle,preferences:Preferences)->Result<()> {
    if !(50..=200).contains(&preferences.zoom)||preferences.global_shortcut.len()>80{return Err(AppError::new("SETTINGS","桌面设置无效"));}
    for window in app.webview_windows().values(){window.set_zoom(preferences.zoom as f64/100.0).map_err(|_|AppError::new("WINDOW","缩放设置失败"))?;if preferences.menu_visible{window.show_menu().map_err(|_|AppError::new("WINDOW","显示菜单失败"))?;}else{window.hide_menu().map_err(|_|AppError::new("WINDOW","隐藏菜单失败"))?;}}
    app.global_shortcut().unregister_all().map_err(|_|AppError::new("SHORTCUT","更新全局快捷键失败"))?;
    if !preferences.global_shortcut.is_empty(){app.global_shortcut().on_shortcut(preferences.global_shortcut.as_str(),|app,_,event|{if event.state()==ShortcutState::Pressed{show(app);}}).map_err(|_|AppError::new("SHORTCUT","全局快捷键无效或已被其他应用占用"))?;}
    if let Some(tray)=app.tray_by_id("markfolio-tray"){tray.set_visible(preferences.tray).map_err(|_|AppError::new("TRAY","托盘设置失败"))?;}
    Ok(())
}
pub fn show(app:&tauri::AppHandle){if let Some(window)=app.get_webview_window("main"){let _=window.show();let _=window.unminimize();let _=window.set_focus();}}
pub fn setup(app:&tauri::App)->tauri::Result<()> {
    use tauri::{menu::{MenuBuilder,MenuItem},tray::TrayIconBuilder};
    let open=MenuItem::with_id(app,"tray.open","打开 MarkFolio",true,None::<&str>)?;
    let quit=MenuItem::with_id(app,"tray.quit","退出",true,None::<&str>)?;let menu=MenuBuilder::new(app).items(&[&open,&quit]).build()?;
    let mut tray=TrayIconBuilder::with_id("markfolio-tray").tooltip("MarkFolio").menu(&menu).on_menu_event(|app,event|{match event.id().as_ref(){"tray.open"=>show(app),"tray.quit"=>{let _=app.emit_to("main","menu-command","app.quit");},_=>{}}}).on_tray_icon_event(|tray,event|{if matches!(event,tauri::tray::TrayIconEvent::DoubleClick{..}){show(tray.app_handle());}});
    if let Some(icon)=app.default_window_icon(){tray=tray.icon(icon.clone());}tray.build(app)?;Ok(())
}
pub fn note_window(app:&tauri::AppHandle,library:&SharedLibrary,workspace:&str,path:&str)->Result<()> {
    {let library=library.lock().map_err(|_|AppError::new("STATE","文件服务不可用"))?;library.resolve(workspace,path,true)?;}
    let query=tauri::Url::parse_with_params("https://local.invalid/index.html",[("workspace",workspace),("note",path)]).map_err(|_|AppError::new("WINDOW","笔记地址无效"))?;
    let url=format!("index.html?{}",query.query().unwrap_or(""));
    WebviewWindowBuilder::new(app,format!("note-{}",uuid::Uuid::new_v4()),WebviewUrl::App(url.into())).title("MarkFolio · 笔记").inner_size(1100.0,800.0).min_inner_size(700.0,500.0).build().map_err(|_|AppError::new("WINDOW","无法创建笔记窗口"))?;Ok(())
}
pub fn reminder(app:&tauri::AppHandle,title:&str)->Result<()> {
    if title.len()>512{return Err(AppError::new("REMINDER","提醒标题过长"));}
    app.notification().builder().title("MarkFolio · 待办提醒").body(title).show().map_err(|_|AppError::new("REMINDER","系统提醒未能显示"))
}
#[derive(Clone,Serialize,Deserialize)]
pub struct Release { pub version:String,pub url:String,pub sha256:String,pub notes:String }
pub fn check_update(url:&str)->Result<Release>{let bytes=crate::library::remote_download(url,1024*1024)?;let release:Release=serde_json::from_slice(&bytes).map_err(|_|AppError::new("UPDATE","更新清单无效"))?;if !release.version.split('.').all(|p|!p.is_empty()&&p.chars().all(|c|c.is_ascii_digit()))||release.version.split('.').count()!=3||release.sha256.len()!=64||!release.sha256.chars().all(|c|c.is_ascii_hexdigit()){return Err(AppError::new("UPDATE","更新清单需要版本、下载地址和 SHA-256"));}Ok(release)}
pub fn install_update(app:&tauri::AppHandle,release:Release)->Result<()> {
    if release.sha256.len()!=64{return Err(AppError::new("UPDATE","更新校验值无效"));}
    let bytes=crate::library::remote_download(&release.url,256*1024*1024)?;
    use sha2::{Digest,Sha256};if format!("{:x}",Sha256::digest(&bytes))!=release.sha256.to_lowercase(){return Err(AppError::new("UPDATE","安装包校验失败"));}
    let directory=app.path().app_data_dir().map_err(|_|AppError::new("UPDATE","更新目录不可用"))?.join("updates");std::fs::create_dir_all(&directory)?;let file=directory.join(format!("MarkFolio-{}.exe",uuid::Uuid::new_v4()));std::fs::write(&file,bytes)?;
    std::process::Command::new(file).spawn().map_err(|_|AppError::new("UPDATE","无法启动更新安装程序"))?;Ok(())
}
