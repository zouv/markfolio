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
#[path = "transfer.rs"]
mod transfer;
#[path="plugin_service.rs"]
mod plugin_service;
pub fn plugin_repository(url:&str)->Result<serde_json::Value>{plugin_service::repository(url)}
pub fn remote_download(url:&str,limit:usize)->Result<Vec<u8>>{plugin_service::download(url,limit)}
#[allow(unused_imports)]
pub use transfer::{ImportPreview, TransferFile, TransferResult};
pub fn import_preview(source: &Path, format: &str) -> Result<ImportPreview> {
    transfer::preview(source, format)
}

pub type SharedLibrary = Arc<Mutex<Library>>;
pub type Result<T> = std::result::Result<T, AppError>;
const MAX_DOCUMENT: u64 = 16 * 1024 * 1024;

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
#[derive(Clone, Serialize, Deserialize)]
struct WorkspaceRecord {
    id: String,
    name: String,
    root: PathBuf,
}
#[derive(Default, Serialize, Deserialize)]
struct Persisted {
    workspaces: Vec<WorkspaceRecord>,
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
    _watcher: Option<RecommendedWatcher>,
}
pub struct Library {
    data_dir: PathBuf,
    persisted: Persisted,
    opened: HashMap<String, Workspace>,
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
        let persisted = match fs::read(&settings_file) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|_| AppError::new("CONFIG", "应用设置文件损坏，请保留该文件后重置设置"))?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Persisted::default(),
            Err(error) => return Err(error.into()),
        };
        Ok(Self {
            data_dir,
            persisted,
            opened: HashMap::new(),
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
        let watcher = app.and_then(|app| {
            let handle = app.clone();
            let workspace_id = id.clone();
            let mut watcher =
                notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                    if event.is_ok_and(|e| {
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
                self.attach(existing.id.clone(), root, app);
            }
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
        self.attach(id.clone(), root, app);
        self.persist()?;
        Ok(WorkspaceInfo {
            id,
            name,
            available: true,
        })
    }
    pub fn close(&mut self, id: &str) -> Result<()> {
        self.opened.remove(id);
        self.persisted.workspaces.retain(|r| r.id != id);
        self.persist()
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
        let (text, encoding) = decode(&bytes)?;
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
        let bytes = encode(text, encoding)?;
        if bytes.len() as u64 > MAX_DOCUMENT {
            return Err(AppError::new("LARGE", "文件超过编辑大小限制"));
        }
        atomic_write(&file, &bytes)?;
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
        links::rename(self, id, from, to, &source, &target)
    }
    pub fn delete(&self, id: &str, path: &str) -> Result<()> {
        if path.is_empty() {
            return Err(AppError::new("PATH", "不能删除工作目录"));
        }
        self.resolve(id, path, true)?;
        let file = self.root(id)?.join(checked_relative(path)?);
        if self.persisted.settings["trashMode"].as_str() == Some("system") {
            trash::delete(file)
                .map_err(|_| AppError::new("TRASH", "无法移入系统回收站，原文件已保留"))
        } else {
            self.recycle(id, path)
        }
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
            return Ok(destination);
        }
        Err(AppError::new("EXISTS", "副本名称过多，请先整理文件"))
    }
    pub fn reindex(&self, id: &str) -> Result<usize> {
        index::reindex(self, id)
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
            _ => return Err(AppError::new("ASSET", "该附件请使用系统程序打开")),
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
        std::io::copy(&mut input, &mut output)?;
        output.sync_all()?;
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
            if !entry.file_type()?.is_dir() {
                continue;
            }
            if let Ok(plugin) = read_plugin(&entry.path()) {
                plugins.push(plugin);
            }
        }
        Ok(plugins)
    }
    pub fn install_plugin(&self, source: &Path) -> Result<PluginBundle> {
        let plugin = read_plugin(source)?;
        let id = plugin.manifest["id"]
            .as_str()
            .ok_or_else(|| AppError::new("PLUGIN", "插件缺少 ID"))?;
        let directory = self.data_dir.join("plugins").join(id);
        fs::create_dir_all(&directory)?;
        let manifest = serde_json::to_vec_pretty(&plugin.manifest)
            .map_err(|_| AppError::new("PLUGIN", "插件清单无效"))?;
        atomic_write(&directory.join("main.js"), plugin.source.as_bytes())?;
        atomic_write(&directory.join("styles.css"), plugin.styles.as_bytes())?;
        atomic_write(&directory.join("manifest.json"), &manifest)?;
        Ok(plugin)
    }
}

fn read_plugin(directory: &Path) -> Result<PluginBundle> {
    let manifest_bytes = fs::read(directory.join("manifest.json"))?;
    if manifest_bytes.len() > 32 * 1024 {
        return Err(AppError::new("PLUGIN", "插件清单过大"));
    }
    let manifest: serde_json::Value = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| AppError::new("PLUGIN", "插件清单无效"))?;
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
    if ![Some(1),Some(2)].contains(&manifest["sdkVersion"].as_u64()) {
        return Err(AppError::new("PLUGIN", "插件需要 SDK 版本 1 或 2"));
    }
    for field in ["name", "version", "description"] {
        if manifest[field].as_str().is_none() {
            return Err(AppError::new("PLUGIN", "插件清单需要名称、版本和描述"));
        }
    }
    if ["daily-note", "markdown-tools", "word-statistics"].contains(&id) {
        return Err(AppError::new("PLUGIN", "插件 ID 与内置插件冲突"));
    }
    let main = directory.join("main.js");
    if fs::metadata(&main)?.len() > 4 * 1024 * 1024 {
        return Err(AppError::new("PLUGIN", "插件入口过大"));
    }
    let source = fs::read_to_string(main)?;
    let styles = match fs::read_to_string(directory.join("styles.css")) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.into()),
    };
    if styles.len() > 1024 * 1024 {
        return Err(AppError::new("PLUGIN", "插件样式过大"));
    }
    Ok(PluginBundle {
        manifest,
        source,
        styles,
    })
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
        let (temp, lib, _id, _root) = library();
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
}
