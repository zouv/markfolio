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
            if (is_markdown(Path::new(path)) || Path::new(file).extension().is_some())
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
fn link_pattern() -> &'static regex::Regex {
    static PATTERN: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    PATTERN.get_or_init(|| regex::Regex::new(r#"(?m)\[\[([^\]\n]+)\]\]|(!?\[[^\]\n]*\]\()(<[^>\n]+>(?:[ \t]+["'][^\n]*["'])?|(?:[^()\n]|\([^()\n]*\))+)(\))|(^ {0,3}\[[^\]\n]+\]:[ \t]*)(<[^>\n]+>|[^\s\n]+)"#).expect("static link pattern"))
}
fn protected_ranges(text: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut offset = 0;
    let mut front = text.starts_with("---\n") || text.starts_with("---\r\n");
    let mut fence: Option<(u8, usize)> = None;
    for line in text.split_inclusive('\n') {
        let trim = line.trim_start();
        let bytes = trim.as_bytes();
        let marker = bytes.first().copied().filter(|c| *c == b'`' || *c == b'~');
        let count = marker.map_or(0, |m| bytes.iter().take_while(|b| **b == m).count());
        if front {
            ranges.push((offset, offset + line.len()));
            if offset > 0 && matches!(trim.trim_end(), "---" | "...") {
                front = false;
            }
        } else if let Some((m, n)) = fence {
            ranges.push((offset, offset + line.len()));
            if marker == Some(m) && count >= n && trim[count..].trim().is_empty() {
                fence = None;
            }
        } else if count >= 3 && line.len() - trim.len() < 4 {
            fence = marker.map(|m| (m, count));
            ranges.push((offset, offset + line.len()));
        } else if line.starts_with("    ") || line.starts_with('\t') {
            ranges.push((offset, offset + line.len()));
        }
        offset += line.len();
    }
    let bytes = text.as_bytes();
    let mut cursor = 0;
    while cursor < bytes.len() {
        if let Some((_, end)) = ranges.iter().find(|(a, b)| cursor >= *a && cursor < *b) {
            cursor = *end;
            continue;
        }
        if bytes[cursor] != b'`' || cursor > 0 && bytes[cursor - 1] == b'\\' {
            cursor += 1;
            continue;
        }
        let start = cursor;
        let count = bytes[cursor..].iter().take_while(|b| **b == b'`').count();
        cursor += count;
        let mut search = cursor;
        while search < bytes.len() {
            if bytes[search] != b'`' {
                search += 1;
                continue;
            }
            let n = bytes[search..].iter().take_while(|b| **b == b'`').count();
            if n == count {
                ranges.push((start, search + n));
                cursor = search + n;
                break;
            }
            search += n;
        }
    }
    ranges
}
fn destination(value: &str, wiki: bool) -> (&str, String) {
    if wiki {
        return value
            .split_once('|')
            .map_or((value, String::new()), |(p, l)| (p, format!("|{l}")));
    }
    if value.starts_with('<') {
        if let Some(end) = value.find('>') {
            return (&value[1..end], value[end + 1..].into());
        }
    }
    let split = regex::Regex::new(r#"\s+["']"#).expect("static title pattern");
    split
        .find(value)
        .map_or((value.trim(), String::new()), |m| {
            (&value[..m.start()], value[m.start()..].into())
        })
}
pub fn references(text: &str, from: &str, available: &[String]) -> Vec<String> {
    let protected = protected_ranges(text);
    let mut paths = Vec::new();
    for cap in link_pattern().captures_iter(text) {
        let position = cap.get(0).map_or(0, |m| m.start());
        if protected
            .iter()
            .any(|(a, b)| position >= *a && position < *b)
        {
            continue;
        }
        let wiki = cap.get(1).is_some();
        let value = cap
            .get(if wiki {
                1
            } else if cap.get(3).is_some() {
                3
            } else {
                6
            })
            .map_or("", |m| m.as_str());
        let (target, _) = destination(value, wiki);
        let resolved = target_path(from, target, wiki, available);
        if !resolved.path.is_empty() && !paths.contains(&resolved.path) {
            paths.push(resolved.path);
        }
    }
    paths
}
pub fn rewrite(
    text: &str,
    old: &str,
    new: &str,
    from: &str,
    to: &str,
    available: &[String],
) -> String {
    let protected = protected_ranges(text);
    link_pattern()
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
            let value = cap
                .get(if wiki {
                    1
                } else if cap.get(3).is_some() {
                    3
                } else {
                    6
                })
                .map_or("", |m| m.as_str());
            let (target, suffix) = destination(value, wiki);
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
                let prefix = cap.get(2).or_else(|| cap.get(5)).map_or("", |m| m.as_str());
                let end = if cap.get(4).is_some() { ")" } else { "" };
                let link = format!("{}{fragment}", escaped_path(&link));
                let link = if value.starts_with('<') {
                    format!("<{link}>")
                } else {
                    link
                };
                format!("{prefix}{link}{suffix}{end}")
            }
        })
        .into_owned()
}
pub fn rename(
    library: &Library,
    id: &str,
    from: &str,
    to: &str,
    _source: &Path,
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
    let mut applied: Vec<(&str, &Document, String)> = Vec::new();
    for (_, path, doc, text) in &changes {
        let result = (|| {
            let disk = library.read(id, path)?;
            if disk.version != doc.version {
                return Err(AppError::new("CONFLICT", "链接更新时文件被外部修改"));
            }
            library.write(id, path, text, &doc.version, &doc.encoding)
        })();
        match result {
            Ok(updated) => applied.push((path.as_str(), doc, updated.version)),
            Err(error) => {
                let mut incomplete = false;
                for (path, doc, expected) in applied.iter().rev() {
                    if library
                        .write(id, path, &doc.text, expected, &doc.encoding)
                        .is_err()
                    {
                        incomplete = true;
                    }
                }
                if fs::rename(target, library.root(id)?.join(checked_relative(from)?)).is_err() {
                    incomplete = true;
                }
                library.mark_changed(id, "*");
                if incomplete {
                    return Err(AppError::new(
                        "LINK_ROLLBACK",
                        "链接更新遇到外部修改，已保留外部内容；请刷新目录并检查相关链接",
                    ));
                }
                return Err(error);
            }
        }
    }
    library.mark_changed(id, from);
    library.mark_changed(id, to);
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
