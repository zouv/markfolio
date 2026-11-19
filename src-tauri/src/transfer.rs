use super::*;
use quick_xml::{events::Event, Reader};
use std::io::Read;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferFile {
    pub path: String,
    pub content: String,
    pub binary: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub format: String,
    pub files: Vec<TransferFile>,
    pub warnings: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferResult {
    pub count: usize,
    pub directory: String,
}
fn filename(value: &str) -> String {
    let mut name: String = value
        .chars()
        .filter(|c| !c.is_control())
        .map(|c| if "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .take(120)
        .collect();
    name = name.trim().trim_matches('.').to_owned();
    if name.is_empty() {
        "Untitled".into()
    } else {
        name
    }
}
fn yaml(properties: &serde_json::Value) -> String {
    serde_yaml::to_string(properties).unwrap_or_default()
}
fn html_markdown(html: &str) -> String {
    let media = regex::Regex::new(r#"<en-media[^>]*hash=["']([^"']+)["'][^>]*>"#)
        .expect("static media pattern");
    let html = media.replace_all(html, |c: &regex::Captures<'_>| {
        format!("<img src=\"resource:{}\" alt=\"attachment\" />", &c[1])
    });
    let todo = html
        .replace("<en-todo checked=\"true\"/>", "[x] ")
        .replace("<en-todo checked=\"false\"/>", "[ ] ")
        .replace("<en-todo/>", "[ ] ");
    html2md::parse_html(&todo)
}
fn archives(source: &Path) -> Result<Vec<(String, Vec<u8>)>> {
    let mut result = Vec::new();
    let mut total = 0usize;
    if source.is_dir() {
        let mut stack = vec![source.to_path_buf()];
        while let Some(dir) = stack.pop() {
            for item in fs::read_dir(dir)? {
                let item = item?;
                if item.file_type()?.is_symlink() {
                    continue;
                }
                if item.file_type()?.is_dir() {
                    stack.push(item.path());
                } else {
                    let size = item.metadata()?.len();
                    if size > 128 * 1024 * 1024 {
                        return Err(AppError::new("IMPORT", "单个导入文件超过 128 MB"));
                    }
                    let bytes = fs::read(item.path())?;
                    total += bytes.len();
                    if total > 256 * 1024 * 1024 {
                        return Err(AppError::new("IMPORT", "请分批导入，每批最多 256 MB"));
                    }
                    result.push((
                        relative_string(
                            item.path()
                                .strip_prefix(source)
                                .map_err(|_| AppError::new("IMPORT", "导入路径无效"))?,
                        ),
                        bytes,
                    ));
                }
            }
        }
    } else if source
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("zip"))
    {
        let input = fs::File::open(source)?;
        let mut archive =
            zip::ZipArchive::new(input).map_err(|_| AppError::new("IMPORT", "ZIP 文件无效"))?;
        for i in 0..archive.len() {
            let mut item = archive
                .by_index(i)
                .map_err(|_| AppError::new("IMPORT", "ZIP 条目无效"))?;
            if item.is_dir() {
                continue;
            }
            let enclosed = item
                .enclosed_name()
                .ok_or_else(|| AppError::new("IMPORT", "ZIP 包含越界路径"))?;
            if item.size() > 128 * 1024 * 1024 {
                return Err(AppError::new("IMPORT", "ZIP 条目过大"));
            }
            let mut bytes = Vec::new();
            item.read_to_end(&mut bytes)?;
            total += bytes.len();
            if total > 256 * 1024 * 1024 {
                return Err(AppError::new("IMPORT", "请分批导入，每批最多 256 MB"));
            }
            result.push((relative_string(&enclosed), bytes));
        }
    } else {
        let mut archive = tar::Archive::new(fs::File::open(source)?);
        for entry in archive.entries()? {
            let mut entry = entry?;
            if !entry.header().entry_type().is_file() {
                continue;
            }
            let path = relative_string(&entry.path()?);
            checked_relative(&path)?;
            if entry.size() > 128 * 1024 * 1024 {
                return Err(AppError::new("IMPORT", "JEX 条目过大"));
            }
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes)?;
            total += bytes.len();
            if total > 256 * 1024 * 1024 {
                return Err(AppError::new("IMPORT", "请分批导入，每批最多 256 MB"));
            }
            result.push((path, bytes));
        }
    }
    Ok(result)
}
fn joplin(source: &Path, format: &str) -> Result<ImportPreview> {
    let entries = archives(source)?;
    let mut records = HashMap::new();
    let mut resources = HashMap::new();
    for (name, bytes) in entries {
        if name.ends_with(".md") && !name.contains("resources/") {
            let (text, _) = decode(&bytes)?;
            let at = text.rfind("\nid: ");
            let (content, fields) =
                at.map_or((text.as_str(), ""), |i| (&text[..i], &text[i + 1..]));
            let mut meta = HashMap::new();
            for line in fields.lines() {
                if let Some((k, v)) = line.split_once(": ") {
                    meta.insert(k.to_owned(), v.to_owned());
                }
            }
            let id = meta.get("id").cloned().unwrap_or_else(|| {
                Path::new(&name)
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned()
            });
            let (title, body) = content.split_once('\n').unwrap_or((content, ""));
            records.insert(id, (title.trim().to_owned(), body.trim().to_owned(), meta));
        } else {
            resources.insert(name, bytes);
        }
    }
    let folder_path = |parent: &str| -> String {
        let mut parts = Vec::new();
        let mut id = parent.to_owned();
        let mut seen = std::collections::HashSet::new();
        while let Some((title, _, m)) = records.get(&id) {
            if !seen.insert(id.clone()) {
                break;
            }
            parts.push(filename(title));
            id = m.get("parent_id").cloned().unwrap_or_default();
        }
        parts.reverse();
        parts.join("/")
    };
    let mut paths = HashMap::new();
    let mut used = std::collections::HashSet::new();
    for (id, (title, _, m)) in &records {
        if m.get("type_").map(String::as_str).unwrap_or("1") != "1" {
            continue;
        }
        let dir = folder_path(m.get("parent_id").map(String::as_str).unwrap_or(""));
        let name = filename(title);
        let mut path = if dir.is_empty() {
            format!("{name}.md")
        } else {
            format!("{dir}/{name}.md")
        };
        if !used.insert(path.to_lowercase()) {
            path = path.replace(
                ".md",
                &format!("-{}.md", id.chars().take(8).collect::<String>()),
            );
            used.insert(path.to_lowercase());
        }
        paths.insert(id.clone(), path);
    }
    let mut files = Vec::new();
    let mut attachments = HashMap::new();
    for (name, bytes) in resources {
        let file = Path::new(&name)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let id = Path::new(&file)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let ext = records
            .get(&id)
            .and_then(|(_, _, m)| m.get("file_extension"))
            .cloned()
            .unwrap_or_default();
        let destination = format!(
            "attachments/{}",
            if Path::new(&file).extension().is_none() && !ext.is_empty() {
                format!("{file}.{ext}")
            } else {
                file
            }
        );
        attachments.insert(id, destination.clone());
        files.push(TransferFile {
            path: destination,
            content: STANDARD.encode(bytes),
            binary: true,
        });
    }
    let links = regex::Regex::new(r":/([a-fA-F0-9]{32})").expect("static joplin link pattern");
    for (id, (title, body, m)) in &records {
        let Some(path) = paths.get(id) else {
            continue;
        };
        let body = links.replace_all(body, |c: &regex::Captures<'_>| {
            paths
                .get(&c[1])
                .or_else(|| attachments.get(&c[1]))
                .map(|p| links::relative_reference(path, p))
                .unwrap_or_else(|| c[0].to_owned())
        });
        let tags: Vec<_> = records
            .values()
            .filter(|(_, _, m)| {
                m.get("type_").is_some_and(|v| v == "6")
                    && m.get("note_id").is_some_and(|v| v == id)
            })
            .filter_map(|(_, _, m)| {
                m.get("tag_id")
                    .and_then(|tag| records.get(tag))
                    .map(|(title, _, _)| title.clone())
            })
            .collect();
        let properties = serde_json::json!({"title":title,"tags":tags,"type":if m.get("is_todo").is_some_and(|v|v=="1"){"todo"}else{"note"},"completed":m.get("todo_completed").is_some_and(|v|v!="0"),"created":m.get("user_created_time"),"updated":m.get("user_updated_time"),"source":m.get("source_url")});
        files.push(TransferFile {
            path: path.clone(),
            content: format!("---\n{}---\n{}\n", yaml(&properties), body),
            binary: false,
        });
    }
    Ok(ImportPreview {
        format: format.into(),
        files,
        warnings: vec![],
    })
}
fn enex(source: &Path) -> Result<ImportPreview> {
    let bytes = fs::read(source)?;
    if bytes.len() > 256 * 1024 * 1024 {
        return Err(AppError::new("IMPORT", "ENEX 文件过大，请分批导出"));
    }
    let mut reader = Reader::from_reader(bytes.as_slice());
    reader.config_mut().trim_text(false);
    let mut stack: Vec<String> = Vec::new();
    let mut note = HashMap::<String, String>::new();
    let mut tags = Vec::new();
    let mut resource = HashMap::<String, String>::new();
    let mut resources = Vec::new();
    let mut notes = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                if name == "note" {
                    note.clear();
                    tags.clear();
                    resources.clear();
                }
                if name == "resource" {
                    resource.clear();
                }
                stack.push(name);
            }
            Ok(Event::Text(e)) => {
                let text = e
                    .xml_content()
                    .map_err(|_| AppError::new("IMPORT", "ENEX 文字无效"))?;
                let text = quick_xml::escape::unescape(&text)
                    .map_err(|_| AppError::new("IMPORT", "ENEX 转义无效"))?;
                if let Some(key) = stack.last() {
                    if stack.iter().any(|s| s == "resource") {
                        resource.entry(key.clone()).or_default().push_str(&text);
                    } else if key == "tag" {
                        tags.push(text.into_owned());
                    } else {
                        note.entry(key.clone()).or_default().push_str(&text);
                    }
                }
            }
            Ok(Event::CData(e)) => {
                if let Some(key) = stack.last() {
                    let text = String::from_utf8_lossy(e.as_ref());
                    if stack.iter().any(|s| s == "resource") {
                        resource.entry(key.clone()).or_default().push_str(&text);
                    } else {
                        note.entry(key.clone()).or_default().push_str(&text);
                    }
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                if name == "resource" {
                    resources.push(resource.clone());
                }
                if name == "note" {
                    notes.push((note.clone(), tags.clone(), resources.clone()));
                }
                stack.pop();
            }
            Ok(Event::Eof) => break,
            Err(_) => return Err(AppError::new("IMPORT", "ENEX XML 结构无效")),
            _ => {}
        }
    }
    let mut files = Vec::new();
    let mut used = std::collections::HashSet::new();
    for (note, tags, resources) in notes {
        let title = note.get("title").map(String::as_str).unwrap_or("Untitled");
        let mut path = format!("{}.md", filename(title));
        if !used.insert(path.to_lowercase()) {
            path = format!(
                "{}-{}.md",
                filename(title),
                &Uuid::new_v4().to_string()[..8]
            );
        }
        let mut body = html_markdown(note.get("content").map(String::as_str).unwrap_or(""));
        for r in resources {
            let encoded = r
                .get("data")
                .map(|s| s.split_whitespace().collect::<String>())
                .unwrap_or_default();
            let bytes = STANDARD
                .decode(encoded)
                .map_err(|_| AppError::new("IMPORT", "ENEX 附件无效"))?;
            let hash = format!("{:x}", md5::compute(&bytes));
            let ext = match r.get("mime").map(String::as_str).unwrap_or("") {
                "image/png" => "png",
                "image/jpeg" => "jpg",
                "application/pdf" => "pdf",
                _ => "bin",
            };
            let name = r
                .get("file-name")
                .map(|s| filename(s))
                .unwrap_or_else(|| format!("{hash}.{ext}"));
            let dest = format!("attachments/{hash}-{name}");
            body = body.replace(&format!("resource:{hash}"), &dest);
            files.push(TransferFile {
                path: dest,
                content: STANDARD.encode(bytes),
                binary: true,
            });
        }
        let properties = serde_json::json!({"title":title,"tags":tags,"created":note.get("created"),"updated":note.get("updated"),"source":note.get("source-url")});
        files.push(TransferFile {
            path,
            content: format!("---\n{}---\n{}\n", yaml(&properties), body),
            binary: false,
        });
    }
    Ok(ImportPreview {
        format: "enex".into(),
        files,
        warnings: vec!["Evernote 内部的 evernote:// 链接需要在导入后重新选择目标笔记".into()],
    })
}
pub fn preview(source: &Path, format: &str) -> Result<ImportPreview> {
    match format {
        "jex" | "raw" => joplin(source, format),
        "enex" => enex(source),
        "html" | "onenote" => {
            let entries = if source.is_dir()
                || source
                    .extension()
                    .is_some_and(|e| e.eq_ignore_ascii_case("zip"))
            {
                archives(source)?
            } else {
                vec![(
                    source
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                    fs::read(source)?,
                )]
            };
            let mut files = Vec::new();
            for (name, bytes) in entries {
                checked_relative(&name)?;
                if name.ends_with(".html") || name.ends_with(".htm") {
                    let html = String::from_utf8_lossy(&bytes);
                    let body = html_markdown(&html);
                    files.push(TransferFile {
                        path: format!(
                            "{}.md",
                            name.rsplit_once('.').map_or(name.as_str(), |(s, _)| s)
                        ),
                        content: body,
                        binary: false,
                    });
                } else {
                    files.push(TransferFile {
                        path: name,
                        content: STANDARD.encode(bytes),
                        binary: true,
                    });
                }
            }
            Ok(ImportPreview {
                format: format.into(),
                files,
                warnings: if format == "onenote" {
                    vec![
                        "导入 OneNote 导出的 HTML/ZIP（含图片）；原生 .one 二进制文件不在此格式中"
                            .into(),
                    ]
                } else {
                    vec![]
                },
            })
        }
        _ => Err(AppError::new("IMPORT", "导入格式无效")),
    }
}
impl Library {
    pub fn export_batch(
        &self,
        destination: &Path,
        files: Vec<TransferFile>,
        format: &str,
    ) -> Result<TransferResult> {
        if !["html", "md", "pdf"].contains(&format) {
            return Err(AppError::new("EXPORT", "导出格式无效"));
        }
        let name = format!("MarkFolio-{}", &Uuid::new_v4().to_string()[..8]);
        let directory = destination.join(&name);
        fs::create_dir(&directory)?;
        if format != "pdf" {
            let count = self.export_files(&directory, files)?;
            return Ok(TransferResult {
                count,
                directory: name,
            });
        }
        let candidates = [
            std::env::var_os("PROGRAMFILES").map(PathBuf::from),
            std::env::var_os("PROGRAMFILES(X86)").map(PathBuf::from),
            std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
        ];
        let executable = candidates
            .into_iter()
            .flatten()
            .flat_map(|p| {
                [
                    p.join("Google/Chrome/Application/chrome.exe"),
                    p.join("Microsoft/Edge/Application/msedge.exe"),
                ]
            })
            .find(|p| p.is_file())
            .ok_or_else(|| AppError::new("PDF", "批量 PDF 导出需要已安装 Edge 或 Chrome"))?;
        let mut count = 0;
        for file in files {
            let relative = checked_relative(&file.path)?;
            let target = directory.join(relative).with_extension("pdf");
            if target.exists() {
                return Err(AppError::new("EXISTS", "导出名称重复"));
            }
            let parent = target
                .parent()
                .ok_or_else(|| AppError::new("PDF", "PDF 路径无效"))?;
            fs::create_dir_all(parent)?;
            if !parent
                .canonicalize()?
                .starts_with(directory.canonicalize()?)
            {
                return Err(AppError::new("PATH", "PDF 导出路径越界"));
            }
            let mut html = tempfile::Builder::new().suffix(".html").tempfile()?;
            html.write_all(file.content.as_bytes())?;
            html.as_file().sync_all()?;
            let profile = tempfile::tempdir()?;
            let url = tauri::Url::from_file_path(html.path())
                .map_err(|_| AppError::new("PDF", "PDF 临时文件无效"))?;
            let result = std::process::Command::new(&executable)
                .args([
                    "--headless",
                    "--disable-gpu",
                    "--no-first-run",
                    "--disable-extensions",
                    "--no-pdf-header-footer",
                ])
                .arg(format!("--user-data-dir={}", profile.path().display()))
                .arg(format!("--print-to-pdf={}", target.display()))
                .arg(url.as_str())
                .output()
                .map_err(|_| AppError::new("PDF", "无法启动 PDF 导出程序"))?;
            if !result.status.success() || !target.exists() {
                return Err(AppError::new("PDF", "PDF 导出失败，已导出的文件保留"));
            }
            count += 1;
        }
        Ok(TransferResult {
            count,
            directory: name,
        })
    }
    pub fn ensure_directory(&self, id: &str, path: &str) -> Result<PathBuf> {
        checked_relative(path)?;
        let mut parts = Vec::new();
        let mut directory = self.root(id)?.to_path_buf();
        for part in path.split('/').filter(|p| !p.is_empty()) {
            parts.push(part);
            let relative = parts.join("/");
            let next = self.resolve(id, &relative, false)?;
            if !next.exists() {
                fs::create_dir(&next)?;
            }
            directory = self.resolve(id, &relative, true)?;
        }
        Ok(directory)
    }
    pub fn commit_import(
        &self,
        id: &str,
        directory: &str,
        files: Vec<TransferFile>,
    ) -> Result<TransferResult> {
        if files.len() > 100000 {
            return Err(AppError::new("IMPORT", "导入条目过多"));
        }
        let parent = self.resolve(id, directory, true)?;
        let name = format!("Import-{}", &Uuid::new_v4().to_string()[..8]);
        let slot = parent.join(&name);
        fs::create_dir(&slot)?;
        let base = if directory.is_empty() {
            name
        } else {
            format!("{directory}/{name}")
        };
        let mut count = 0;
        let result = (|| {
            for file in files {
                checked_relative(&file.path)?;
                if file.path.starts_with(".markfolio") {
                    return Err(AppError::new("IMPORT", "导入包含保留目录"));
                }
                let path = format!("{base}/{}", file.path);
                if let Some((parent, _)) = path.rsplit_once('/') {
                    self.ensure_directory(id, parent)?;
                }
                let target = self.resolve(id, &path, false)?;
                let bytes = if file.binary {
                    STANDARD
                        .decode(file.content)
                        .map_err(|_| AppError::new("IMPORT", "附件编码无效"))?
                } else {
                    file.content.into_bytes()
                };
                if bytes.len() > 128 * 1024 * 1024 {
                    return Err(AppError::new("IMPORT", "导入文件过大"));
                }
                let mut out = fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(target)?;
                out.write_all(&bytes)?;
                out.sync_all()?;
                count += 1;
            }
            Ok(())
        })();
        if let Err(error) = result {
            let checked = slot.canonicalize()?;
            if checked.starts_with(self.root(id)?) {
                let _ = fs::remove_dir_all(checked);
            }
            return Err(error);
        }
        Ok(TransferResult {
            count,
            directory: base,
        })
    }
    pub fn export_files(&self, destination: &Path, files: Vec<TransferFile>) -> Result<usize> {
        if !destination.is_dir() {
            return Err(AppError::new("EXPORT", "导出目录不可用"));
        }
        let root = destination.canonicalize()?;
        let mut count = 0;
        for file in files {
            let relative = checked_relative(&file.path)?;
            let target = root.join(relative);
            let parent = target
                .parent()
                .ok_or_else(|| AppError::new("EXPORT", "导出路径无效"))?;
            fs::create_dir_all(parent)?;
            if !parent.canonicalize()?.starts_with(&root) {
                return Err(AppError::new("EXPORT", "导出路径越界"));
            }
            let bytes = if file.binary {
                STANDARD
                    .decode(file.content)
                    .map_err(|_| AppError::new("EXPORT", "导出内容无效"))?
            } else {
                file.content.into_bytes()
            };
            let mut out = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(target)?;
            out.write_all(&bytes)?;
            out.sync_all()?;
            count += 1;
        }
        Ok(count)
    }
}
