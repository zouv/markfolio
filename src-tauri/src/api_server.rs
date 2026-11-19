use crate::library::{AppError, Result, SharedLibrary};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{Shutdown, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::Emitter;
#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApiStatus {
    pub running: bool,
    pub port: u16,
    pub token: String,
    pub workspace: String,
    pub writable: bool,
}
struct Running {
    status: ApiStatus,
    alive: Arc<AtomicBool>,
    thread: std::thread::JoinHandle<()>,
}
#[derive(Default)]
pub struct LocalApi {
    running: Mutex<Option<Running>>,
}
impl LocalApi {
    pub fn status(&self) -> Result<ApiStatus> {
        Ok(self
            .running
            .lock()
            .map_err(|_| AppError::new("API", "服务状态不可用"))?
            .as_ref()
            .map(|r| r.status.clone())
            .unwrap_or_default())
    }
    pub fn stop(&self) -> Result<ApiStatus> {
        let mut guard = self
            .running
            .lock()
            .map_err(|_| AppError::new("API", "服务状态不可用"))?;
        if let Some(run) = guard.take() {
            run.alive.store(false, Ordering::Release);
            let _ = run.thread.join();
        }
        Ok(ApiStatus::default())
    }
    pub fn start(
        &self,
        app: tauri::AppHandle,
        library: SharedLibrary,
        workspace: String,
        port: u16,
        writable: bool,
    ) -> Result<ApiStatus> {
        self.start_server(
            library,
            workspace,
            port,
            writable,
            Arc::new(move |workspace| {
                let _ = app.emit("workspace-changed", workspace);
            }),
        )
    }
    fn start_server(
        &self,
        library: SharedLibrary,
        workspace: String,
        port: u16,
        writable: bool,
        notify: Arc<dyn Fn(&str) + Send + Sync>,
    ) -> Result<ApiStatus> {
        if !(1024..=65535).contains(&port) {
            return Err(AppError::new("API", "端口需要在 1024 至 65535 之间"));
        }
        {
            library
                .lock()
                .map_err(|_| AppError::new("STATE", "文件服务不可用"))?
                .resolve(&workspace, "", true)?;
        }
        let mut guard = self
            .running
            .lock()
            .map_err(|_| AppError::new("API", "服务状态不可用"))?;
        if guard.is_some() {
            return Err(AppError::new("API", "请先停止当前本地服务"));
        }
        let listener = TcpListener::bind(("127.0.0.1", port))
            .map_err(|_| AppError::new("API", "本地端口已被占用"))?;
        listener.set_nonblocking(true)?;
        let status = ApiStatus {
            running: true,
            port,
            token: format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ),
            workspace,
            writable,
        };
        let alive = Arc::new(AtomicBool::new(true));
        let running_alive = alive.clone();
        let server_status = status.clone();
        let thread = std::thread::spawn(move || {
            let mut clients: Vec<std::thread::JoinHandle<()>> = Vec::new();
            while running_alive.load(Ordering::Acquire) {
                let mut index = 0;
                while index < clients.len() {
                    if clients[index].is_finished() {
                        let _ = clients.remove(index).join();
                    } else {
                        index += 1;
                    }
                }
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        if clients.len() >= 8 {
                            let _ = send(
                                &mut stream,
                                503,
                                &json!({"error":"Too many requests"}),
                                None,
                            );
                            continue;
                        }
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
                        let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
                        let server_status = server_status.clone();
                        let library = library.clone();
                        let notify = notify.clone();
                        clients.push(std::thread::spawn(move || {
                            let response =
                                handle(&mut stream, &server_status, &library, notify.as_ref());
                            if let Err(error) = response {
                                let _ =
                                    send(&mut stream, 400, &json!({"error":error.message}), None);
                            }
                        }));
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(30))
                    }
                    Err(_) => break,
                }
            }
            drop(listener);
            for client in clients {
                let _ = client.join();
            }
        });
        *guard = Some(Running {
            status: status.clone(),
            alive,
            thread,
        });
        Ok(status)
    }
}
impl Drop for LocalApi {
    fn drop(&mut self) {
        if let Ok(run) = self.running.get_mut() {
            if let Some(run) = run.take() {
                run.alive.store(false, Ordering::Release);
                let _ = run.thread.join();
            }
        }
    }
}
struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Value,
}
fn request(stream: &mut TcpStream) -> Result<Request> {
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 4096];
    let header_end;
    loop {
        let n = stream.read(&mut buffer)?;
        if n == 0 {
            return Err(AppError::new("API", "请求未完整发送"));
        }
        bytes.extend_from_slice(&buffer[..n]);
        if let Some(index) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
            header_end = index + 4;
            if header_end > 16384 {
                return Err(AppError::new("API", "请求头过大"));
            }
            break;
        }
        if bytes.len() > 16384 {
            return Err(AppError::new("API", "请求头过大"));
        }
    }
    let header = std::str::from_utf8(&bytes[..header_end])
        .map_err(|_| AppError::new("API", "请求头无效"))?;
    let mut lines = header.lines();
    let first = lines.next().unwrap_or("");
    let mut first = first.split_whitespace();
    let method = first.next().unwrap_or("").to_owned();
    let path = first.next().unwrap_or("").to_owned();
    let protocol = first.next().unwrap_or("");
    if !matches!(protocol, "HTTP/1.0" | "HTTP/1.1")
        || first.next().is_some()
        || method.is_empty()
        || !method.chars().all(|c| c.is_ascii_uppercase())
        || path.len() > 4096
        || !path.starts_with('/')
    {
        return Err(AppError::new("API", "请求路径无效"));
    }
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((key, value)) = line.split_once(':') {
            if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
                return Err(AppError::new("API", "请求头无效"));
            }
            let key = key.to_ascii_lowercase();
            if headers.contains_key(&key) {
                return Err(AppError::new("API", "重复请求头"));
            }
            headers.insert(key, value.trim().to_owned());
        } else if !line.is_empty() {
            return Err(AppError::new("API", "请求头无效"));
        }
    }
    if headers.contains_key("transfer-encoding") {
        return Err(AppError::new("API", "请使用 Content-Length 请求"));
    }
    let length = headers
        .get("content-length")
        .map(|v| v.parse::<usize>())
        .transpose()
        .map_err(|_| AppError::new("API", "请求大小无效"))?
        .unwrap_or(0);
    if length > 2 * 1024 * 1024 {
        return Err(AppError::new("API", "请求超过 2 MB"));
    }
    while bytes.len() < header_end + length {
        let n = stream.read(&mut buffer)?;
        if n == 0 {
            return Err(AppError::new("API", "请求未完整发送"));
        }
        bytes.extend_from_slice(&buffer[..n]);
    }
    let body = if length == 0 {
        Value::Null
    } else {
        serde_json::from_slice(&bytes[header_end..header_end + length])
            .map_err(|_| AppError::new("API", "JSON 请求无效"))?
    };
    Ok(Request {
        method,
        path,
        headers,
        body,
    })
}
fn send(stream: &mut TcpStream, status: u16, body: &Value, origin: Option<&str>) -> Result<()> {
    let data = if status == 202 || status == 204 {
        String::new()
    } else {
        body.to_string()
    };
    let label = match status {
        200 => "OK",
        202 => "Accepted",
        204 => "No Content",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        406 => "Not Acceptable",
        409 => "Conflict",
        415 => "Unsupported Media Type",
        503 => "Service Unavailable",
        _ => "Bad Request",
    };
    let cors=origin.map(|o|format!("Access-Control-Allow-Origin: {o}\r\nAccess-Control-Allow-Headers: Authorization, Content-Type, MCP-Protocol-Version\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nVary: Origin\r\n")).unwrap_or_default();
    let response=format!("HTTP/1.1 {status} {label}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n{cors}\r\n{data}",data.len());
    stream.write_all(response.as_bytes())?;
    stream.flush()?;
    stream.shutdown(Shutdown::Write)?;
    Ok(())
}
fn handle(
    stream: &mut TcpStream,
    status: &ApiStatus,
    library: &SharedLibrary,
    notify: &(dyn Fn(&str) + Send + Sync),
) -> Result<()> {
    let req = request(stream)?;
    let host = req.headers.get("host").map(String::as_str).unwrap_or("");
    if host != format!("127.0.0.1:{}", status.port) && host != format!("localhost:{}", status.port)
    {
        return send(stream, 403, &json!({"error":"Host rejected"}), None);
    }
    let origin = req.headers.get("origin").map(String::as_str);
    if origin.is_some_and(|o| !valid_origin(o)) {
        return send(stream, 403, &json!({"error":"Origin rejected"}), None);
    }
    if req.method == "OPTIONS" {
        return send(stream, 204, &Value::Null, origin);
    }
    let auth = req
        .headers
        .get("authorization")
        .map(String::as_str)
        .unwrap_or("");
    use sha2::{Digest, Sha256};
    let actual = Sha256::digest(auth.as_bytes());
    let expected = Sha256::digest(format!("Bearer {}", status.token).as_bytes());
    let difference = actual
        .iter()
        .zip(expected.iter())
        .fold(0u8, |a, (x, y)| a | (x ^ y));
    if difference != 0 {
        return send(
            stream,
            401,
            &json!({"error":"Authorization required"}),
            origin,
        );
    }
    if req.method == "POST"
        && !req.headers.get("content-type").is_some_and(|value| {
            value
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .eq_ignore_ascii_case("application/json")
        })
    {
        return send(
            stream,
            415,
            &json!({"error":"Use application/json"}),
            origin,
        );
    }
    let mut lib = library
        .lock()
        .map_err(|_| AppError::new("STATE", "文件服务不可用"))?;
    if req.path == "/mcp" {
        if req.method != "POST" {
            return send(stream, 405, &json!({"error":"Use POST"}), origin);
        }
        if !req.headers.get("accept").is_some_and(|value| {
            value.split(',').any(|item| {
                matches!(
                    item.trim().split(';').next().unwrap_or(""),
                    "application/json" | "*/*"
                )
            })
        }) {
            return send(
                stream,
                406,
                &json!({"error":"Accept application/json and text/event-stream"}),
                origin,
            );
        }
        if req.body["jsonrpc"] == "2.0"
            && req.body.get("method").is_none()
            && req
                .body
                .get("id")
                .is_some_and(|id| id.is_string() || id.is_number())
            && (req.body.get("result").is_some() ^ req.body.get("error").is_some())
        {
            return send(stream, 202, &Value::Null, origin);
        }
        if !req.body.is_object()
            || req.body["jsonrpc"] != "2.0"
            || !req.body["method"].is_string()
            || req
                .body
                .get("id")
                .is_some_and(|id| !(id.is_string() || id.is_i64() || id.is_u64()))
            || req
                .body
                .get("params")
                .is_some_and(|params| !params.is_object())
        {
            return send(
                stream,
                200,
                &json!({"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Invalid JSON-RPC request"}}),
                origin,
            );
        }
        if req
            .headers
            .get("mcp-protocol-version")
            .is_some_and(|v| !matches!(v.as_str(), "2025-03-26" | "2025-06-18" | "2025-11-25"))
        {
            return send(
                stream,
                400,
                &json!({"error":"Unsupported MCP protocol version"}),
                origin,
            );
        }
        if req.body.get("id").is_none() {
            return send(stream, 202, &Value::Null, origin);
        }
        let id = req.body["id"].clone();
        let result = mcp(
            &mut lib,
            &status.workspace,
            status.writable,
            &req.body,
            notify,
        );
        return send(
            stream,
            200,
            &match result {
                Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
                Err(e) => {
                    json!({"jsonrpc":"2.0","id":id,"error":{"code":if e.code == "MCP_METHOD" {-32601} else {-32602},"message":e.message}})
                }
            },
            origin,
        );
    }
    let value = (|| -> Result<Value> {
        Ok(match (req.method.as_str(), req.path.as_str()) {
            ("GET", "/status") => {
                json!({"name":"MarkFolio","workspace":status.workspace,"writable":status.writable})
            }
            ("GET", "/notes") => serde_json::to_value(lib.catalog(&status.workspace)?)
                .map_err(|_| AppError::new("API", "结果无效"))?,
            ("POST", "/read") => {
                let path = note_path(&req.body)?;
                serde_json::to_value(lib.read(&status.workspace, path)?)
                    .map_err(|_| AppError::new("API", "结果无效"))?
            }
            ("POST", "/search") => {
                serde_json::to_value(lib.search(&status.workspace, string(&req.body, "query")?)?)
                    .map_err(|_| AppError::new("API", "结果无效"))?
            }
            ("POST", "/write") => {
                if !status.writable {
                    return Err(AppError::new("PERMISSION", "Write disabled"));
                }
                let path = note_path(&req.body)?;
                let current = lib.read(&status.workspace, path)?;
                let text = preserve_line_endings(string(&req.body, "text")?, &current.line_ending);
                let doc = lib.write(
                    &status.workspace,
                    path,
                    &text,
                    string(&req.body, "expectedVersion")?,
                    &current.encoding,
                )?;
                notify(&status.workspace);
                serde_json::to_value(doc).map_err(|_| AppError::new("API", "结果无效"))?
            }
            ("POST", "/clip") => {
                if !status.writable {
                    return Err(AppError::new("PERMISSION", "Write disabled"));
                }
                let path = clip(&mut lib, &status.workspace, &req.body)?;
                notify(&status.workspace);
                json!({"path":path})
            }
            _ => return Err(AppError::new("ENDPOINT", "Endpoint not found")),
        })
    })();
    match value {
        Ok(value) => send(stream, 200, &value, origin),
        Err(error) => send(
            stream,
            if error.code == "PERMISSION" {
                403
            } else if error.code == "ENDPOINT" {
                404
            } else if error.code == "CONFLICT" {
                409
            } else if error.code == "NOT_FOUND" {
                404
            } else {
                400
            },
            &json!({"error":error.message,"code":error.code}),
            origin,
        ),
    }
}
fn valid_origin(value: &str) -> bool {
    tauri::Url::parse(value).is_ok_and(|url| {
        matches!(url.scheme(), "chrome-extension" | "moz-extension")
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
            && matches!(url.path(), "" | "/")
    })
}
fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value[key]
        .as_str()
        .ok_or_else(|| AppError::new("API", "请求缺少字符串字段"))
}
fn note_path(value: &Value) -> Result<&str> {
    let path = string(value, "path")?;
    crate::library::checked_relative(path)?;
    if path
        .split('/')
        .any(|part| part == ".markfolio" || part == ".git")
        || !std::path::Path::new(path).extension().is_some_and(|ext| {
            ext.eq_ignore_ascii_case("md")
                || ext.eq_ignore_ascii_case("markdown")
                || ext.eq_ignore_ascii_case("mflock")
        })
    {
        return Err(AppError::new(
            "PERMISSION",
            "API 只允许访问工作目录内的笔记",
        ));
    }
    Ok(path)
}
fn preserve_line_endings(text: &str, original: &str) -> String {
    let text = text.replace("\r\n", "\n");
    if original == "crlf" {
        text.replace('\n', "\r\n")
    } else {
        text
    }
}
fn clip(lib: &mut crate::library::Library, workspace: &str, value: &Value) -> Result<String> {
    let title = string(value, "title")?;
    let html = string(value, "html")?;
    let source = string(value, "url")?;
    if title.len() > 512 || html.len() > 2 * 1024 * 1024 || source.len() > 4096 {
        return Err(AppError::new("CLIP", "剪藏内容过大"));
    }
    if !tauri::Url::parse(source).is_ok_and(|url| {
        matches!(url.scheme(), "http" | "https")
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
    }) {
        return Err(AppError::new("CLIP", "剪藏来源地址无效"));
    }
    let name: String = title
        .chars()
        .take(100)
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    lib.ensure_directory(workspace, "Clippings")?;
    let name = if name.trim().is_empty() {
        "Clipping"
    } else {
        &name
    };
    let path = format!(
        "Clippings/{name}-{}.md",
        &uuid::Uuid::new_v4().to_string()[..8]
    );
    let body = htmd::HtmlToMarkdown::builder()
        .skip_tags(vec!["script", "style", "iframe", "object", "embed", "form"])
        .build()
        .convert(html)
        .map_err(|_| AppError::new("CLIP", "HTML 转换失败"))?;
    let properties = serde_yaml::to_string(&json!({"title":title,"source":source,"tags":["clip"]}))
        .map_err(|_| AppError::new("CLIP", "剪藏属性无效"))?;
    let text = format!("---\n{properties}---\n\n{body}\n");
    lib.create(workspace, &path, false)?;
    let result = (|| {
        let doc = lib.read(workspace, &path)?;
        lib.write(workspace, &path, &text, &doc.version, "utf8")?;
        Ok::<_, AppError>(())
    })();
    if let Err(error) = result {
        if let Ok(file) = lib.resolve(workspace, &path, true) {
            let _ = std::fs::remove_file(file);
        }
        return Err(error);
    }
    // A cache failure must not turn a completed file write into a reported failure.
    let _ = lib.reindex(workspace);
    Ok(path)
}
fn mcp(
    lib: &mut crate::library::Library,
    workspace: &str,
    writable: bool,
    message: &Value,
    notify: &(dyn Fn(&str) + Send + Sync),
) -> Result<Value> {
    match string(message, "method")? {
        "initialize" => {
            let requested = string(&message["params"], "protocolVersion")?;
            let version = if matches!(requested, "2025-03-26" | "2025-06-18" | "2025-11-25") {
                requested
            } else {
                "2025-06-18"
            };
            Ok(
                json!({"protocolVersion":version,"capabilities":{"tools":{}},"serverInfo":{"name":"MarkFolio","version":env!("CARGO_PKG_VERSION")}}),
            )
        }
        "ping" => Ok(json!({})),
        "tools/list" => {
            let mut tools = vec![
                json!({"name":"list_notes","description":"List Markdown notes in the selected local workspace","inputSchema":{"type":"object","properties":{}}}),
                json!({"name":"read_note","description":"Read a note and its current file version","inputSchema":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}),
                json!({"name":"search_notes","description":"Search local Markdown notes","inputSchema":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}}),
            ];
            if writable {
                tools.push(json!({"name":"write_note","description":"Write a note only when the expected version matches","inputSchema":{"type":"object","properties":{"path":{"type":"string"},"text":{"type":"string"},"expectedVersion":{"type":"string"}},"required":["path","text","expectedVersion"]}}));
            }
            Ok(json!({"tools":tools}))
        }
        "tools/call" => {
            let params = &message["params"];
            let args = &params["arguments"];
            let name = string(params, "name")?;
            if !matches!(
                name,
                "list_notes" | "read_note" | "search_notes" | "write_note"
            ) {
                return Err(AppError::new("MCP", "工具不存在"));
            }
            let result = (|| -> Result<Value> {
                match name {
                    "list_notes" => serde_json::to_value(lib.catalog(workspace)?),
                    "read_note" => serde_json::to_value(lib.read(workspace, note_path(args)?)?),
                    "search_notes" => {
                        serde_json::to_value(lib.search(workspace, string(args, "query")?)?)
                    }
                    "write_note" if writable => {
                        let path = note_path(args)?;
                        let current = lib.read(workspace, path)?;
                        let text =
                            preserve_line_endings(string(args, "text")?, &current.line_ending);
                        let saved = lib.write(
                            workspace,
                            path,
                            &text,
                            string(args, "expectedVersion")?,
                            &current.encoding,
                        )?;
                        notify(workspace);
                        serde_json::to_value(saved)
                    }
                    _ => return Err(AppError::new("PERMISSION", "未获得写入权限")),
                }
                .map_err(|_| AppError::new("MCP", "工具结果无效"))
            })();
            Ok(match result {
                Ok(data) => {
                    json!({"content":[{"type":"text","text":data.to_string()}],"isError":false})
                }
                Err(error) => {
                    json!({"content":[{"type":"text","text":format!("{}: {}", error.code, error.message)}],"isError":true})
                }
            })
        }
        _ => Err(AppError::new("MCP_METHOD", "方法不支持")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::Library;
    use std::net::Shutdown;
    use std::sync::atomic::AtomicUsize;
    fn fixture(
        writable: bool,
    ) -> (
        tempfile::TempDir,
        LocalApi,
        SharedLibrary,
        ApiStatus,
        Arc<AtomicUsize>,
    ) {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("notes");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("note.md"), "# original\r\nbody\r\n").unwrap();
        let mut library = Library::new(temp.path().join("app")).unwrap();
        let workspace = library.open(root, None).unwrap().id;
        let library = Arc::new(Mutex::new(library));
        let reservation = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = reservation.local_addr().unwrap().port();
        drop(reservation);
        let api = LocalApi::default();
        let count = Arc::new(AtomicUsize::new(0));
        let observed = count.clone();
        let status = api
            .start_server(
                library.clone(),
                workspace,
                port,
                writable,
                Arc::new(move |_| {
                    observed.fetch_add(1, Ordering::SeqCst);
                }),
            )
            .unwrap();
        (temp, api, library, status, count)
    }
    fn exchange(
        status: &ApiStatus,
        method: &str,
        path: &str,
        body: &Value,
        headers: &[(&str, String)],
    ) -> (u16, String, Value) {
        let mut stream = TcpStream::connect(("127.0.0.1", status.port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let body = if body.is_null() {
            String::new()
        } else {
            body.to_string()
        };
        let host = headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case("host"))
            .map(|(_, v)| v.clone())
            .unwrap_or_else(|| format!("127.0.0.1:{}", status.port));
        let authorization = headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case("authorization"))
            .map(|(_, v)| v.clone())
            .unwrap_or_else(|| format!("Bearer {}", status.token));
        let content_type = headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case("content-type"))
            .map(|(_, v)| v.as_str())
            .unwrap_or("application/json");
        let accept = headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case("accept"))
            .map(|(_, v)| v.as_str())
            .unwrap_or("application/json, text/event-stream");
        write!(stream, "{method} {path} HTTP/1.1\r\nHost: {host}\r\nAuthorization: {authorization}\r\nContent-Type: {content_type}\r\nAccept: {accept}\r\nContent-Length: {}\r\n", body.len()).unwrap();
        for (key, value) in headers {
            if !["host", "authorization", "content-type", "accept"]
                .contains(&key.to_ascii_lowercase().as_str())
            {
                write!(stream, "{key}: {value}\r\n").unwrap();
            }
        }
        write!(stream, "\r\n{body}").unwrap();
        stream.shutdown(Shutdown::Write).unwrap();
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 4096];
        loop {
            let count = stream.read(&mut buffer).unwrap_or_else(|error| {
                panic!("{method} {path}: {error}; received {} bytes", bytes.len())
            });
            assert!(count > 0, "{method} {path}: truncated HTTP response");
            bytes.extend_from_slice(&buffer[..count]);
            if let Some(end) = bytes.windows(4).position(|value| value == b"\r\n\r\n") {
                let header = std::str::from_utf8(&bytes[..end]).unwrap();
                let length = header
                    .lines()
                    .find_map(|line| line.strip_prefix("Content-Length: "))
                    .unwrap()
                    .parse::<usize>()
                    .unwrap();
                if bytes.len() >= end + 4 + length {
                    assert_eq!(bytes.len(), end + 4 + length);
                    break;
                }
            }
            assert!(bytes.len() < 4 * 1024 * 1024, "oversized HTTP response");
        }
        let response = String::from_utf8(bytes).unwrap();
        let (head, data) = response.split_once("\r\n\r\n").unwrap();
        let code = head.split_whitespace().nth(1).unwrap().parse().unwrap();
        (
            code,
            head.to_owned(),
            if data.is_empty() {
                Value::Null
            } else {
                serde_json::from_str(data).unwrap()
            },
        )
    }
    #[test]
    fn http_authentication_origin_host_and_restart_are_enforced() {
        let (_temp, api, library, status, _count) = fixture(false);
        assert_eq!(
            exchange(
                &status,
                "GET",
                "/notes",
                &Value::Null,
                &[("Authorization", "Bearer wrong".into())]
            )
            .0,
            401
        );
        assert_eq!(
            exchange(
                &status,
                "GET",
                "/notes",
                &Value::Null,
                &[("Host", "untrusted.test".into())]
            )
            .0,
            403
        );
        assert_eq!(
            exchange(
                &status,
                "GET",
                "/notes",
                &Value::Null,
                &[("Origin", "https://untrusted.test".into())]
            )
            .0,
            403
        );
        let origin = "chrome-extension://abcdefghijklmnop".to_owned();
        let (code, head, _) = exchange(
            &status,
            "POST",
            "/write",
            &json!({"path":"note.md","text":"changed","expectedVersion":"stale"}),
            &[("Origin", origin.clone())],
        );
        assert_eq!(code, 403);
        assert!(head.contains(&format!("Access-Control-Allow-Origin: {origin}")));
        assert_eq!(
            exchange(
                &status,
                "OPTIONS",
                "/notes",
                &Value::Null,
                &[("Origin", origin)]
            )
            .0,
            204
        );
        api.stop().unwrap();
        let restarted = api
            .start_server(
                library,
                status.workspace.clone(),
                status.port,
                false,
                Arc::new(|_| {}),
            )
            .unwrap();
        assert_ne!(status.token, restarted.token);
        assert_eq!(
            exchange(&status, "GET", "/status", &Value::Null, &[]).0,
            401
        );
        assert_eq!(
            exchange(&restarted, "GET", "/status", &Value::Null, &[]).0,
            200
        );
    }
    #[test]
    fn http_and_mcp_writes_preserve_crlf_and_reject_stale_versions() {
        let (_temp, _api, library, status, count) = fixture(true);
        let doc = library
            .lock()
            .unwrap()
            .read(&status.workspace, "note.md")
            .unwrap();
        let request =
            json!({"path":"note.md","text":"# REST\nbody\n","expectedVersion":doc.version});
        assert_eq!(exchange(&status, "POST", "/write", &request, &[]).0, 200);
        assert_eq!(exchange(&status, "POST", "/write", &request, &[]).0, 409);
        let doc = library
            .lock()
            .unwrap()
            .read(&status.workspace, "note.md")
            .unwrap();
        assert_eq!(doc.text, "# REST\r\nbody\r\n");
        let initialize = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","clientInfo":{"name":"test","version":"1"},"capabilities":{}}});
        assert_eq!(
            exchange(&status, "POST", "/mcp", &initialize, &[]).2["result"]["protocolVersion"],
            "2025-11-25"
        );
        let call = json!({"jsonrpc":"2.0","id":"write","method":"tools/call","params":{"name":"write_note","arguments":{"path":"note.md","text":"# MCP\nbody\n","expectedVersion":doc.version}}});
        assert_eq!(
            exchange(&status, "POST", "/mcp", &call, &[]).2["result"]["isError"],
            false
        );
        assert_eq!(
            exchange(&status, "POST", "/mcp", &call, &[]).2["result"]["isError"],
            true
        );
        assert_eq!(count.load(Ordering::SeqCst), 2);
        assert_eq!(
            library
                .lock()
                .unwrap()
                .read(&status.workspace, "note.md")
                .unwrap()
                .text,
            "# MCP\r\nbody\r\n"
        );
        assert_eq!(
            exchange(
                &status,
                "POST",
                "/mcp",
                &json!({"jsonrpc":"2.0","id":2,"method":"unsupported"}),
                &[]
            )
            .2["error"]["code"],
            -32601
        );
        assert_eq!(
            exchange(
                &status,
                "POST",
                "/mcp",
                &json!({"id":3,"method":"ping"}),
                &[]
            )
            .2["error"]["code"],
            -32600
        );
        assert_eq!(
            exchange(
                &status,
                "POST",
                "/read",
                &json!({"path":".markfolio/private.md"}),
                &[]
            )
            .0,
            403
        );
        assert_eq!(
            exchange(
                &status,
                "POST",
                "/read",
                &json!({"path":"../outside.md"}),
                &[]
            )
            .0,
            400
        );
        assert_eq!(
            exchange(
                &status,
                "POST",
                "/mcp",
                &initialize,
                &[("Accept", "text/html".into())]
            )
            .0,
            406
        );
        assert_eq!(
            exchange(
                &status,
                "POST",
                "/mcp",
                &initialize,
                &[("Content-Type", "text/plain".into())]
            )
            .0,
            415
        );
        assert_eq!(
            exchange(
                &status,
                "POST",
                "/mcp",
                &json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
                &[]
            )
            .0,
            202
        );
        assert_eq!(
            exchange(
                &status,
                "POST",
                "/mcp",
                &json!({"jsonrpc":"2.0","id":9,"result":{}}),
                &[]
            )
            .0,
            202
        );
        let clipped = exchange(
            &status,
            "POST",
            "/clip",
            &json!({"title":"Collected note","url":"https://example.test/page","html":"<h1>Collected</h1><p>Local text</p>"}),
            &[],
        );
        assert_eq!(clipped.0, 200);
        let content = library
            .lock()
            .unwrap()
            .read(&status.workspace, clipped.2["path"].as_str().unwrap())
            .unwrap();
        assert!(content.text.contains("Local text"));
        assert!(content.text.contains("https://example.test/page"));
        assert_eq!(
            exchange(
                &status,
                "POST",
                "/clip",
                &json!({"title":"Rejected","url":"javascript:alert(1)","html":"<p>ignored</p>"}),
                &[]
            )
            .0,
            400
        );
    }
}
