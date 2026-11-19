use super::*;
use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkResolution {
    pub path: String,
    pub fragment: String,
    pub candidates: Vec<String>,
}
pub fn paths(library: &Library, id: &str) -> Result<Vec<String>> {
    let root = library.root(id)?;
    let mut stack = vec![root.to_path_buf()];
    let mut result = Vec::new();
    while let Some(dir) = stack.pop() {
        for item in fs::read_dir(dir)? {
            let item = item?;
            if hidden(&item.file_name().to_string_lossy()) {
                continue;
            }
            let kind = item.file_type()?;
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                stack.push(item.path());
            } else {
                result.push(relative_string(
                    item.path()
                        .strip_prefix(root)
                        .map_err(|_| AppError::new("PATH", "文件路径无效"))?,
                ));
            }
        }
    }
    Ok(result)
}
fn relative(from: &str, target: &str) -> String {
    let mut origin: Vec<_> = from
        .rsplit_once('/')
        .map_or("", |(p, _)| p)
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    let mut destination: Vec<_> = target.split('/').collect();
    while !origin.is_empty() && !destination.is_empty() && origin[0] == destination[0] {
        origin.remove(0);
        destination.remove(0);
    }
    let mut parts = vec![".."; origin.len()];
    parts.extend(destination);
    parts.join("/")
}
pub fn relative_reference(from: &str, target: &str) -> String {
    relative(from, target)
}
fn normalized(from: &str, target: &str) -> Option<String> {
    let decoded = percent_decode_str(target).decode_utf8().ok()?;
    if decoded.contains(['\0', ':', '\\']) || decoded.starts_with('/') {
        return None;
    }
    let mut parts: Vec<_> = from
        .rsplit_once('/')
        .map_or("", |(p, _)| p)
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    for p in decoded.split('/') {
        if p == ".." {
            parts.pop()?;
        } else if !p.is_empty() && p != "." {
            parts.push(p);
        }
    }
    Some(parts.join("/"))
}
pub fn target_path(from: &str, target: &str, wiki: bool, available: &[String]) -> LinkResolution {
    let (file, fragment) = target.split_once('#').unwrap_or((target, ""));
    let fragment = percent_decode_str(fragment)
        .decode_utf8_lossy()
        .into_owned();
    if file.is_empty() {
        return LinkResolution {
            path: from.to_owned(),
            fragment,
            candidates: vec![],
        };
    }
    let mut candidates = Vec::new();
    let variants = if wiki && Path::new(file).extension().is_none() {
        vec![
            file.to_owned(),
            format!("{file}.md"),
            format!("{file}.markdown"),
        ]
    } else {
        vec![file.to_owned()]
    };
    for variant in &variants {
        if let Some(local) = normalized(from, variant) {
            if let Some(p) = available.iter().find(|p| p.eq_ignore_ascii_case(&local)) {
                return LinkResolution {
                    path: p.clone(),
                    fragment,
                    candidates: vec![],
                };
            }
        }
    }
    if wiki {
        for variant in &variants {
            if let Some(p) = available.iter().find(|p| p.eq_ignore_ascii_case(variant)) {
                return LinkResolution {
                    path: p.clone(),
                    fragment,
                    candidates: vec![],
                };
            }
        }
        let decoded = percent_decode_str(file).decode_utf8_lossy();
        for path in available {
            let name = Path::new(path)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy();
            if is_markdown(Path::new(path))
                && (name.eq_ignore_ascii_case(&decoded)
                    || path
                        .rsplit('/')
                        .next()
                        .is_some_and(|p| p.eq_ignore_ascii_case(&decoded)))
            {
                candidates.push(path.clone());
            }
        }
    }
    let path = if candidates.len() == 1 {
        candidates.remove(0)
    } else {
        String::new()
    };
    LinkResolution {
        path,
        fragment,
        candidates,
    }
}
pub fn resolve(
    library: &Library,
    id: &str,
    from: &str,
    target: &str,
    wiki: bool,
) -> Result<LinkResolution> {
    checked_relative(from)?;
    if target.len() > 4096 {
        return Err(AppError::new("LINK", "链接过长"));
    }
    let available = paths(library, id)?;
    let mut result = target_path(from, target, wiki, &available);
    if wiki && result.path.is_empty() && result.candidates.is_empty() {
        let alias = target.split('#').next().unwrap_or("");
        result.candidates = library
            .catalog(id)?
            .into_iter()
            .filter(|n| {
                n.metadata
                    .aliases
                    .iter()
                    .any(|a| a.eq_ignore_ascii_case(alias))
            })
            .map(|n| n.path)
            .collect();
        if result.candidates.len() == 1 {
            result.path = result.candidates.remove(0);
        }
    }
    if !result.path.is_empty() {
        library.resolve(id, &result.path, true)?;
    }
    Ok(result)
}
fn translated(path: &str, from: &str, to: &str) -> String {
    if path == from || path.starts_with(&format!("{from}/")) {
        format!("{to}{}", &path[from.len()..])
    } else {
        path.to_owned()
    }
}
fn escaped_path(path: &str) -> String {
    path.split('/')
        .map(|p| {
            utf8_percent_encode(p, NON_ALPHANUMERIC)
                .to_string()
                .replace("%2E", ".")
                .replace("%2D", "-")
                .replace("%5F", "_")
        })
        .collect::<Vec<_>>()
        .join("/")
}
pub fn rewrite(
    text: &str,
    old: &str,
    new: &str,
    from: &str,
    to: &str,
    available: &[String],
) -> String {
    let regex = regex::Regex::new(r"\[\[([^\]\n]+)\]\]|(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^)\n]+)(\))")
        .expect("static link pattern");
    let mut protected = Vec::new();
    let mut offset = 0;
    let mut fence: Option<char> = None;
    for line in text.split_inclusive('\n') {
        let trim = line.trim_start();
        let marker = if trim.starts_with("```") {
            Some('`')
        } else if trim.starts_with("~~~") {
            Some('~')
        } else {
            None
        };
        if fence.is_some() || marker.is_some() {
            protected.push((offset, offset + line.len()));
        }
        if let Some(m) = marker {
            if fence == Some(m) {
                fence = None;
            } else if fence.is_none() {
                fence = Some(m);
            }
        }
        offset += line.len();
    }
    regex
        .replace_all(text, |cap: &regex::Captures<'_>| {
            let whole = cap.get(0).map_or("", |m| m.as_str());
            let position = cap.get(0).map_or(0, |m| m.start());
            if protected
                .iter()
                .any(|(a, b)| position >= *a && position < *b)
            {
                return whole.to_owned();
            }
            let wiki = cap.get(1).is_some();
            let value = cap.get(if wiki { 1 } else { 3 }).map_or("", |m| m.as_str());
            let (target, suffix) = if wiki {
                value
                    .split_once('|')
                    .map_or((value, String::new()), |(t, l)| (t, format!("|{l}")))
            } else if value.starts_with('<') {
                (value.trim_matches(['<', '>']), String::new())
            } else {
                value
                    .split_once(" \"")
                    .map_or((value, String::new()), |(t, l)| (t, format!(" \"{l}")))
            };
            let resolution = target_path(old, target, wiki, available);
            if resolution.path.is_empty() {
                return whole.to_owned();
            }
            let destination = translated(&resolution.path, from, to);
            if destination == resolution.path && old == new {
                return whole.to_owned();
            }
            let link = relative(new, &destination);
            let fragment = if resolution.fragment.is_empty() {
                String::new()
            } else {
                format!("#{}", resolution.fragment)
            };
            if wiki {
                format!("[[{link}{fragment}{suffix}]]")
            } else {
                format!(
                    "{}{}{fragment}{suffix})",
                    cap.get(2).map_or("", |m| m.as_str()),
                    escaped_path(&link)
                )
            }
        })
        .into_owned()
}
pub fn rename(
    library: &Library,
    id: &str,
    from: &str,
    to: &str,
    source: &Path,
    target: &Path,
) -> Result<()> {
    let available = paths(library, id)?;
    let update = library.persisted.settings["updateLinks"]
        .as_bool()
        .unwrap_or(true);
    let mut changes = Vec::new();
    if update {
        for path in available.iter().filter(|p| is_markdown(Path::new(p))) {
            let doc = library.read(id, path)?;
            let new = translated(path, from, to);
            let changed = rewrite(&doc.text, path, &new, from, to, &available);
            if changed != doc.text {
                changes.push((path.clone(), new, doc, changed));
            }
        }
    }
    for (path, _, doc, _) in &changes {
        if library.read(id, path)?.version != doc.version {
            return Err(AppError::new("CONFLICT", "链接更新前文件已变化，请重试"));
        }
    }
    fs::rename(library.root(id)?.join(checked_relative(from)?), target)?;
    let mut applied: Vec<(&str, &Document)> = Vec::new();
    for (_, path, doc, text) in &changes {
        let result = (|| {
            let disk = library.read(id, path)?;
            if disk.version != doc.version {
                return Err(AppError::new("CONFLICT", "链接更新时文件被外部修改"));
            }
            library.write(id, path, text, &doc.version, &doc.encoding)?;
            Ok(())
        })();
        if let Err(error) = result {
            for (path, doc) in applied.iter().rev() {
                if let Ok(file) = library.resolve(id, path, true) {
                    if let Ok(bytes) = encode(&doc.text, &doc.encoding) {
                        let _ = atomic_write(&file, &bytes);
                    }
                }
            }
            let _ = fs::rename(target, source);
            return Err(error);
        }
        applied.push((path.as_str(), doc));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resolves_relative_wiki_and_ambiguity() {
        let paths = vec!["a/note.md".into(), "b/note.md".into()];
        assert_eq!(
            target_path("a/start.md", "note#标题", true, &paths).path,
            "a/note.md"
        );
        assert_eq!(
            target_path("start.md", "note", true, &paths)
                .candidates
                .len(),
            2
        );
        assert!(target_path("start.md", "../note.md", false, &paths)
            .path
            .is_empty());
    }
    #[test]
    fn updates_incoming_and_outgoing_links_without_touching_fences() {
        let paths = vec!["a.md".into(), "b.md".into(), "img.png".into()];
        let text = "[B](b.md#title)\n![image](img.png)\n```\n[B](b.md)\n```";
        let rewritten = rewrite(text, "a.md", "sub/a.md", "a.md", "sub/a.md", &paths);
        assert!(rewritten.contains("../b.md#title"));
        assert!(rewritten.contains("../img.png"));
        assert!(rewritten.contains("```\n[B](b.md)"));
    }
}
