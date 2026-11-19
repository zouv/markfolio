use super::*;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub id: String,
    pub path: String,
    pub deleted: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetEntry {
    pub path: String,
    pub size: u64,
    pub modified: u64,
    pub references: Vec<String>,
}
impl Library {
    pub fn state_dir(&self, id: &str) -> Result<PathBuf> {
        let root = self.root(id)?;
        let path = root.join(".markfolio");
        if !path.exists() {
            fs::create_dir(&path)?;
        }
        let actual = path.canonicalize()?;
        if !actual.starts_with(root) {
            return Err(AppError::new("PATH", "工作目录配置路径越界"));
        }
        Ok(actual)
    }
    pub fn write_blob(
        &self,
        id: &str,
        directory: &str,
        name: &str,
        content: &str,
    ) -> Result<String> {
        if content.len() > 44 * 1024 * 1024
            || name.is_empty()
            || name.len() > 200
            || name.contains(['/', '\\', ':', '\0', '<', '>', '"', '|', '?', '*'])
            || name.starts_with('.')
        {
            return Err(AppError::new("ASSET", "附件名称或大小无效"));
        }
        let bytes = STANDARD
            .decode(content)
            .map_err(|_| AppError::new("ASSET", "附件内容无效"))?;
        let dir = self.resolve(id, directory, true)?;
        let mut target = dir.join(name);
        if target.exists() {
            let stem = Path::new(name)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy();
            let ext = Path::new(name)
                .extension()
                .unwrap_or_default()
                .to_string_lossy();
            target = dir.join(format!("{stem}-{}.{ext}", &Uuid::new_v4().to_string()[..8]));
        }
        let mut out = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)?;
        if let Err(error) = out.write_all(&bytes).and_then(|()| out.sync_all()) {
            drop(out);
            let _ = fs::remove_file(&target);
            return Err(error.into());
        }
        Ok(relative_string(
            target
                .strip_prefix(self.root(id)?)
                .map_err(|_| AppError::new("PATH", "附件路径无效"))?,
        ))
    }
    pub fn assets(&self, id: &str) -> Result<Vec<AssetEntry>> {
        let paths = links::paths(self, id)?;
        let notes: Vec<_> = paths
            .iter()
            .filter(|p| is_markdown(Path::new(p)))
            .filter_map(|p| {
                self.read(id, p)
                    .ok()
                    .map(|d| (p, links::references(&d.text, p, &paths)))
            })
            .collect();
        let mut result = Vec::new();
        for path in paths
            .iter()
            .filter(|p| !is_markdown(Path::new(p)) && !is_locked_note(Path::new(p)))
        {
            let file = self.resolve(id, path, true)?;
            let references = notes
                .iter()
                .filter(|(_, references)| references.contains(path))
                .map(|(p, _)| (*p).clone())
                .collect();
            result.push(AssetEntry {
                path: path.clone(),
                size: fs::metadata(&file)?.len(),
                modified: modified(&file),
                references,
            });
        }
        Ok(result)
    }
    pub fn recycle(&self, id: &str, path: &str) -> Result<()> {
        if path.is_empty() || path.starts_with(".markfolio") {
            return Err(AppError::new("PATH", "不能删除工作目录及其配置"));
        }
        self.resolve(id, path, true)?;
        let trash = self.ensure_directory(id, ".markfolio/trash")?;
        let token = Uuid::new_v4().to_string();
        let slot = trash.join(&token);
        fs::create_dir(&slot)?;
        let entry = TrashEntry {
            id: token,
            path: path.to_owned(),
            deleted: std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |d| d.as_millis() as u64),
        };
        let json =
            serde_json::to_vec(&entry).map_err(|_| AppError::new("TRASH", "无法保存删除记录"))?;
        atomic_write(&slot.join("entry.json"), &json)?;
        if let Err(error) = fs::rename(
            self.root(id)?.join(checked_relative(path)?),
            slot.join("content"),
        ) {
            let _ = fs::remove_dir_all(slot);
            return Err(error.into());
        }
        self.mark_changed(id, path);
        Ok(())
    }
    pub fn trash_entries(&self, id: &str) -> Result<Vec<TrashEntry>> {
        let dir = self.state_dir(id)?.join("trash");
        if !dir.exists() {
            return Ok(vec![]);
        }
        let mut entries = Vec::new();
        for item in fs::read_dir(dir)? {
            let item = item?;
            if !item.file_type()?.is_dir() {
                continue;
            }
            let slot = item.path();
            if let Ok(bytes) = fs::read(slot.join("entry.json")) {
                if let Ok(entry) = serde_json::from_slice::<TrashEntry>(&bytes) {
                    if slot.join("content").exists() {
                        entries.push(entry);
                    }
                }
            }
        }
        entries.sort_by_key(|e| std::cmp::Reverse(e.deleted));
        Ok(entries)
    }
    pub fn trash_action(&self, id: &str, token: &str, action: &str) -> Result<()> {
        Uuid::parse_str(token).map_err(|_| AppError::new("TRASH", "删除记录无效"))?;
        let slot = self.state_dir(id)?.join("trash").join(token);
        let actual = slot.canonicalize()?;
        if !actual.starts_with(self.state_dir(id)?.join("trash")) {
            return Err(AppError::new("PATH", "删除记录路径无效"));
        }
        if action == "purge" {
            trash::delete(actual).map_err(|_| AppError::new("TRASH", "无法清空此删除记录"))?;
            return Ok(());
        }
        if action != "restore" {
            return Err(AppError::new("TRASH", "操作无效"));
        }
        let entry: TrashEntry = serde_json::from_slice(&fs::read(actual.join("entry.json"))?)
            .map_err(|_| AppError::new("TRASH", "删除记录无效"))?;
        let destination = self.root(id)?.join(checked_relative(&entry.path)?);
        if destination.exists() {
            return Err(AppError::new(
                "EXISTS",
                "原位置已有文件，请先重命名或移动它",
            ));
        }
        if let Some((parent, _)) = entry.path.rsplit_once('/') {
            self.ensure_directory(id, parent)?;
        }
        let checked = self.resolve(id, &entry.path, false)?;
        fs::rename(actual.join("content"), checked)?;
        self.mark_changed(id, &entry.path);
        fs::remove_file(actual.join("entry.json"))?;
        fs::remove_dir(actual)?;
        Ok(())
    }
}
