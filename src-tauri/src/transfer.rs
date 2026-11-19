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
    if name.is_empty() || reserved_name(&name) {
        "Untitled".into()
    } else {
        name
    }
}
fn reserved_name(value: &str) -> bool {
    let stem = value.split('.').next().unwrap_or("").to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && matches!(stem.as_bytes()[3], b'1'..=b'9')
}
fn transfer_path(path: &str) -> Result<PathBuf> {
    let relative = checked_relative(path)?;
    if path.is_empty()
        || path.split('/').any(|part| {
            part == ".markfolio"
                || part.ends_with(['.', ' '])
                || reserved_name(part)
                || part
                    .chars()
                    .any(|c| c.is_control() || "<>\"|?*".contains(c))
        })
    {
        return Err(AppError::new("IMPORT", "导入或导出包含无效或保留名称"));
    }
    Ok(relative)
}
fn read_limited(reader: impl Read, limit: usize) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(AppError::new("IMPORT", "导入文件或解压内容过大"));
    }
    Ok(bytes)
}
fn yaml(properties: &serde_json::Value) -> String {
    serde_yaml::to_string(properties).unwrap_or_default()
}
fn html_markdown(html: &str) -> Result<String> {
    let media = regex::Regex::new(r#"<en-media[^>]*hash=["']([^"']+)["'][^>]*>"#)
        .expect("static media pattern");
    let html = media.replace_all(html, |c: &regex::Captures<'_>| {
        format!("<img src=\"resource:{}\" alt=\"attachment\" />", &c[1])
    });
    let todo = html
        .replace("<en-todo checked=\"true\"/>", "[x] ")
        .replace("<en-todo checked=\"false\"/>", "[ ] ")
        .replace("<en-todo/>", "[ ] ");
    htmd::HtmlToMarkdown::builder()
        .skip_tags(vec!["script", "style", "iframe", "object", "embed", "form"])
        .build()
        .convert(todo.as_str())
        .map_err(|_| AppError::new("IMPORT", "HTML 转换失败"))
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
                    let bytes = read_limited(fs::File::open(item.path())?, 128 * 1024 * 1024)?;
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
            if item.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
                return Err(AppError::new("IMPORT", "ZIP 不能包含符号链接"));
            }
            let bytes = read_limited(&mut item, 128 * 1024 * 1024)?;
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
            let bytes = read_limited(&mut entry, 128 * 1024 * 1024)?;
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
        let due = m
            .get("todo_due")
            .and_then(|v| v.parse::<i64>().ok())
            .filter(|v| *v > 0)
            .and_then(chrono::DateTime::from_timestamp_millis)
            .map(|d| d.to_rfc3339());
        let properties = serde_json::json!({"title":title,"tags":tags,"type":if m.get("is_todo").is_some_and(|v|v=="1"){"todo"}else{"note"},"completed":m.get("todo_completed").is_some_and(|v|v!="0"),"due":due,"created":m.get("user_created_time"),"updated":m.get("user_updated_time"),"source":m.get("source_url")});
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
    let bytes = read_limited(fs::File::open(source)?, 256 * 1024 * 1024)?;
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
    let mut names: HashMap<String, Vec<String>> = HashMap::new();
    let notes: Vec<_> = notes
        .into_iter()
        .map(|(note, tags, resources)| {
            let title = note.get("title").map(String::as_str).unwrap_or("Untitled");
            let mut path = format!("{}.md", filename(title));
            if !used.insert(path.to_lowercase()) {
                path = format!(
                    "{}-{}.md",
                    filename(title),
                    &Uuid::new_v4().to_string()[..8]
                );
            }
            names
                .entry(title.to_owned())
                .or_default()
                .push(path.clone());
            (path, note, tags, resources)
        })
        .collect();
    let internal = regex::Regex::new(r"\[([^\]]+)\]\((evernote://[^)]+)\)")
        .expect("static Evernote link pattern");
    let mut unresolved = 0usize;
    let mut attachments = std::collections::HashSet::new();
    for (path, note, tags, resources) in notes {
        let title = note.get("title").map(String::as_str).unwrap_or("Untitled");
        let body = html_markdown(note.get("content").map(String::as_str).unwrap_or(""))?;
        let mut body = internal
            .replace_all(&body, |cap: &regex::Captures<'_>| {
                if let Some(targets) = names.get(&cap[1]) {
                    if targets.len() == 1 {
                        return format!(
                            "[{}]({})",
                            &cap[1],
                            links::relative_reference(&path, &targets[0])
                        );
                    }
                }
                unresolved += 1;
                cap[0].into()
            })
            .into_owned();
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
            if attachments.insert(dest.clone()) {
                files.push(TransferFile {
                    path: dest,
                    content: STANDARD.encode(bytes),
                    binary: true,
                });
            }
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
        warnings: if unresolved > 0 {
            vec![format!("{unresolved} 个 Evernote 内部链接没有唯一目标，已保留原链接；ENEX 通常不包含笔记 GUID，需要手动选择目标")]
        } else {
            vec![]
        },
    })
}
fn onenote_native(source: &Path) -> Result<ImportPreview> {
    let temporary = tempfile::tempdir()?;
    let input = source
        .to_str()
        .ok_or_else(|| AppError::new("IMPORT", "OneNote 路径编码无效"))?;
    let output = temporary
        .path()
        .to_str()
        .ok_or_else(|| AppError::new("IMPORT", "临时路径无效"))?;
    one2html::convert(
        typed_path::TypedPath::derive(input.as_bytes()),
        typed_path::TypedPath::derive(output.as_bytes()),
        one2html::Options {
            warnings: true,
            math_target: one2html::MathTarget::LaTeX,
            note_tag_icons: one2html::NoteTagIcons::Emoji,
        },
        onenote_parser::fs::native_fs::NativeFs {},
    )
    .map_err(|_| AppError::new("IMPORT", "OneNote 文件无法解析，可能受密码保护或格式损坏"))?;
    let mut imported = preview(temporary.path(), "html")?;
    imported.format = "onenote".into();
    imported
        .warnings
        .push("手写内容保留为图像，OneNote 的画布布局转换为 Markdown 文档".into());
    Ok(imported)
}
pub fn preview(source: &Path, format: &str) -> Result<ImportPreview> {
    if format == "onenote"
        && source.extension().is_some_and(|e| {
            ["one", "onetoc2", "onepkg"]
                .iter()
                .any(|v| e.eq_ignore_ascii_case(v))
        })
    {
        return onenote_native(source);
    }
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
                    read_limited(fs::File::open(source)?, 128 * 1024 * 1024)?,
                )]
            };
            let mut files = Vec::new();
            let available: Vec<_> = entries.iter().map(|(name, _)| name.clone()).collect();
            let html_names: Vec<_> = available
                .iter()
                .filter(|name| {
                    name.to_lowercase().ends_with(".html") || name.to_lowercase().ends_with(".htm")
                })
                .cloned()
                .collect();
            for (name, bytes) in entries {
                transfer_path(&name)?;
                if name.to_lowercase().ends_with(".html") || name.to_lowercase().ends_with(".htm") {
                    let html = String::from_utf8_lossy(&bytes);
                    let mut body = html_markdown(&html)?;
                    for other in &html_names {
                        let new = Path::new(other).with_extension("md");
                        body = links::rewrite(
                            &body,
                            &name,
                            &name,
                            other,
                            &relative_string(&new),
                            &available,
                        );
                    }
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
                    vec!["OneNote 画布布局转换为 Markdown，手写与不支持的对象保留为附件".into()]
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
        if files.is_empty() || files.len() > 100000 {
            return Err(AppError::new("EXPORT", "请选择有效数量的导出文件"));
        }
        let mut total = 0usize;
        let mut paths = std::collections::HashSet::new();
        for file in &files {
            let path = transfer_path(&file.path)?;
            let path = if format == "pdf" {
                path.with_extension("pdf")
            } else {
                path
            };
            if !paths.insert(relative_string(&path).to_lowercase()) {
                return Err(AppError::new("EXISTS", "导出名称重复"));
            }
            total = total.saturating_add(file.content.len());
            if total > 384 * 1024 * 1024 {
                return Err(AppError::new("EXPORT", "导出内容过大，请分批处理"));
            }
            if format == "pdf"
                && (file.binary || !file.path.to_ascii_lowercase().ends_with(".html"))
            {
                return Err(AppError::new("PDF", "PDF 导出需要 HTML 文档"));
            }
        }
        let name = format!("MarkFolio-{}", &Uuid::new_v4().to_string()[..8]);
        let directory = destination.canonicalize()?.join(&name);
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
            let relative = transfer_path(&file.path)?;
            let target = directory.join(relative).with_extension("pdf");
            if target.exists() {
                return Err(AppError::new("EXISTS", "导出名称重复"));
            }
            let parent = target
                .parent()
                .ok_or_else(|| AppError::new("PDF", "PDF 路径无效"))?;
            safe_directories(&directory.canonicalize()?, parent)?;
            if !parent
                .canonicalize()?
                .starts_with(directory.canonicalize()?)
            {
                return Err(AppError::new("PATH", "PDF 导出路径越界"));
            }
            let mut html = tempfile::Builder::new().suffix(".html").tempfile()?;
            let base = tauri::Url::from_directory_path(parent)
                .map_err(|_| AppError::new("PDF", "PDF 链接位置无效"))?;
            let content = file.content.replacen(
                "</head>",
                &format!(
                    "<base href=\"{}\"></head>",
                    base.as_str().replace('&', "&amp;").replace('"', "&quot;")
                ),
                1,
            );
            html.write_all(content.as_bytes())?;
            html.as_file().sync_all()?;
            let profile = tempfile::tempdir()?;
            let url = tauri::Url::from_file_path(html.path())
                .map_err(|_| AppError::new("PDF", "PDF 临时文件无效"))?;
            let mut command = std::process::Command::new(&executable);
            command
                .args([
                    "--headless",
                    "--disable-gpu",
                    "--no-first-run",
                    "--disable-extensions",
                    "--disable-background-networking",
                    "--disable-component-update",
                    "--no-pdf-header-footer",
                ])
                .arg(format!("--user-data-dir={}", profile.path().display()))
                .arg(format!("--print-to-pdf={}", target.display()))
                .arg(url.as_str())
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            let mut child = command
                .spawn()
                .map_err(|_| AppError::new("PDF", "无法启动 PDF 导出程序"))?;
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(45);
            let status = loop {
                if let Some(status) = child.try_wait()? {
                    break status;
                }
                if std::time::Instant::now() >= deadline {
                    #[cfg(target_os = "windows")]
                    {
                        use std::os::windows::process::CommandExt;
                        let _ = std::process::Command::new("taskkill.exe")
                            .args(["/PID", &child.id().to_string(), "/T", "/F"])
                            .creation_flags(0x08000000)
                            .stdout(std::process::Stdio::null())
                            .stderr(std::process::Stdio::null())
                            .status();
                    }
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(AppError::new("PDF", "PDF 导出超时，已导出的文件保留"));
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            };
            if !status.success() || !target.exists() || fs::metadata(&target)?.len() == 0 {
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
        let mut total = 0usize;
        let mut paths = std::collections::HashSet::new();
        for file in &files {
            transfer_path(&file.path)?;
            if !paths.insert(file.path.to_lowercase()) {
                return Err(AppError::new(
                    "EXISTS",
                    "导入包包含重复文件名，请修正后重试",
                ));
            }
            total = total.saturating_add(file.content.len());
            if total > 384 * 1024 * 1024 {
                return Err(AppError::new("IMPORT", "导入内容过大，请分批处理"));
            }
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
                transfer_path(&file.path)?;
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
        self.mark_changed(id, &base);
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
            let relative = transfer_path(&file.path)?;
            let target = root.join(relative);
            let parent = target
                .parent()
                .ok_or_else(|| AppError::new("EXPORT", "导出路径无效"))?;
            safe_directories(&root, parent)?;
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
fn safe_directories(root: &Path, parent: &Path) -> Result<()> {
    let relative = parent
        .strip_prefix(root)
        .map_err(|_| AppError::new("PATH", "导出路径越界"))?;
    let mut directory = root.to_path_buf();
    for part in relative.components() {
        if !matches!(part, Component::Normal(_)) {
            return Err(AppError::new("PATH", "导出路径无效"));
        }
        let current = directory.canonicalize()?;
        if !current.starts_with(root) {
            return Err(AppError::new("PATH", "导出目录越界"));
        }
        directory = current.join(part.as_os_str());
        if !directory.exists() {
            fs::create_dir(&directory)?;
        }
        if !directory.canonicalize()?.starts_with(root) {
            return Err(AppError::new("PATH", "导出目录越界"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn record(title: &str, body: &str, id: &str, fields: &str) -> Vec<u8> {
        format!("{title}\n\n{body}\n\nid: {id}\n{fields}\n").into_bytes()
    }
    #[test]
    fn jex_and_raw_preserve_folders_tags_dates_todos_resources_and_note_links() {
        let temp = tempfile::tempdir().unwrap();
        let raw = temp.path().join("raw");
        fs::create_dir(&raw).unwrap();
        fs::create_dir(raw.join("resources")).unwrap();
        let (a, b, folder, tag, relation, resource) = (
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "cccccccccccccccccccccccccccccccc",
            "dddddddddddddddddddddddddddddddd",
            "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            "ffffffffffffffffffffffffffffffff",
        );
        let entries=vec![
            (format!("{a}.md"),record("First",&format!("[Second](:/{b})\n![Image](:/{resource})"),a,&format!("type_: 1\nparent_id: {folder}\nis_todo: 1\ntodo_completed: 0\ntodo_due: 1893456000000\nuser_created_time: 2020-01-02T00:00:00.000Z"))),
            (format!("{b}.md"),record("Second","text",b,&format!("type_: 1\nparent_id: {folder}"))),
            (format!("{folder}.md"),record("Notebook","",folder,"type_: 2")),
            (format!("{tag}.md"),record("work","",tag,"type_: 5")),
            (format!("{relation}.md"),record("","",relation,&format!("type_: 6\nnote_id: {a}\ntag_id: {tag}"))),
            (format!("{resource}.md"),record("Image","",resource,"type_: 4\nfile_extension: png")),
            (format!("resources/{resource}.png"),b"synthetic image data".to_vec()),
        ];
        let archive = temp.path().join("notes.jex");
        let mut tar = tar::Builder::new(fs::File::create(&archive).unwrap());
        for (name, bytes) in &entries {
            fs::write(raw.join(name), bytes).unwrap();
            let mut header = tar::Header::new_gnu();
            header.set_size(bytes.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            tar.append_data(&mut header, name, bytes.as_slice())
                .unwrap();
        }
        tar.finish().unwrap();
        for (source, format) in [(&raw, "raw"), (&archive, "jex")] {
            let imported = preview(source, format).unwrap();
            assert_eq!(imported.files.len(), 3);
            let note = imported
                .files
                .iter()
                .find(|f| f.path == "Notebook/First.md")
                .unwrap();
            let meta = index::metadata(&note.content);
            assert_eq!(meta.tags, vec!["work"]);
            assert!(meta.todo);
            assert!(!meta.completed);
            assert!(meta.due.starts_with("2030-01-01"));
            assert!(note.content.contains("[Second](Second.md)"));
            assert!(note
                .content
                .contains(&format!("../attachments/{resource}.png")));
            let mut library = Library::new(temp.path().join(format!("app-{format}"))).unwrap();
            let root = temp.path().join(format!("workspace-{format}"));
            fs::create_dir(&root).unwrap();
            let id = library.open(root.clone(), None).unwrap().id;
            let committed = library.commit_import(&id, "", imported.files).unwrap();
            assert_eq!(committed.count, 3);
            assert_eq!(
                fs::read(
                    root.join(&committed.directory)
                        .join(format!("attachments/{resource}.png"))
                )
                .unwrap(),
                b"synthetic image data"
            );
        }
    }
    #[test]
    fn enex_migrates_unique_internal_links_and_deduplicates_resources() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("notes.enex");
        let data = b"attachment fixture";
        let hash = format!("{:x}", md5::compute(data));
        let resource=format!("<resource><data encoding=\"base64\">{}</data><mime>image/png</mime><resource-attributes><file-name>image.png</file-name></resource-attributes></resource>",STANDARD.encode(data));
        let xml=format!("<?xml version=\"1.0\"?><en-export><note><title>Origin</title><content><![CDATA[<en-note><a href=\"evernote:///view/1/2/id/id/\">Target</a><en-media type=\"image/png\" hash=\"{hash}\"/></en-note>]]></content><tag>work</tag><created>20200102T000000Z</created>{resource}</note><note><title>Target</title><content><![CDATA[<en-note>Target body<en-media type=\"image/png\" hash=\"{hash}\"/></en-note>]]></content>{resource}</note></en-export>");
        fs::write(&source, xml).unwrap();
        let imported = preview(&source, "enex").unwrap();
        assert_eq!(imported.files.iter().filter(|f| f.binary).count(), 1);
        let origin = imported
            .files
            .iter()
            .find(|f| f.path == "Origin.md")
            .unwrap();
        assert!(origin.content.contains("[Target](Target.md)"));
        assert!(origin
            .content
            .contains(&format!("attachments/{hash}-image.png")));
        assert_eq!(index::metadata(&origin.content).tags, vec!["work"]);
        assert!(imported.warnings.is_empty());
    }
    #[test]
    #[ignore = "Supply MARKFOLIO_TEST_ONENOTE to verify native OneNote samples"]
    fn native_onenote_sections_and_package_convert_into_markdown_and_attachments() {
        let root = PathBuf::from(
            std::env::var_os("MARKFOLIO_TEST_ONENOTE").expect("OneNote sample directory"),
        );
        for name in [
            "bold_and_italic.one",
            "checkboxes_and_unicode.one",
            "test.onepkg",
        ] {
            let imported = preview(&root.join(name), "onenote").unwrap();
            assert!(
                imported
                    .files
                    .iter()
                    .any(|file| !file.binary && !file.content.trim().is_empty()),
                "{name}"
            );
            assert!(
                imported
                    .files
                    .iter()
                    .all(|file| transfer_path(&file.path).is_ok()),
                "{name}"
            );
        }
    }
    #[test]
    fn html_conversion_import_validation_and_exports_preserve_structure_and_attachments() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("html");
        fs::create_dir(&source).unwrap();
        fs::create_dir(source.join("Docs")).unwrap();
        fs::write(
            source.join("Docs/one.HTML"),
            "<h1>One</h1><a href=\"../two.htm#heading\">Second</a><img src=\"../image.png\"/>",
        )
        .unwrap();
        fs::write(source.join("two.htm"), "<h1 id=\"heading\">Two</h1>").unwrap();
        fs::write(source.join("image.png"), b"image bytes").unwrap();
        let imported = preview(&source, "html").unwrap();
        assert_eq!(imported.files.len(), 3);
        let note = imported
            .files
            .iter()
            .find(|f| f.path == "Docs/one.md")
            .unwrap();
        assert!(note.content.contains("../two.md#heading"));
        assert!(note.content.contains("../image.png"));
        let mut library = Library::new(temp.path().join("app")).unwrap();
        let root = temp.path().join("workspace");
        fs::create_dir(&root).unwrap();
        let id = library.open(root.clone(), None).unwrap().id;
        for path in [
            "../outside.md",
            "CON.md",
            "folder/note.md.",
            ".markfolio/trash/x.md",
        ] {
            assert!(library
                .commit_import(
                    &id,
                    "",
                    vec![TransferFile {
                        path: path.into(),
                        content: "blocked".into(),
                        binary: false
                    }]
                )
                .is_err());
        }
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        let export = temp.path().join("export");
        fs::create_dir(&export).unwrap();
        let copy = imported.files.clone();
        assert_eq!(library.export_files(&export, copy).unwrap(), 3);
        assert_eq!(fs::read(export.join("image.png")).unwrap(), b"image bytes");
        assert!(library
            .export_files(&export, imported.files.clone())
            .is_err());
        let result = library.commit_import(&id, "", imported.files).unwrap();
        assert_eq!(result.count, 3);
        assert!(root.join(result.directory).join("Docs/one.md").is_file());
        assert!(!temp.path().join("outside.md").exists());
    }
    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "Set MARKFOLIO_TEST_DESKTOP=1 to test installed Chrome / Edge PDF export"]
    fn native_pdf_export_produces_a_readable_pdf_in_a_separate_directory() {
        let temp = tempfile::tempdir().unwrap();
        let library = Library::new(temp.path().join("data")).unwrap();
        let html="<!doctype html><html><head><meta charset=\"utf-8\"></head><body><h1>MarkFolio export</h1><p>Local document 2026.</p><a href=\"second.pdf\">Second</a></body></html>";
        let files = vec![TransferFile {
            path: "notes/first.html".into(),
            content: html.into(),
            binary: false,
        }];
        let result = library.export_batch(temp.path(), files, "pdf").unwrap();
        assert_eq!(result.count, 1);
        let pdf = fs::read(temp.path().join(result.directory).join("notes/first.pdf")).unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
        assert!(pdf.len() > 1000);
        assert!(pdf.windows(6).any(|bytes| bytes == b"%%EOF\n"));
    }
}
