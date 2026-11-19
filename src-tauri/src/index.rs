use super::*;
use std::collections::HashSet;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Metadata {
    pub title: String,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
    pub todo: bool,
    pub completed: bool,
    pub pinned: bool,
    pub due: String,
    pub source: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub path: String,
    pub name: String,
    pub title: String,
    pub modified: u64,
    pub created: u64,
    pub size: u64,
    pub metadata: Metadata,
    pub snippet: String,
}
pub fn metadata(text: &str) -> Metadata {
    let normalized = text.replace("\r\n", "\n");
    let Some(rest) = normalized.strip_prefix("---\n") else {
        return Metadata::default();
    };
    let Some(end) = rest.find("\n---").or_else(|| rest.find("\n...")) else {
        return Metadata::default();
    };
    let Ok(value) = serde_yaml::from_str::<serde_json::Value>(&rest[..end]) else {
        return Metadata::default();
    };
    let strings = |key: &str| -> Vec<String> {
        let values = match &value[key] {
            serde_json::Value::String(s) => s.split([',', ' ', '\n']).map(str::to_owned).collect(),
            serde_json::Value::Array(a) => a
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect(),
            _ => Vec::new(),
        };
        let mut unique = Vec::new();
        for s in values {
            let s = s.trim().trim_start_matches('#').to_owned();
            if !s.is_empty() && !unique.contains(&s) {
                unique.push(s);
            }
        }
        unique
    };
    let string = |key: &str| value[key].as_str().unwrap_or("").to_owned();
    Metadata {
        title: string("title"),
        tags: if value["tags"].is_null() {
            strings("tag")
        } else {
            strings("tags")
        },
        aliases: strings("aliases"),
        todo: value["type"] == "todo" || value["todo"] == true,
        completed: value["completed"] == true,
        pinned: value["pinned"] == true,
        due: string("due"),
        source: string("source"),
    }
}
pub fn connect(library: &Library, id: &str) -> Result<Connection> {
    library.root(id)?;
    let db = Connection::open(
        library
            .data_dir
            .join("indexes")
            .join(format!("{id}.sqlite")),
    )?;
    db.execute_batch("PRAGMA secure_delete=ON; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS notes(path TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,modified INTEGER NOT NULL,created INTEGER NOT NULL,size INTEGER NOT NULL,stamp TEXT NOT NULL,metadata TEXT NOT NULL); CREATE INDEX IF NOT EXISTS notes_modified ON notes(modified);")?;
    let legacy: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='files')",
        [],
        |r| r.get(0),
    )?;
    if legacy {
        db.execute_batch("DROP TABLE files; VACUUM; PRAGMA wal_checkpoint(TRUNCATE);")?;
    }
    Ok(db)
}
pub fn reindex(library: &Library, id: &str) -> Result<usize> {
    refresh(library, id, None)
}
pub fn refresh(library: &Library, id: &str, changes: Option<&HashSet<String>>) -> Result<usize> {
    let root = library.root(id)?;
    let mut db = connect(library, id)?;
    let cached: HashMap<String, String> = {
        let mut statement = db.prepare("SELECT path,stamp FROM notes")?;
        let rows = statement.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<std::result::Result<_, _>>()?
    };
    let transaction = db.transaction()?;
    let affected = |path: &str| {
        changes.is_none_or(|changes| {
            changes
                .iter()
                .any(|p| path == p || path.starts_with(&format!("{p}/")))
        })
    };
    let mut stack = if let Some(changes) = changes {
        changes
            .iter()
            .filter_map(|p| checked_relative(p).ok())
            .map(|p| root.join(p))
            .collect()
    } else {
        vec![root.to_path_buf()]
    };
    let mut seen = HashSet::new();
    while let Some(item_path) = stack.pop() {
        let Ok(stat) = fs::symlink_metadata(&item_path) else {
            continue;
        };
        if hidden(&item_path.file_name().unwrap_or_default().to_string_lossy()) && item_path != root
        {
            continue;
        }
        if stat.file_type().is_symlink() {
            continue;
        }
        if stat.is_dir() {
            for entry in fs::read_dir(item_path)? {
                stack.push(entry?.path());
            }
            continue;
        }
        if !is_markdown(&item_path) && !is_locked_note(&item_path) {
            continue;
        }
        if stat.len() > MAX_DOCUMENT {
            continue;
        }
        let path = relative_string(
            item_path
                .strip_prefix(root)
                .map_err(|_| AppError::new("PATH", "索引路径无效"))?,
        );
        let stamp = format!(
            "{}:{}",
            stat.modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_nanos()),
            stat.len()
        );
        seen.insert(path.clone());
        if cached.get(&path) == Some(&stamp) {
            continue;
        }
        // Encrypted notes remain visible, but decrypted content never enters SQLite.
        let text = if is_locked_note(&item_path) {
            String::new()
        } else {
            let Ok(doc) = library.read(id, &path) else {
                continue;
            };
            doc.text
        };
        let properties = metadata(&text);
        let title = if properties.title.is_empty() {
            item_path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned()
        } else {
            properties.title.clone()
        };
        let disk_created = stat
            .created()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as u64);
        let json = serde_json::to_string(&properties)
            .map_err(|_| AppError::new("INDEX", "无法解析文档属性"))?;
        let created = front_timestamp(&text, "created").unwrap_or(disk_created);
        let updated = front_timestamp(&text, "updated").unwrap_or_else(|| modified(&item_path));
        transaction.execute("INSERT INTO notes(path,title,body,modified,created,size,stamp,metadata) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(path) DO UPDATE SET title=excluded.title,body=excluded.body,modified=excluded.modified,created=excluded.created,size=excluded.size,stamp=excluded.stamp,metadata=excluded.metadata", params![path,title,text,updated,created,stat.len(),stamp,json])?;
    }
    for path in cached.keys() {
        if affected(path) && !seen.contains(path) {
            transaction.execute("DELETE FROM notes WHERE path=?1", [path])?;
        }
    }
    let limit = library.persisted.settings["indexMaxMb"]
        .as_u64()
        .unwrap_or(512)
        .clamp(64, 4096)
        * 1024
        * 1024;
    let bytes: u64 = transaction.query_row(
        "SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) FROM notes",
        [],
        |r| r.get(0),
    )?;
    if bytes > limit {
        return Err(AppError::new(
            "INDEX_LIMIT",
            "搜索缓存达到上限，请在高级设置中提高索引上限",
        ));
    }
    transaction.commit()?;
    db.query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
        .map_err(Into::into)
}
fn front_timestamp(text: &str, key: &str) -> Option<u64> {
    let normalized = text.replace("\r\n", "\n");
    let rest = normalized.strip_prefix("---\n")?;
    let end = rest.find("\n---").or_else(|| rest.find("\n..."))?;
    let data: serde_json::Value = serde_yaml::from_str(&rest[..end]).ok()?;
    let value = data[key].as_str()?;
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|d| d.timestamp_millis().max(0) as u64)
        .or_else(|| {
            chrono::NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%SZ")
                .ok()
                .map(|d| d.and_utc().timestamp_millis().max(0) as u64)
        })
        .or_else(|| value.parse::<u64>().ok())
}
pub fn purge(library: &Library, id: &str, path: &str) -> Result<()> {
    let db = connect(library, id)?;
    db.execute("DELETE FROM notes WHERE path=?1", [path])?;
    db.execute_batch("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);")?;
    Ok(())
}
pub fn catalog(library: &Library, id: &str) -> Result<Vec<NoteSummary>> {
    let db = connect(library, id)?;
    let mut stmt = db.prepare("SELECT path,title,modified,created,size,metadata,substr(body,1,180) FROM notes ORDER BY title COLLATE NOCASE")?;
    let rows = stmt.query_map([], |r| {
        let path: String = r.get(0)?;
        Ok(NoteSummary {
            name: path.rsplit('/').next().unwrap_or("").to_owned(),
            path,
            title: r.get(1)?,
            modified: r.get(2)?,
            created: r.get(3)?,
            size: r.get(4)?,
            metadata: serde_json::from_str(&r.get::<_, String>(5)?).unwrap_or_default(),
            snippet: r.get(6)?,
        })
    })?;
    rows.collect::<std::result::Result<_, _>>()
        .map_err(Into::into)
}
#[derive(Debug)]
struct Term {
    field: String,
    value: String,
    negative: bool,
}
fn terms(query: &str) -> Result<Vec<Vec<Term>>> {
    let mut words = Vec::new();
    let mut word = String::new();
    let mut quoted = false;
    for c in query.chars() {
        if c == '"' {
            quoted = !quoted;
        } else if c.is_whitespace() && !quoted {
            if !word.is_empty() {
                words.push(std::mem::take(&mut word));
            }
        } else {
            word.push(c);
        }
    }
    if quoted {
        return Err(AppError::new("QUERY", "搜索短语缺少结束引号"));
    }
    if !word.is_empty() {
        words.push(word);
    }
    let any = words.iter().any(|w| w == "any:1");
    let mut groups = vec![Vec::new()];
    let mut negatives = Vec::new();
    for w in words {
        if w == "any:1" || w == "any:0" || w == "AND" {
            continue;
        }
        if w == "OR" {
            if !groups.last().is_some_and(|g| g.is_empty()) {
                groups.push(Vec::new());
            }
            continue;
        }
        let negative = w.starts_with('-');
        let w = w.trim_start_matches('-');
        let (field, value) = w.split_once(':').unwrap_or(("", w));
        if ![
            "", "title", "body", "path", "notebook", "tag", "type", "is", "due", "created",
            "updated", "source",
        ]
        .contains(&field)
        {
            return Err(AppError::new(
                "QUERY",
                "搜索字段不支持：title、body、path、tag、type、is、created、updated、due、source",
            ));
        }
        if value.is_empty() {
            return Err(AppError::new("QUERY", "搜索字段需要值"));
        }
        if negative {
            negatives.push(Term {
                field: field.to_owned(),
                value: value.to_lowercase(),
                negative,
            });
            continue;
        }
        if ["created", "updated", "due"].contains(&field) && value != "*" {
            date_filter(value)?;
        }
        if any && !groups.last().is_some_and(|g| g.is_empty()) {
            groups.push(Vec::new());
        }
        if let Some(group) = groups.last_mut() {
            group.push(Term {
                field: field.to_owned(),
                value: value.to_lowercase(),
                negative,
            });
        }
    }
    groups.retain(|g| !g.is_empty());
    if groups.is_empty() {
        groups.push(Vec::new());
    }
    groups[0].extend(negatives);
    Ok(groups)
}
fn date_filter(value: &str) -> Result<(String, chrono::NaiveDate)> {
    let (operator, value) = [">=", "<=", ">", "<", "="]
        .into_iter()
        .find_map(|op| value.strip_prefix(op).map(|v| (op, v)))
        .unwrap_or((">=", value));
    let today = chrono::Local::now().date_naive();
    let relative = ["day", "week", "month", "year"]
        .into_iter()
        .find_map(|unit| value.strip_prefix(unit).map(|n| (unit, n)));
    let date = if let Some((unit, n)) = relative {
        let count = if n.is_empty() {
            0
        } else {
            n.parse::<i64>()
                .map_err(|_| AppError::new("QUERY", "相对日期格式无效"))?
        };
        let days = count
            .checked_mul(match unit {
                "week" => 7,
                "month" => 30,
                "year" => 365,
                _ => 1,
            })
            .ok_or_else(|| AppError::new("QUERY", "日期超出范围"))?;
        today
            .checked_add_signed(
                chrono::Duration::try_days(days)
                    .ok_or_else(|| AppError::new("QUERY", "日期超出范围"))?,
            )
            .ok_or_else(|| AppError::new("QUERY", "日期超出范围"))?
    } else {
        chrono::NaiveDate::parse_from_str(
            value,
            if value.contains('-') {
                "%Y-%m-%d"
            } else {
                "%Y%m%d"
            },
        )
        .map_err(|_| AppError::new("QUERY", "日期需使用 YYYYMMDD、YYYY-MM-DD 或 day-7"))?
    };
    Ok((operator.into(), date))
}
fn matches_date(value: Option<chrono::NaiveDate>, query: &str) -> bool {
    if query == "*" {
        return value.is_some();
    }
    let (Ok((op, target)), Some(date)) = (date_filter(query), value) else {
        return false;
    };
    match op.as_str() {
        ">" => date > target,
        "<" => date < target,
        "<=" => date <= target,
        "=" => date == target,
        _ => date >= target,
    }
}
fn contains(text: &str, needle: &str) -> bool {
    let text = text.to_lowercase();
    if !needle.contains(['*', '?']) {
        return text.contains(needle);
    }
    let pattern = regex::escape(needle)
        .replace("\\*", ".*")
        .replace("\\?", ".");
    regex::Regex::new(&pattern).is_ok_and(|r| r.is_match(&text))
}
pub fn search(library: &Library, id: &str, query: &str) -> Result<Vec<SearchHit>> {
    if query.len() > 2048 {
        return Err(AppError::new("QUERY", "搜索内容过长"));
    }
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    let groups = terms(query)?;
    let db = connect(library, id)?;
    let mut stmt = db.prepare("SELECT path,title,body,modified,metadata,created FROM notes")?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, u64>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, u64>(5)?,
        ))
    })?;
    let mut hits: Vec<SearchHit> = Vec::new();
    for row in rows {
        let (path, title, body, modified, json, created) = row?;
        let meta: Metadata = serde_json::from_str(&json).unwrap_or_default();
        let matches = |term: &Term| -> bool {
            match term.field.as_str() {
                "title" => contains(&title, &term.value),
                "body" => contains(&body, &term.value),
                "path" | "notebook" => contains(&path, &term.value),
                "tag" => meta.tags.iter().any(|s| contains(s, &term.value)),
                "type" => {
                    if term.value == "todo" {
                        meta.todo
                    } else {
                        term.value == "note" && !meta.todo
                    }
                }
                "is" => match term.value.as_str() {
                    "completed" => meta.completed,
                    "uncompleted" => !meta.completed,
                    "pinned" => meta.pinned,
                    _ => false,
                },
                "source" => contains(&meta.source, &term.value),
                "due" => matches_date(
                    chrono::NaiveDate::parse_from_str(meta.due.get(..10).unwrap_or(""), "%Y-%m-%d")
                        .ok(),
                    &term.value,
                ),
                "created" | "updated" => {
                    let timestamp = if term.field == "created" {
                        created
                    } else {
                        modified
                    };
                    let date = chrono::DateTime::from_timestamp_millis(timestamp as i64)
                        .map(|d| d.with_timezone(&chrono::Local).date_naive());
                    matches_date(date, &term.value)
                }
                _ => {
                    contains(&path, &term.value)
                        || contains(&body, &term.value)
                        || meta.tags.iter().any(|t| contains(t, &term.value))
                }
            }
        };
        let excluded = groups.iter().flatten().filter(|t| t.negative).any(&matches);
        let positive = groups
            .iter()
            .any(|g| g.iter().filter(|t| !t.negative).all(&matches));
        if excluded || !positive {
            continue;
        }
        let positives: Vec<_> = groups.iter().flatten().filter(|t| !t.negative).collect();
        let score = positives
            .iter()
            .map(|t| {
                let title_score = if contains(&title, &t.value) { 8.0 } else { 0.0 };
                title_score
                    + (body.to_lowercase().matches(&t.value).count() as f64 + 1.0).ln()
                        / (1.0 + body.len() as f64 / 4000.0)
            })
            .sum();
        let snippet = body
            .lines()
            .find(|l| positives.iter().any(|t| contains(l, &t.value)))
            .or_else(|| body.lines().find(|l| !l.trim().is_empty()))
            .unwrap_or("")
            .chars()
            .take(180)
            .collect();
        hits.push(SearchHit {
            path,
            title,
            snippet,
            modified,
            score,
        });
        hits.sort_by(|a, b| {
            b.score
                .total_cmp(&a.score)
                .then_with(|| b.modified.cmp(&a.modified))
        });
        hits.truncate(200);
    }
    Ok(hits)
}
