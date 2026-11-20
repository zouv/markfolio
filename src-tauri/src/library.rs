use base64::{engine::general_purpose::STANDARD, Engine};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    time::UNIX_EPOCH,
};
use tauri::Emitter;
use uuid::Uuid;

#[path = "index.rs"]
mod index;
#[path = "links.rs"]
mod links;
pub use index::NoteSummary;
pub use links::LinkResolution;
#[path = "files.rs"]
mod files;
#[allow(unused_imports)]
pub use files::{AssetEntry, TrashEntry};
#[path = "ai.rs"]
mod ai;
#[path = "crypto.rs"]
mod crypto;
#[path = "external.rs"]
mod external;
#[path = "plugin_service.rs"]
mod plugin_service;
#[allow(unused_imports)]
pub use ai::AiConfig;
#[allow(unused_imports)]
pub use external::ExternalSession;
pub fn ai_generate(config: AiConfig, prompt: &str, context: &str) -> Result<String> {
    ai::generate(config, prompt, context)
}
#[path = "transfer.rs"]
mod transfer;
pub fn plugin_repository(url: &str) -> Result<serde_json::Value> {
    plugin_service::repository(url)
}
pub fn remote_download(url: &str, limit: usize) -> Result<Vec<u8>> {
    plugin_service::download(url, limit)
}
#[allow(unused_imports)]
pub use transfer::{ImportPreview, TransferFile, TransferResult};
pub fn import_preview(source: &Path, format: &str) -> Result<ImportPreview> {
    transfer::preview(source, format)
}

pub type SharedLibrary = Arc<Mutex<Library>>;
pub type Result<T> = std::result::Result<T, AppError>;
const MAX_DOCUMENT: u64 = 16 * 1024 * 1024;

// Apply the caller's changes to the latest settings, preserving edits from other windows.
pub fn merge_settings(
    current: &serde_json::Value,
    base: &serde_json::Value,
    next: &serde_json::Value,
) -> serde_json::Value {
    if base == next {
        return current.clone();
    }
    if let (Some(before), Some(proposed)) = (base.as_object(), next.as_object()) {
        let mut merged = current.as_object().cloned().unwrap_or_default();
        for key in before.keys().chain(proposed.keys()) {
            let previous = before.get(key).unwrap_or(&serde_json::Value::Null);
            match proposed.get(key) {
                Some(value) if previous != value => {
                    merged.insert(
                        key.clone(),
                        merge_settings(
                            merged.get(key).unwrap_or(&serde_json::Value::Null),
                            previous,
                            value,
                        ),
                    );
                }
                None if before.contains_key(key) => {
                    merged.remove(key);
                }
                _ => {}
            }
        }
        serde_json::Value::Object(merged)
    } else {
        next.clone()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
}
impl AppError {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}
impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        let message = match error.kind() {
            std::io::ErrorKind::NotFound => "文件不存在或已被移走",
            std::io::ErrorKind::PermissionDenied => "没有权限访问该文件",
            std::io::ErrorKind::AlreadyExists => "目标已存在，请使用其他名称",
            _ => "文件操作失败，请检查目录权限和磁盘空间",
        };
        Self::new(
            if error.kind() == std::io::ErrorKind::NotFound {
                "NOT_FOUND"
            } else {
                "IO"
            },
            message,
        )
    }
}
impl From<rusqlite::Error> for AppError {
    fn from(_: rusqlite::Error) -> Self {
        Self::new("INDEX", "检索索引不可用，请重建索引")
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub id: String,
    pub name: String,
    pub available: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentWorkspace {
    pub id: String,
    pub name: String,
    pub available: bool,
}
#[derive(Clone, Serialize, Deserialize)]
struct WorkspaceRecord {
    id: String,
    name: String,
    root: PathBuf,
}
#[derive(Clone, Serialize, Deserialize)]
struct RecentRecord {
    id: String,
    name: String,
    root: PathBuf,
}
#[derive(Default, Serialize, Deserialize)]
struct Persisted {
    workspaces: Vec<WorkspaceRecord>,
    #[serde(default)]
    recent: Vec<RecentRecord>,
    settings: serde_json::Value,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub workspaces: Vec<WorkspaceInfo>,
    pub settings: serde_json::Value,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub modified: u64,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub path: String,
    pub text: String,
    pub version: String,
    pub encoding: String,
    pub line_ending: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub score: f64,
    pub path: String,
    pub title: String,
    pub snippet: String,
    pub modified: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginBundle {
    pub manifest: serde_json::Value,
    pub source: String,
    pub styles: String,
}

struct Workspace {
    root: PathBuf,
    changes: Arc<Mutex<std::collections::HashSet<String>>>,
    _watcher: Option<RecommendedWatcher>,
}
pub struct Library {
    data_dir: PathBuf,
    persisted: Persisted,
    opened: HashMap<String, Workspace>,
    unlocked: Mutex<HashMap<String, crypto::Unlocked>>,
    external_sessions: Mutex<std::collections::HashSet<(String, String)>>,
}

fn version(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn relative_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}
pub fn checked_relative(value: &str) -> Result<PathBuf> {
    if value.len() > 4096 || value.contains(['\0', ':', '\\']) {
        return Err(AppError::new("PATH", "路径格式无效"));
    }
    let path = Path::new(value);
    if path
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
        && !value.is_empty()
    {
        return Err(AppError::new("PATH", "路径必须位于工作目录中"));
    }
    Ok(path.to_path_buf())
}
fn hidden(name: &str) -> bool {
    name.starts_with('.') || matches!(name, "node_modules" | "target" | "$RECYCLE.BIN")
}
fn is_markdown(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
}
fn is_locked_note(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("mflock"))
}
fn modified(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
}

fn decode(bytes: &[u8]) -> Result<(String, String)> {
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let little = bytes[0] == 0xff;
        if !(bytes.len() - 2).is_multiple_of(2) {
            return Err(AppError::new("ENCODING", "UTF-16 文件内容不完整"));
        }
        let words: Vec<u16> = bytes[2..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|b| {
                if little {
                    u16::from_le_bytes([b[0], b[1]])
                } else {
                    u16::from_be_bytes([b[0], b[1]])
                }
            })
            .collect();
        return String::from_utf16(&words)
            .map(|text| (text, if little { "utf16le" } else { "utf16be" }.into()))
            .map_err(|_| AppError::new("ENCODING", "无法读取文件编码"));
    }
    let bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    String::from_utf8(if bom {
        bytes[3..].to_vec()
    } else {
        bytes.to_vec()
    })
    .map(|text| (text, if bom { "utf8bom" } else { "utf8" }.into()))
    .map_err(|_| AppError::new("ENCODING", "暂不支持此编码，请先转换为 UTF-8 或 UTF-16"))
}
fn encode(text: &str, encoding: &str) -> Result<Vec<u8>> {
    match encoding {
        "utf8" => Ok(text.as_bytes().to_vec()),
        "utf8bom" => {
            let mut bytes = vec![0xef, 0xbb, 0xbf];
            bytes.extend_from_slice(text.as_bytes());
            Ok(bytes)
        }
        "utf16le" | "utf16be" => {
            let little = encoding == "utf16le";
            let mut bytes = if little {
                vec![0xff, 0xfe]
            } else {
                vec![0xfe, 0xff]
            };
            for word in text.encode_utf16() {
                bytes.extend_from_slice(&if little {
                    word.to_le_bytes()
                } else {
                    word.to_be_bytes()
                });
            }
            Ok(bytes)
        }
        _ => Err(AppError::new("ENCODING", "编码参数无效")),
    }
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("PATH", "文件没有有效父目录"))?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".markfolio-write-")
        .tempfile_in(parent)?;
    if let Ok(metadata) = fs::metadata(path) {
        temporary
            .as_file()
            .set_permissions(metadata.permissions())?;
    }
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary
        .persist(path)
        .map_err(|e| AppError::from(e.error))?;
    Ok(())
}

impl Library {
    pub fn new(data_dir: PathBuf) -> Result<Self> {
        fs::create_dir_all(data_dir.join("indexes"))?;
        let settings_file = data_dir.join("state.json");
        let mut persisted: Persisted = match fs::read(&settings_file) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|_| AppError::new("CONFIG", "应用设置文件损坏，请保留该文件后重置设置"))?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Persisted::default(),
            Err(error) => return Err(error.into()),
        };
        // 旧版本 state.json 没有 recent 字段：用当前工作目录补一份，避免升级后菜单为空。
        if persisted.recent.is_empty() {
            persisted.recent = persisted
                .workspaces
                .iter()
                .rev()
                .map(|record| RecentRecord {
                    id: record.id.clone(),
                    name: record.name.clone(),
                    root: record.root.clone(),
                })
                .collect();
        }
        Ok(Self {
            data_dir,
            persisted,
            opened: HashMap::new(),
            unlocked: Mutex::new(HashMap::new()),
            external_sessions: Mutex::new(std::collections::HashSet::new()),
        })
    }
    fn persist(&self) -> Result<()> {
        let bytes = serde_json::to_vec_pretty(&self.persisted)
            .map_err(|_| AppError::new("CONFIG", "无法保存设置"))?;
        atomic_write(&self.data_dir.join("state.json"), &bytes)
    }
    pub fn restore(&mut self, app: &tauri::AppHandle) {
        for record in self.persisted.workspaces.clone() {
            if record.root.is_dir() {
                self.attach(record.id, record.root, Some(app));
            }
        }
    }
    fn attach(&mut self, id: String, root: PathBuf, app: Option<&tauri::AppHandle>) {
        let changes = Arc::new(Mutex::new(std::collections::HashSet::from([String::from(
            "*",
        )])));
        let watcher = app.and_then(|app| {
            let handle = app.clone();
            let workspace_id = id.clone();
            let changed = changes.clone();
            let watched_root = root.clone();
            let mut watcher =
                notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                    if event.is_ok_and(|e| {
                        if let Ok(mut paths) = changed.lock() {
                            for path in &e.paths {
                                if let Ok(relative) = path.strip_prefix(&watched_root) {
                                    let relative = relative_string(relative);
                                    if !relative.split('/').any(hidden) {
                                        paths.insert(relative);
                                    }
                                }
                            }
                            if e.need_rescan() {
                                paths.insert("*".into());
                            }
                        }
                        !matches!(e.kind, notify::EventKind::Access(_))
                            && e.paths.iter().any(|p| {
                                !p.file_name().is_some_and(|n| {
                                    n.to_string_lossy().starts_with(".markfolio-write-")
                                })
                            })
                    }) {
                        let _ = handle.emit("workspace-changed", &workspace_id);
                    }
                })
                .ok()?;
            watcher.watch(&root, RecursiveMode::Recursive).ok()?;
            Some(watcher)
        });
        self.opened.insert(
            id,
            Workspace {
                root,
                changes,
                _watcher: watcher,
            },
        );
    }
    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            workspaces: self
                .persisted
                .workspaces
                .iter()
                .map(|r| WorkspaceInfo {
                    id: r.id.clone(),
                    name: r.name.clone(),
                    available: self.opened.contains_key(&r.id),
                })
                .collect(),
            settings: if self.persisted.settings.is_object() {
                self.persisted.settings.clone()
            } else {
                serde_json::json!({})
            },
        }
    }
    pub fn recent(&self) -> Vec<RecentWorkspace> {
        self.persisted
            .recent
            .iter()
            .map(|record| RecentWorkspace {
                id: record.id.clone(),
                name: record.name.clone(),
                available: record.root.is_dir(),
            })
            .collect()
    }
    pub fn open_recent(
        &mut self,
        id: &str,
        app: Option<&tauri::AppHandle>,
    ) -> Result<WorkspaceInfo> {
        let record = self
            .persisted
            .recent
            .iter()
            .find(|record| record.id == id)
            .cloned()
            .ok_or_else(|| AppError::new("NOT_FOUND", "该工作目录不在最近打开列表中"))?;
        if !record.root.is_dir() {
            return Err(AppError::new("NOT_FOUND", "该工作目录已被移动或删除"));
        }
        self.open(record.root, app)
    }
    fn remember(&mut self, id: &str, name: &str, root: &Path) {
        self.persisted.recent.retain(|record| record.id != id);
        self.persisted.recent.insert(
            0,
            RecentRecord {
                id: id.into(),
                name: name.into(),
                root: root.to_path_buf(),
            },
        );
        self.persisted.recent.truncate(10);
    }
    pub fn open(&mut self, root: PathBuf, app: Option<&tauri::AppHandle>) -> Result<WorkspaceInfo> {
        let root = root.canonicalize()?;
        if !root.is_dir() {
            return Err(AppError::new("PATH", "请选择文件夹"));
        }
        if let Some(existing) = self
            .persisted
            .workspaces
            .iter()
            .find(|r| r.root == root)
            .cloned()
        {
            if !self.opened.contains_key(&existing.id) {
                self.attach(existing.id.clone(), root.clone(), app);
            }
            self.remember(&existing.id, &existing.name, &root);
            // 已打开目录只需要更新最近列表；写盘失败不应阻止切换工作目录。
            let _ = self.persist();
            return Ok(WorkspaceInfo {
                id: existing.id,
                name: existing.name,
                available: true,
            });
        }
        if self
            .persisted
            .workspaces
            .iter()
            .any(|r| root.starts_with(&r.root) || r.root.starts_with(&root))
        {
            return Err(AppError::new("NESTED", "已打开的工作目录不能互相嵌套"));
        }
        let identity = root.to_string_lossy().into_owned();
        #[cfg(target_os = "windows")]
        let identity = identity.to_lowercase();
        let id = version(identity.as_bytes())[..32].to_string();
        let name = root
            .file_name()
            .map_or_else(|| "工作目录".into(), |s| s.to_string_lossy().into_owned());
        self.persisted.workspaces.push(WorkspaceRecord {
            id: id.clone(),
            name: name.clone(),
            root: root.clone(),
        });
        self.attach(id.clone(), root.clone(), app);
        self.remember(&id, &name, &root);
        self.persist()?;
        Ok(WorkspaceInfo {
            id,
            name,
            available: true,
        })
    }
    pub fn close(&mut self, id: &str) -> Result<()> {
        let previous = self.persisted.workspaces.clone();
        self.persisted.workspaces.retain(|r| r.id != id);
        if let Err(error) = self.persist() {
            self.persisted.workspaces = previous;
            return Err(error);
        }
        self.unlocked
            .lock()
            .map_err(|_| AppError::new("LOCK", "解锁状态不可用"))?
            .retain(|key, _| !key.starts_with(&format!("{id}:")));
        self.opened.remove(id);
        self.update_external_sessions(id, "", None)?;
        Ok(())
    }
    pub fn save_settings(&mut self, settings: serde_json::Value) -> Result<()> {
        if !settings.is_object() || settings.to_string().len() > 1024 * 1024 {
            return Err(AppError::new("CONFIG", "设置格式无效"));
        }
        let previous = std::mem::replace(&mut self.persisted.settings, settings);
        if let Err(error) = self.persist() {
            self.persisted.settings = previous;
            return Err(error);
        }
        Ok(())
    }

    pub fn external_link(&self, value: &str) -> Result<String> {
        if value.len() > 4096 {
            return Err(AppError::new("LINK", "链接过长"));
        }
        let url = tauri::Url::parse(value).map_err(|_| AppError::new("LINK", "链接格式无效"))?;
        if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
            return Err(AppError::new("LINK", "外部链接需要使用 HTTPS"));
        }
        let host = url
            .host_str()
            .ok_or_else(|| AppError::new("LINK", "链接缺少网站名称"))?;
        let allowed = self.persisted.settings["externalLinkHosts"]
            .as_array()
            .is_some_and(|hosts| hosts.iter().any(|item| item.as_str() == Some(host)));
        if !allowed {
            return Err(AppError::new("LINK_HOST", "请先允许打开此网站的链接"));
        }
        Ok(url.into())
    }
    fn root(&self, id: &str) -> Result<&Path> {
        self.opened
            .get(id)
            .map(|w| w.root.as_path())
            .ok_or_else(|| AppError::new("WORKSPACE", "工作目录已关闭或不可用"))
    }
    pub fn resolve(&self, id: &str, path: &str, must_exist: bool) -> Result<PathBuf> {
        let root = self.root(id)?;
        let relative = checked_relative(path)?;
        let candidate = root.join(relative);
        let canonical = if must_exist || candidate.exists() {
            candidate.canonicalize()?
        } else {
            let parent = candidate
                .parent()
                .ok_or_else(|| AppError::new("PATH", "目录路径无效"))?
                .canonicalize()?;
            parent.join(
                candidate
                    .file_name()
                    .ok_or_else(|| AppError::new("PATH", "文件名无效"))?,
            )
        };
        if !canonical.starts_with(root) {
            return Err(AppError::new("PATH", "不能访问工作目录之外的文件"));
        }
        Ok(canonical)
    }
    pub fn list(&self, id: &str, path: &str, show_hidden: bool) -> Result<Vec<FileEntry>> {
        let root = self.root(id)?;
        let directory = self.resolve(id, path, true)?;
        let mut entries = Vec::new();
        for item in fs::read_dir(directory)? {
            let item = item?;
            let name = item.file_name().to_string_lossy().into_owned();
            if !show_hidden && hidden(&name) {
                continue;
            }
            let canonical = match item.path().canonicalize() {
                Ok(p) if p.starts_with(root) => p,
                _ => continue,
            };
            let metadata = fs::metadata(&canonical)?;
            entries.push(FileEntry {
                name,
                path: relative_string(
                    item.path()
                        .strip_prefix(root)
                        .map_err(|_| AppError::new("PATH", "路径无效"))?,
                ),
                is_directory: metadata.is_dir(),
                size: metadata.len(),
                modified: modified(&canonical),
            });
        }
        entries.sort_by(|a, b| {
            b.is_directory
                .cmp(&a.is_directory)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(entries)
    }
    pub fn read(&self, id: &str, path: &str) -> Result<Document> {
        let file = self.resolve(id, path, true)?;
        if fs::metadata(&file)?.len() > MAX_DOCUMENT {
            return Err(AppError::new("LARGE", "文件超过 16 MB，请使用外部编辑器"));
        }
        let bytes = fs::read(file)?;
        let clear;
        let data = if crypto::locked(&bytes) {
            clear = self.decode_locked(id, path, &bytes)?;
            &*clear
        } else {
            &bytes
        };
        let (text, encoding) = decode(data)?;
        let line_ending = if text.contains("\r\n") { "crlf" } else { "lf" }.into();
        Ok(Document {
            path: path.into(),
            text,
            encoding,
            line_ending,
            version: version(&bytes),
        })
    }
    pub fn write(
        &self,
        id: &str,
        path: &str,
        text: &str,
        expected: &str,
        encoding: &str,
    ) -> Result<Document> {
        if text.len() as u64 > MAX_DOCUMENT {
            return Err(AppError::new("LARGE", "文件超过编辑大小限制"));
        }
        let file = self.resolve(id, path, true)?;
        let current = fs::read(&file)?;
        if version(&current) != expected {
            return Err(AppError::new(
                "CONFLICT",
                "文件已被其他程序修改，请先比较或重新加载",
            ));
        }
        let clear = encode(text, encoding)?;
        let bytes = if crypto::locked(&current) {
            self.encode_locked(id, path, &clear, &current)?
        } else {
            clear
        };
        if bytes.len() as u64 > MAX_DOCUMENT {
            return Err(AppError::new("LARGE", "文件超过编辑大小限制"));
        }
        atomic_write(&file, &bytes)?;
        self.mark_changed(id, path);
        self.read(id, path)
    }
    pub fn create(&self, id: &str, path: &str, directory: bool) -> Result<()> {
        let file = self.resolve(id, path, false)?;
        if file.exists() {
            return Err(AppError::new("EXISTS", "目标已存在"));
        }
        if directory {
            fs::create_dir(file)?;
        } else {
            let _ = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(file)?;
        }
        self.mark_changed(id, path);
        Ok(())
    }
    pub fn rename(&self, id: &str, from: &str, to: &str) -> Result<()> {
        if from.is_empty() || to.is_empty() {
            return Err(AppError::new("PATH", "不能移动工作目录本身"));
        }
        let source = self.resolve(id, from, true)?;
        let target = self.resolve(id, to, false)?;
        if target.exists() {
            return Err(AppError::new("EXISTS", "目标已存在"));
        }
        if target.starts_with(&source) {
            return Err(AppError::new("PATH", "不能将文件夹移入自身"));
        }
        links::rename(self, id, from, to, &source, &target)?;
        self.update_external_sessions(id, from, Some(to))
    }
    pub fn delete(&self, id: &str, path: &str) -> Result<()> {
        if path.is_empty() {
            return Err(AppError::new("PATH", "不能删除工作目录"));
        }
        self.resolve(id, path, true)?;
        let file = self.root(id)?.join(checked_relative(path)?);
        if self.persisted.settings["trashMode"].as_str() == Some("system") {
            trash::delete(file)
                .map_err(|_| AppError::new("TRASH", "无法移入系统回收站，原文件已保留"))?;
            self.mark_changed(id, path);
        } else {
            self.recycle(id, path)?;
        }
        self.update_external_sessions(id, path, None)
    }
    pub fn duplicate(&self, id: &str, path: &str) -> Result<String> {
        let source = self.resolve(id, path, true)?;
        if !source.is_file() || !is_markdown(&source) {
            return Err(AppError::new("TYPE", "请选择 Markdown 或文本笔记"));
        }
        if fs::metadata(&source)?.len() > MAX_DOCUMENT {
            return Err(AppError::new("LARGE", "文件超过复制大小限制"));
        }
        let relative = checked_relative(path)?;
        let stem = relative
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or_else(|| AppError::new("PATH", "文件名无效"))?;
        let extension = relative
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("md");
        let parent = relative.parent().unwrap_or_else(|| Path::new(""));
        let bytes = fs::read(source)?;
        for number in 1..=10000 {
            let suffix = if number == 1 {
                "副本".to_owned()
            } else {
                format!("副本 {number}")
            };
            let destination =
                relative_string(&parent.join(format!("{stem} - {suffix}.{extension}")));
            let target = self.resolve(id, &destination, false)?;
            let mut file = match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
            {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error.into()),
            };
            if let Err(error) = file.write_all(&bytes).and_then(|()| file.sync_all()) {
                drop(file);
                let _ = fs::remove_file(target);
                return Err(error.into());
            }
            self.mark_changed(id, &destination);
            return Ok(destination);
        }
        Err(AppError::new("EXISTS", "副本名称过多，请先整理文件"))
    }
    pub fn reindex(&self, id: &str) -> Result<usize> {
        index::reindex(self, id)
    }
    pub fn mark_changed(&self, id: &str, path: &str) {
        if let Some(workspace) = self.opened.get(id) {
            if let Ok(mut changes) = workspace.changes.lock() {
                changes.insert(path.into());
            }
        }
    }
    pub fn update_index(&self, id: &str, force: bool) -> Result<usize> {
        let workspace = self
            .opened
            .get(id)
            .ok_or_else(|| AppError::new("WORKSPACE", "工作目录已关闭"))?;
        let changes = std::mem::take(
            &mut *workspace
                .changes
                .lock()
                .map_err(|_| AppError::new("INDEX", "索引状态不可用"))?,
        );
        let result = if force || changes.contains("*") {
            self.reindex(id)
        } else {
            index::refresh(self, id, Some(&changes))
        };
        if result.is_err() {
            self.mark_changed(id, "*");
        }
        result
    }
    pub fn catalog(&self, id: &str) -> Result<Vec<NoteSummary>> {
        index::catalog(self, id)
    }
    pub fn search(&self, id: &str, query: &str) -> Result<Vec<SearchHit>> {
        index::search(self, id, query)
    }
    pub fn resolve_link(
        &self,
        id: &str,
        from: &str,
        target: &str,
        wiki: bool,
    ) -> Result<LinkResolution> {
        links::resolve(self, id, from, target, wiki)
    }
    pub fn asset(&self, id: &str, path: &str) -> Result<String> {
        let file = self.resolve(id, path, true)?;
        let size = fs::metadata(&file)?.len();
        if size > 32 * 1024 * 1024 {
            return Err(AppError::new("LARGE", "附件超过预览大小限制"));
        }
        let ext = file
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
        let mime = match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            "pdf" => "application/pdf",
            "mp3" => "audio/mpeg",
            "wav" => "audio/wav",
            "ogg" => "audio/ogg",
            "m4a" => "audio/mp4",
            "mp4" => "video/mp4",
            "webm" => "video/webm",
            _ => "application/octet-stream",
        };
        Ok(format!(
            "data:{mime};base64,{}",
            STANDARD.encode(fs::read(file)?)
        ))
    }
    pub fn import_attachment(&self, id: &str, source: &Path, directory: &str) -> Result<String> {
        let destination_dir = self.resolve(id, directory, true)?;
        let name = source
            .file_name()
            .ok_or_else(|| AppError::new("PATH", "附件名称无效"))?;
        let mut destination = destination_dir.join(name);
        if destination.exists() {
            let name = source.file_stem().unwrap_or_default().to_string_lossy();
            let ext = source.extension().unwrap_or_default().to_string_lossy();
            destination = destination_dir.join(format!(
                "{name}-{}.{}",
                &Uuid::new_v4().to_string()[..8],
                ext
            ));
        }
        let mut input = fs::File::open(source)?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)?;
        if let Err(error) = std::io::copy(&mut input, &mut output).and_then(|_| output.sync_all()) {
            drop(output);
            let _ = fs::remove_file(&destination);
            return Err(error.into());
        }
        Ok(relative_string(
            destination
                .strip_prefix(self.root(id)?)
                .map_err(|_| AppError::new("PATH", "附件路径无效"))?,
        ))
    }
    pub fn plugins(&self) -> Result<Vec<PluginBundle>> {
        let directory = self.data_dir.join("plugins");
        if !directory.exists() {
            return Ok(vec![]);
        }
        let mut plugins = Vec::new();
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() || entry.file_name().to_string_lossy().starts_with('.')
            {
                continue;
            }
            if let Ok(plugin) = read_plugin(&entry.path()) {
                plugins.push(plugin);
            }
        }
        Ok(plugins)
    }
    pub fn install_plugin(&mut self, source: &Path) -> Result<PluginBundle> {
        let plugin = read_plugin(source)?;
        let id = plugin.manifest["id"]
            .as_str()
            .ok_or_else(|| AppError::new("PLUGIN", "插件缺少 ID"))?;
        let plugins = self.data_dir.join("plugins");
        fs::create_dir_all(&plugins)?;
        let directory = plugins.join(id);
        if fs::symlink_metadata(&directory).is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            return Err(AppError::new("PATH", "插件目录不能是符号链接"));
        }
        let stage = tempfile::Builder::new()
            .prefix(".install-")
            .tempdir_in(&plugins)?;
        let backup = tempfile::Builder::new()
            .prefix(".previous-")
            .tempdir_in(&plugins)?;
        let previous = backup.path().join("content");
        let manifest = serde_json::to_vec_pretty(&plugin.manifest)
            .map_err(|_| AppError::new("PLUGIN", "插件清单无效"))?;
        atomic_write(&stage.path().join("main.js"), plugin.source.as_bytes())?;
        atomic_write(&stage.path().join("styles.css"), plugin.styles.as_bytes())?;
        atomic_write(&stage.path().join("manifest.json"), &manifest)?;
        let replacing = directory.exists();
        if replacing {
            fs::rename(&directory, &previous)?;
        }
        if let Err(error) = fs::rename(stage.path(), &directory) {
            if replacing && fs::rename(&previous, &directory).is_err() {
                let _ = backup.keep();
            }
            return Err(error.into());
        }
        let settings = self.persisted.settings.clone();
        if let Some(workspaces) = self.persisted.settings["plugins"].as_object_mut() {
            for configurations in workspaces.values_mut() {
                if let Some(config) = configurations
                    .get_mut(id)
                    .and_then(serde_json::Value::as_object_mut)
                {
                    config.insert("enabled".into(), serde_json::Value::Bool(false));
                    config.insert("permissions".into(), serde_json::json!([]));
                }
            }
        }
        if let Err(error) = self.persist() {
            self.persisted.settings = settings;
            let removed = fs::rename(&directory, stage.path()).is_ok();
            let restored = !replacing || fs::rename(&previous, &directory).is_ok();
            if !removed || !restored {
                let _ = backup.keep();
                let _ = stage.keep();
                return Err(AppError::new(
                    "PLUGIN",
                    "安装未完成，插件暂存文件已保留，请检查目录权限",
                ));
            }
            return Err(error);
        }
        Ok(plugin)
    }
}

fn read_plugin(directory: &Path) -> Result<PluginBundle> {
    if fs::metadata(directory.join("manifest.json"))?.len() > 32 * 1024 {
        return Err(AppError::new("PLUGIN", "插件清单过大"));
    }
    let manifest_bytes = fs::read(directory.join("manifest.json"))?;
    if manifest_bytes.len() > 32 * 1024 {
        return Err(AppError::new("PLUGIN", "插件清单过大"));
    }
    let manifest: serde_json::Value = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| AppError::new("PLUGIN", "插件清单无效"))?;
    validate_plugin_manifest(&manifest)?;
    let main = directory.join("main.js");
    if fs::metadata(&main)?.len() > 4 * 1024 * 1024 {
        return Err(AppError::new("PLUGIN", "插件入口过大"));
    }
    let source = fs::read_to_string(main)?;
    let styles = match fs::metadata(directory.join("styles.css")) {
        Ok(metadata) if metadata.len() > 1024 * 1024 => {
            return Err(AppError::new("PLUGIN", "插件样式过大"))
        }
        Ok(_) => fs::read_to_string(directory.join("styles.css"))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.into()),
    };
    Ok(PluginBundle {
        manifest,
        source,
        styles,
    })
}
fn validate_plugin_manifest(manifest: &serde_json::Value) -> Result<()> {
    let id = manifest["id"].as_str().unwrap_or("");
    if id.is_empty()
        || id.len() > 80
        || !id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(AppError::new(
            "PLUGIN",
            "插件 ID 必须为小写字母、数字或连字符",
        ));
    }
    if ![Some(1), Some(2)].contains(&manifest["sdkVersion"].as_u64()) {
        return Err(AppError::new("PLUGIN", "插件需要 SDK 版本 1 或 2"));
    }
    for field in ["name", "version", "description"] {
        if !manifest[field].as_str().is_some_and(|value| {
            value.len() <= 2000 && (field == "description" || !value.trim().is_empty())
        }) {
            return Err(AppError::new("PLUGIN", "插件清单需要名称、版本和描述"));
        }
    }
    if ["daily-note", "markdown-tools", "word-statistics"].contains(&id) {
        return Err(AppError::new("PLUGIN", "插件 ID 与内置插件冲突"));
    }
    if manifest
        .get("runtime")
        .is_some_and(|runtime| !matches!(runtime.as_str(), Some("isolated" | "trusted")))
    {
        return Err(AppError::new("PLUGIN", "插件运行模式无效"));
    }
    if let Some(permissions) = manifest.get("permissions") {
        if !permissions.as_array().is_some_and(|values| {
            values.len() <= 20
                && values.iter().all(|value| {
                    matches!(
                        value.as_str(),
                        Some(
                            "files:read"
                                | "files:write"
                                | "editor"
                                | "commands"
                                | "views"
                                | "settings"
                                | "events"
                                | "host:full"
                        )
                    )
                })
        }) {
            return Err(AppError::new("PLUGIN", "插件权限清单无效"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn library() -> (tempfile::TempDir, Library, String, PathBuf) {
        let temp = tempfile::tempdir().expect("temporary directory");
        let root = temp.path().join("中文笔记");
        fs::create_dir(&root).expect("workspace");
        let mut lib = Library::new(temp.path().join("app")).expect("library");
        let info = lib.open(root.clone(), None).expect("open");
        (temp, lib, info.id, root)
    }
    #[test]
    fn rejects_escape_and_absolute_paths() {
        for p in [
            "../secret",
            "/etc/passwd",
            "C:/secret",
            "folder/../secret",
            "folder\\file.md",
        ] {
            assert!(checked_relative(p).is_err(), "{p}");
        }
    }
    #[test]
    fn retains_utf16_bom_and_crlf() {
        let (_t, lib, id, root) = library();
        let text = "# 中文\r\n内容\r\n";
        fs::write(
            root.join("文档.md"),
            encode(text, "utf16le").expect("encode"),
        )
        .expect("write");
        let doc = lib.read(&id, "文档.md").expect("read");
        assert_eq!(doc.text, text);
        let saved = lib
            .write(&id, "文档.md", "# 更新\r\n", &doc.version, &doc.encoding)
            .expect("save");
        assert_eq!(saved.encoding, "utf16le");
        assert_eq!(saved.line_ending, "crlf");
        assert!(fs::read(root.join("文档.md"))
            .expect("bytes")
            .starts_with(&[0xff, 0xfe]));
    }
    #[test]
    fn rejects_external_overwrite() {
        let (_t, lib, id, root) = library();
        fs::write(root.join("a.md"), "old").expect("write");
        let doc = lib.read(&id, "a.md").expect("read");
        fs::write(root.join("a.md"), "external").expect("external");
        assert_eq!(
            lib.write(&id, "a.md", "mine", &doc.version, "utf8")
                .expect_err("conflict")
                .code,
            "CONFLICT"
        );
        assert_eq!(
            fs::read_to_string(root.join("a.md")).expect("read"),
            "external"
        );
    }
    #[test]
    fn same_name_files_are_isolated() {
        let (_t, mut lib, id, root) = library();
        let root2 = root.parent().expect("parent").join("second");
        fs::create_dir(&root2).expect("dir");
        let second = lib.open(root2.clone(), None).expect("open");
        fs::write(root.join("a.md"), "A").expect("write");
        fs::write(root2.join("a.md"), "B").expect("write");
        let doc = lib.read(&id, "a.md").expect("read");
        lib.write(&id, "a.md", "A2", &doc.version, "utf8")
            .expect("save");
        assert_eq!(lib.read(&second.id, "a.md").expect("read").text, "B");
    }
    #[test]
    fn indexes_chinese_short_queries_and_parameter_like_text() {
        let (_t, lib, id, root) = library();
        fs::write(root.join("文档.md"), "# 计划\n中文内容 100% 'literal'").expect("write");
        assert_eq!(lib.reindex(&id).expect("index"), 1);
        assert_eq!(lib.search(&id, "中文").expect("search").len(), 1);
        assert_eq!(lib.search(&id, "100%").expect("search").len(), 1);
        assert!(lib.search(&id, "missing").expect("search").is_empty());
    }
    #[test]
    fn duplicate_targets_never_overwrite() {
        let (_t, lib, id, root) = library();
        fs::write(root.join("a.md"), "A").expect("write");
        fs::write(root.join("b.md"), "B").expect("write");
        assert!(lib.rename(&id, "a.md", "b.md").is_err());
        assert_eq!(lib.read(&id, "b.md").expect("read").text, "B");
    }
    #[test]
    fn duplicates_use_unique_names_and_preserve_original_bytes() {
        let (_temp, lib, id, root) = library();
        fs::create_dir(root.join("笔记")).expect("directory");
        let bytes = encode("---\r\ntags: [项目]\r\n---\r\n# 原文\r\n", "utf16le").expect("encode");
        fs::write(root.join("笔记/中文.md"), &bytes).expect("source");
        fs::write(root.join("笔记/中文 - 副本.md"), b"existing").expect("collision");
        let copy = lib.duplicate(&id, "笔记/中文.md").expect("duplicate");
        assert_eq!(copy, "笔记/中文 - 副本 2.md");
        assert_eq!(fs::read(root.join(&copy)).expect("copy bytes"), bytes);
        assert_eq!(
            fs::read(root.join("笔记/中文 - 副本.md")).expect("existing"),
            b"existing"
        );
        assert_eq!(lib.read(&id, &copy).expect("document").encoding, "utf16le");
        assert!(lib.duplicate(&id, "笔记").is_err());
        assert!(lib.duplicate(&id, "../outside.md").is_err());
    }
    #[test]
    fn failed_settings_persistence_keeps_previous_configuration() {
        let (temp, mut lib, _id, _root) = library();
        lib.save_settings(serde_json::json!({"theme":"light"}))
            .expect("initial settings");
        let state_file = temp.path().join("app/state.json");
        fs::remove_file(&state_file).expect("remove state file");
        fs::create_dir(&state_file).expect("blocked destination");
        assert!(lib
            .save_settings(serde_json::json!({"theme":"dark"}))
            .is_err());
        assert_eq!(lib.snapshot().settings["theme"], "light");
    }

    #[test]
    fn workspace_registration_and_restore_keep_roots_private() {
        let (temp, mut lib, id, root) = library();
        assert_eq!(lib.open(root.clone(), None).expect("same root").id, id);
        let nested = root.join("child");
        fs::create_dir(&nested).expect("child");
        assert_eq!(
            lib.open(nested, None).expect_err("nested root").code,
            "NESTED"
        );
        let snapshot = serde_json::to_value(lib.snapshot()).expect("snapshot");
        assert!(snapshot["settings"].is_object());
        assert!(snapshot["workspaces"][0].get("root").is_none());
        let restored = Library::new(temp.path().join("app")).expect("restored");
        assert_eq!(restored.snapshot().workspaces.len(), 1);
        lib.close(&id).expect("close");
        assert!(root.is_dir());
        assert_eq!(lib.read(&id, "a.md").expect_err("closed").code, "WORKSPACE");
        assert_eq!(lib.open(root, None).expect("reopen").id, id);
    }

    #[test]
    fn recent_workspaces_survive_close_and_open_by_opaque_id() {
        let (_temp, mut lib, id, _root) = library();
        let recent = lib.recent();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].id, id);
        assert!(recent[0].available);
        lib.close(&id).expect("close");
        let recent = lib.recent();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].id, id);
        assert!(lib.open_recent(&id, None).expect("reopen").available);
        assert_eq!(
            lib.open_recent("missing", None)
                .expect_err("unknown recent")
                .code,
            "NOT_FOUND"
        );
    }

    #[test]
    fn writes_keep_encoding_and_leave_no_retained_versions() {
        let (_temp, lib, id, root) = library();
        for encoding in ["utf8", "utf8bom", "utf16le", "utf16be"] {
            fs::write(
                root.join("a.md"),
                encode("# 原文\n", encoding).expect("encode"),
            )
            .expect("write");
            let doc = lib.read(&id, "a.md").expect("read");
            let saved = lib
                .write(&id, "a.md", "# 新文\n", &doc.version, &doc.encoding)
                .expect("save");
            assert_eq!(saved.encoding, encoding);
            assert_eq!(saved.text, "# 新文\n");
        }
        assert_eq!(fs::read_dir(root).expect("entries").count(), 1);
    }

    #[test]
    fn real_file_moves_and_duplicate_attachment_imports_preserve_content() {
        let (_temp, lib, id, root) = library();
        lib.create(&id, "目录", true).expect("directory");
        lib.create(&id, "a.md", false).expect("file");
        assert!(lib.create(&id, "a.md", false).is_err());
        let original = lib.read(&id, "a.md").expect("read");
        lib.write(&id, "a.md", "正文", &original.version, "utf8")
            .expect("write");
        lib.rename(&id, "a.md", "目录/新名.md").expect("move");
        assert!(!root.join("a.md").exists());
        assert_eq!(lib.read(&id, "目录/新名.md").expect("moved").text, "正文");
        let source = root.join("目录/新名.md");
        let imported = lib
            .import_attachment(&id, &source, "目录")
            .expect("import collision");
        assert_ne!(imported, "目录/新名.md");
        assert_eq!(lib.read(&id, &imported).expect("imported").text, "正文");
    }

    #[test]
    fn invalid_plugin_manifest_cannot_select_an_installation_path() {
        let (temp, mut lib, _id, _root) = library();
        let plugin = temp.path().join("plugin");
        fs::create_dir(&plugin).expect("dir");
        fs::write(
            plugin.join("manifest.json"),
            r#"{"id":"../outside","sdkVersion":1}"#,
        )
        .expect("manifest");
        assert_eq!(
            lib.install_plugin(&plugin).expect_err("invalid").code,
            "PLUGIN"
        );
    }

    #[test]
    fn external_links_require_https_and_the_exact_allowed_host() {
        let (_temp, mut lib, _id, _root) = library();
        assert!(lib.external_link("https://example.com/page").is_err());
        lib.save_settings(serde_json::json!({"externalLinkHosts":["example.com"]}))
            .expect("settings");
        assert_eq!(
            lib.external_link("https://example.com/page")
                .expect("allowed"),
            "https://example.com/page"
        );
        for link in [
            "http://example.com",
            "file:///secret",
            "https://evil.example.com",
            "https://example.com.evil.test",
            "https://user:password@example.com",
        ] {
            assert!(lib.external_link(link).is_err(), "{link}");
        }
    }
    #[test]
    fn settings_merge_preserves_other_window_changes_and_plugin_data() {
        let base = serde_json::json!({"theme":"light","fontSize":14,"sessions":{"a":{"file":"a.md"}},"plugins":{"a":{"p":{"enabled":true,"data":{"left":1,"right":1}}}}});
        let current = serde_json::json!({"theme":"dark","fontSize":14,"sessions":{"a":{"file":"b.md"}},"plugins":{"a":{"p":{"enabled":true,"data":{"left":2,"right":1}}}}});
        let next = serde_json::json!({"theme":"light","fontSize":18,"sessions":{"a":{"file":"a.md"}},"plugins":{"a":{"p":{"enabled":true,"data":{"left":1,"right":2}}}}});
        let merged = merge_settings(&current, &base, &next);
        assert_eq!(merged["theme"], "dark");
        assert_eq!(merged["fontSize"], 18);
        assert_eq!(merged["sessions"]["a"]["file"], "b.md");
        assert_eq!(
            merged["plugins"]["a"]["p"]["data"],
            serde_json::json!({"left":2,"right":2})
        );
    }
    #[test]
    fn incremental_index_search_dates_and_or_exclusions_follow_file_changes() {
        let (_temp, lib, id, root) = library();
        fs::write(root.join("alpha.md"),"---\ntitle: Alpha\ntags: [work]\ncreated: '2020-01-02T00:00:00Z'\nupdated: '2021-02-03T00:00:00Z'\ntype: todo\ndue: '2030-04-05T12:00:00Z'\n---\nalpha unique content\n").unwrap();
        fs::write(
            root.join("beta.md"),
            "---\ntitle: Beta\ntags: [hidden]\n---\nbeta body\n",
        )
        .unwrap();
        assert_eq!(lib.update_index(&id, false).unwrap(), 2);
        assert_eq!(
            lib.search(&id, "created:<20210101 updated:>=2021-02-03")
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            lib.search(&id, "type:todo due:=2030-04-05").unwrap().len(),
            1
        );
        assert_eq!(
            lib.search(&id, "alpha OR beta -tag:hidden").unwrap().len(),
            1
        );
        assert_eq!(
            lib.search(&id, "any:1 alpha beta -tag:hidden")
                .unwrap()
                .len(),
            1
        );
        assert_eq!(lib.search(&id, "alpha OR").unwrap().len(), 1);
        fs::create_dir(root.join("sub")).unwrap();
        lib.rename(&id, "alpha.md", "sub/alpha.md").unwrap();
        fs::write(root.join("sub/new.md"), "brand new searchable note").unwrap();
        lib.mark_changed(&id, "sub");
        assert_eq!(lib.update_index(&id, false).unwrap(), 3);
        assert_eq!(lib.search(&id, "unique").unwrap()[0].path, "sub/alpha.md");
        fs::remove_file(root.join("beta.md")).unwrap();
        lib.mark_changed(&id, "beta.md");
        assert_eq!(lib.update_index(&id, false).unwrap(), 2);
        assert!(lib.search(&id, "beta").unwrap().is_empty());
    }
    #[test]
    fn encrypted_note_roundtrip_keeps_encoding_versions_and_plaintext_out_of_index() {
        let (temp, mut lib, id, root) = library();
        let private = "PRIVATE_SENTINEL_FOR_INDEX_TEST";
        fs::write(
            root.join("private.md"),
            encode(&format!("# {private}\r\n"), "utf16le").unwrap(),
        )
        .unwrap();
        lib.update_index(&id, false).unwrap();
        assert_eq!(lib.search(&id, private).unwrap().len(), 1);
        let original = lib.read(&id, "private.md").unwrap();
        assert_eq!(
            lib.lock_action(
                &id,
                "private.md",
                "lock",
                "correct password".into(),
                Some("stale")
            )
            .unwrap_err()
            .code,
            "CONFLICT"
        );
        let path = lib
            .lock_action(
                &id,
                "private.md",
                "lock",
                "correct password".into(),
                Some(&original.version),
            )
            .unwrap();
        assert!(!root.join("private.md").exists());
        assert_eq!(lib.read(&id, &path).unwrap_err().code, "LOCKED");
        lib.update_index(&id, false).unwrap();
        assert!(lib.search(&id, private).unwrap().is_empty());
        for file in fs::read_dir(temp.path().join("app/indexes")).unwrap() {
            let bytes = fs::read(file.unwrap().path()).unwrap();
            assert!(!bytes
                .windows(private.len())
                .any(|s| s == private.as_bytes()));
        }
        assert_eq!(
            lib.lock_action(&id, &path, "unlock", "wrong password".into(), None)
                .unwrap_err()
                .code,
            "PASSWORD"
        );
        lib.lock_action(&id, &path, "unlock", "correct password".into(), None)
            .unwrap();
        let unlocked = lib.read(&id, &path).unwrap();
        assert_eq!(unlocked.encoding, "utf16le");
        let saved = lib
            .write(
                &id,
                &path,
                "# edited\r\n",
                &unlocked.version,
                &unlocked.encoding,
            )
            .unwrap();
        assert_eq!(saved.line_ending, "crlf");
        lib.update_index(&id, false).unwrap();
        assert!(lib.catalog(&id).unwrap()[0].snippet.is_empty());
        lib.lock_action(&id, &path, "close", String::new(), None)
            .unwrap();
        assert_eq!(lib.read(&id, &path).unwrap_err().code, "LOCKED");
        lib.lock_action(&id, &path, "unlock", "correct password".into(), None)
            .unwrap();
        fs::write(root.join("private.md"), "existing note").unwrap();
        assert_eq!(
            lib.lock_action(&id, &path, "decrypt", String::new(), Some(&saved.version))
                .unwrap_err()
                .code,
            "EXISTS"
        );
        assert_eq!(
            fs::read_to_string(root.join("private.md")).unwrap(),
            "existing note"
        );
        fs::remove_file(root.join("private.md")).unwrap();
        let plain = lib
            .lock_action(&id, &path, "decrypt", String::new(), Some(&saved.version))
            .unwrap();
        assert_eq!(lib.read(&id, &plain).unwrap().text, "# edited\r\n");
        assert!(fs::read(root.join(plain))
            .unwrap()
            .starts_with(&[0xff, 0xfe]));
        assert!(!root.join(path).exists());
    }
    #[test]
    fn trash_restore_never_overwrites_and_recreates_missing_parent_directories() {
        let (_temp, lib, id, root) = library();
        lib.create(&id, "sub", true).unwrap();
        fs::write(root.join("sub/note.md"), "original").unwrap();
        lib.recycle(&id, "sub/note.md").unwrap();
        let entry = lib.trash_entries(&id).unwrap().remove(0);
        fs::write(root.join("sub/note.md"), "new").unwrap();
        assert_eq!(
            lib.trash_action(&id, &entry.id, "restore")
                .unwrap_err()
                .code,
            "EXISTS"
        );
        assert_eq!(fs::read_to_string(root.join("sub/note.md")).unwrap(), "new");
        fs::remove_file(root.join("sub/note.md")).unwrap();
        fs::remove_dir(root.join("sub")).unwrap();
        lib.trash_action(&id, &entry.id, "restore").unwrap();
        assert_eq!(
            fs::read_to_string(root.join("sub/note.md")).unwrap(),
            "original"
        );
        assert!(lib.trash_entries(&id).unwrap().is_empty());
    }
    #[test]
    fn installed_plugin_permissions_versions_and_safe_mode_are_checked_on_every_request() {
        let (temp, mut lib, id, root) = library();
        let folder = temp.path().join("plugin");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("manifest.json"),r#"{"id":"permission-test","name":"Permission test","description":"Synthetic permission test","version":"1.0.0","sdkVersion":2,"runtime":"isolated","permissions":["files:read","files:write"]}"#).unwrap();
        fs::write(folder.join("main.js"), "export default class {};").unwrap();
        lib.install_plugin(&folder).unwrap();
        fs::write(root.join("note.md"), "original\r\n").unwrap();
        let config = serde_json::json!({"plugins":{&id:{"permission-test":{"enabled":true,"permissions":["files:read"]}}}});
        lib.save_settings(config.clone()).unwrap();
        let doc = lib
            .plugin_request(&id, "permission-test", "read", "note.md", "", None)
            .unwrap();
        assert_eq!(
            lib.plugin_request(
                &id,
                "permission-test",
                "write",
                "note.md",
                "new",
                Some(doc["version"].as_str().unwrap())
            )
            .unwrap_err()
            .code,
            "PERMISSION"
        );
        let mut config = config;
        config["plugins"][&id]["permission-test"]["permissions"] =
            serde_json::json!(["files:read", "files:write"]);
        lib.save_settings(config.clone()).unwrap();
        assert_eq!(
            lib.plugin_request(&id, "permission-test", "write", "note.md", "new\n", None)
                .unwrap_err()
                .code,
            "CONFLICT"
        );
        lib.plugin_request(
            &id,
            "permission-test",
            "write",
            "note.md",
            "new\n",
            doc["version"].as_str(),
        )
        .unwrap();
        assert_eq!(fs::read_to_string(root.join("note.md")).unwrap(), "new\r\n");
        assert_eq!(
            lib.plugin_request(
                &id,
                "permission-test",
                "write",
                "note.md",
                "stale",
                doc["version"].as_str()
            )
            .unwrap_err()
            .code,
            "CONFLICT"
        );
        assert_eq!(
            lib.plugin_request(
                &id,
                "permission-test",
                "read",
                ".markfolio/secret.md",
                "",
                None
            )
            .unwrap_err()
            .code,
            "PERMISSION"
        );
        config["safeMode"] = serde_json::json!(true);
        lib.save_settings(config).unwrap();
        assert_eq!(
            lib.plugin_request(&id, "permission-test", "read", "note.md", "", None)
                .unwrap_err()
                .code,
            "PERMISSION"
        );
    }
    #[test]
    fn plugin_replacement_and_uninstall_preserve_state_if_persistence_fails() {
        let (temp, mut lib, id, _root) = library();
        let source = temp.path().join("plugin-source");
        fs::create_dir(&source).unwrap();
        let manifest = serde_json::json!({"id":"transaction-test","name":"Synthetic plugin","description":"Synthetic plugin transaction","version":"1.0.0","sdkVersion":2,"permissions":["editor"]});
        fs::write(
            source.join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        fs::write(
            source.join("main.js"),
            "export default class { /* original */ }",
        )
        .unwrap();
        lib.install_plugin(&source).unwrap();
        let settings = serde_json::json!({"plugins":{&id:{"transaction-test":{"enabled":true,"permissions":["editor"],"data":{"custom":1}}}}});
        lib.save_settings(settings.clone()).unwrap();
        lib.install_plugin(&source).unwrap();
        assert_eq!(
            lib.snapshot().settings["plugins"][&id]["transaction-test"]["enabled"],
            false
        );
        assert_eq!(
            lib.snapshot().settings["plugins"][&id]["transaction-test"]["permissions"],
            serde_json::json!([])
        );
        assert_eq!(
            lib.snapshot().settings["plugins"][&id]["transaction-test"]["data"]["custom"],
            1
        );
        lib.save_settings(settings.clone()).unwrap();
        fs::write(
            source.join("main.js"),
            "export default class { /* replacement */ }",
        )
        .unwrap();
        let state_file = lib.data_dir.join("state.json");
        fs::remove_file(&state_file).unwrap();
        fs::create_dir(&state_file).unwrap();
        assert!(lib.install_plugin(&source).is_err());
        assert!(lib.plugins().unwrap()[0].source.contains("original"));
        assert_eq!(lib.snapshot().settings, settings);
        assert!(lib.uninstall_plugin("transaction-test").is_err());
        assert_eq!(lib.plugins().unwrap().len(), 1);
        assert_eq!(lib.snapshot().settings, settings);
        fs::remove_dir(&state_file).unwrap();
        lib.uninstall_plugin("transaction-test").unwrap();
        assert!(lib.plugins().unwrap().is_empty());
        assert!(lib.snapshot().settings["plugins"][&id]
            .get("transaction-test")
            .is_none());
        let mut malformed = manifest;
        malformed["permissions"] = serde_json::json!("editor");
        fs::write(
            source.join("manifest.json"),
            serde_json::to_vec(&malformed).unwrap(),
        )
        .unwrap();
        assert!(lib.install_plugin(&source).is_err());
    }
}
