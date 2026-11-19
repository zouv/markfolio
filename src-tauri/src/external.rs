use super::*;
#[derive(Serialize, Deserialize)]
struct EditorConfig {
    executable: PathBuf,
}
#[derive(Clone, Debug, Serialize)]
pub struct ExternalSession {
    pub workspace: String,
    pub path: String,
}
impl Library {
    pub fn external_sessions(&self) -> Result<Vec<ExternalSession>> {
        let mut sessions = self
            .external_sessions
            .lock()
            .map_err(|_| AppError::new("EDITOR", "外部编辑状态不可用"))?
            .iter()
            .map(|(workspace, path)| ExternalSession {
                workspace: workspace.clone(),
                path: path.clone(),
            })
            .collect::<Vec<_>>();
        sessions.sort_by(|a, b| (&a.workspace, &a.path).cmp(&(&b.workspace, &b.path)));
        Ok(sessions)
    }
    pub(super) fn update_external_sessions(
        &self,
        workspace: &str,
        from: &str,
        to: Option<&str>,
    ) -> Result<()> {
        let mut sessions = self
            .external_sessions
            .lock()
            .map_err(|_| AppError::new("EDITOR", "外部编辑状态不可用"))?;
        let moving = sessions
            .iter()
            .filter(|(id, path)| {
                id == workspace
                    && (from.is_empty() || path == from || path.starts_with(&format!("{from}/")))
            })
            .cloned()
            .collect::<Vec<_>>();
        for (id, path) in moving {
            sessions.remove(&(id.clone(), path.clone()));
            if let Some(to) = to {
                sessions.insert((id, format!("{to}{}", &path[from.len()..])));
            }
        }
        Ok(())
    }
    pub fn set_external_editor(&self, path: &Path) -> Result<String> {
        let executable = path.canonicalize()?;
        if !executable.is_file() {
            return Err(AppError::new("EDITOR", "请选择编辑器程序"));
        }
        #[cfg(target_os = "windows")]
        if !executable
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("exe"))
        {
            return Err(AppError::new("EDITOR", "请选择 EXE 编辑器"));
        }
        let name = executable
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let bytes = serde_json::to_vec(&EditorConfig { executable })
            .map_err(|_| AppError::new("EDITOR", "编辑器配置无效"))?;
        atomic_write(&self.data_dir.join("external-editor.json"), &bytes)?;
        Ok(name)
    }
    pub fn external_edit(&self, id: &str, path: &str, action: &str) -> Result<()> {
        checked_relative(path)?;
        self.root(id)?;
        if action == "stop" {
            return self.update_external_sessions(id, path, None);
        }
        if action != "start" {
            return Err(AppError::new("EDITOR", "外部编辑操作无效"));
        }
        let file = self.resolve(id, path, true)?;
        if is_locked_note(&file) {
            return Err(AppError::new("LOCK", "加密笔记不能交给外部程序"));
        }
        let configured = fs::read(self.data_dir.join("external-editor.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<EditorConfig>(&b).ok());
        let mut child = if let Some(config) = configured {
            std::process::Command::new(config.executable)
                .arg(file)
                .spawn()
                .map_err(|_| AppError::new("EDITOR", "无法启动外部编辑器"))?
        } else {
            #[cfg(target_os = "windows")]
            let program = "explorer.exe";
            #[cfg(target_os = "macos")]
            let program = "open";
            #[cfg(target_os = "linux")]
            let program = "xdg-open";
            std::process::Command::new(program)
                .arg(file)
                .spawn()
                .map_err(|_| AppError::new("EDITOR", "无法打开外部编辑器"))?
        };
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        self.external_sessions
            .lock()
            .map_err(|_| AppError::new("EDITOR", "外部编辑状态不可用"))?
            .insert((id.to_string(), path.to_string()));
        Ok(())
    }
    pub fn reveal(&self, id: &str, path: &str) -> Result<()> {
        let file = self.resolve(id, path, true)?;
        #[cfg(target_os = "windows")]
        let child = std::process::Command::new("explorer.exe")
            .arg(format!("/select,{}", file.display()))
            .spawn();
        #[cfg(target_os = "macos")]
        let child = std::process::Command::new("open")
            .arg("-R")
            .arg(&file)
            .spawn();
        #[cfg(target_os = "linux")]
        let child = std::process::Command::new("xdg-open")
            .arg(
                file.parent()
                    .ok_or_else(|| AppError::new("PATH", "文件位置无效"))?,
            )
            .spawn();
        let mut child = child.map_err(|_| AppError::new("EDITOR", "无法定位文件"))?;
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn external_sessions_follow_file_moves_deletions_and_workspace_closure() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("vault");
        fs::create_dir(&root).unwrap();
        fs::create_dir(root.join("folder")).unwrap();
        fs::write(root.join("folder/note.md"), "body").unwrap();
        let mut library = Library::new(temp.path().join("data")).unwrap();
        let id = library.open(root.clone(), None).unwrap().id;
        library
            .external_sessions
            .lock()
            .unwrap()
            .insert((id.clone(), "folder/note.md".into()));
        library.rename(&id, "folder", "moved").unwrap();
        assert_eq!(
            library.external_sessions().unwrap()[0].path,
            "moved/note.md"
        );
        assert!(library.external_edit(&id, "../outside.md", "stop").is_err());
        library.external_edit(&id, "moved/note.md", "stop").unwrap();
        assert!(library.external_sessions().unwrap().is_empty());
        library
            .external_sessions
            .lock()
            .unwrap()
            .insert((id.clone(), "moved/note.md".into()));
        library.delete(&id, "moved").unwrap();
        assert!(library.external_sessions().unwrap().is_empty());
        library
            .external_sessions
            .lock()
            .unwrap()
            .insert((id.clone(), "untracked.md".into()));
        library.close(&id).unwrap();
        assert!(library.external_sessions().unwrap().is_empty());
    }
}
