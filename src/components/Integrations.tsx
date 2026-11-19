import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { aiConfig, configureAi, aiGenerate, localApiStatus, localApiControl, isTauriRuntime, type AiConfig, type ApiStatus } from "../api";
import { useApp } from "../store";
import { displayError } from "../types";
import { editorActions } from "../Editor";

export function AiDialog({ workspace }: { workspace: string }) {
  const session = useApp(s => s.sessions[workspace]);
  const [config, setConfig] = useState<AiConfig>({ endpoint: "", model: "", hasKey: false });
  const [key, setKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [context, setContext] = useState(false);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [targetPath, setTargetPath] = useState("");
  const alive = useRef(true), running = useRef(false);
  const target = useRef<ReturnType<typeof editorActions.capture>>();
  useEffect(() => {
    alive.current = true;
    void aiConfig().then(c => { if (alive.current) { setConfig(c); setSaved(Boolean(c.endpoint)); } }).catch(e => { if (alive.current) setError(displayError(e)); }).finally(() => { if (alive.current) setLoading(false); });
    return () => { alive.current = false; if (target.current) editorActions.discardCapture(target.current); target.current = undefined; };
  }, []);
  async function save() {
    if (running.current) return; running.current = true; setBusy(true); setError("");
    try {
      const next = await configureAi(config.endpoint, config.model, removeKey ? "" : key, removeKey);
      if (alive.current) { setConfig(next); setKey(""); setRemoveKey(false); setSaved(true); }
    } catch (e) { if (alive.current) setError(displayError(e)); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }
  async function generate() {
    if (running.current) return; running.current = true; setBusy(true); setError(""); setResult("");
    if (target.current) editorActions.discardCapture(target.current);
    target.current = editorActions.capture(workspace); setTargetPath(target.current?.path ?? "");
    try {
      const current = useApp.getState().sessions[workspace];
      const text = context ? editorActions.select(workspace) || current?.documents[current.file]?.text || "" : "";
      const generated = await aiGenerate(prompt, text);
      if (alive.current) setResult(generated);
    } catch (e) {
      if (target.current) editorActions.discardCapture(target.current); target.current = undefined;
      if (alive.current) setError(displayError(e));
    } finally { running.current = false; if (alive.current) setBusy(false); }
  }
  function insert() {
    const destination = target.current;
    if (!destination) return;
    if (!useApp.getState().sessions[workspace]?.documents[destination.path]) { setError(t("原笔记已关闭，请重新选择笔记并生成")); return; }
    if (useApp.getState().sessions[workspace]?.mutating) { setError(t("正在处理文件，请稍后重试")); return; }
    if (!editorActions.insertCaptured(destination, result)) { setError(t("原笔记选区已失效，生成结果已保留，请复制后插入")); return; }
    target.current = undefined; setTargetPath(""); setResult(""); setError("");
  }
  return <><h2>{t("AI 写作助手")}</h2>
    <details open={!saved}><summary>{t("服务配置")}</summary><p className="muted">{t("连接兼容 Chat Completions 的服务，包括本机 Ollama / LM Studio。密钥保存在系统凭据库。")}</p>
      <fieldset disabled={busy || loading} className="settings-fields">
        <label className="form-label">{t("API 地址")}<input aria-label={t("AI 服务地址")} value={config.endpoint} placeholder="http://127.0.0.1:11434/v1/chat/completions" onChange={e => { setSaved(false); setRemoveKey(false); setConfig({ ...config, endpoint: e.target.value, hasKey: false }); }}/></label>
        <label className="form-label">{t("模型名称")}<input aria-label={t("模型名称")} value={config.model} onChange={e => { setSaved(false); setConfig({ ...config, model: e.target.value }); }}/></label>
        <label className="form-label">{t("API 密钥（本机服务可留空）")}<input type="password" autoComplete="off" value={key} disabled={removeKey} placeholder={config.hasKey ? t("已保存；留空保留") : ""} onChange={e => { setSaved(false); setKey(e.target.value); }}/></label>
        {config.hasKey && <label><input type="checkbox" checked={removeKey} onChange={e => { setSaved(false); setRemoveKey(e.target.checked); }}/>{t("删除此服务已保存的密钥")}</label>}
        <button className="secondary" onClick={() => void save()}>{t("保存服务配置")}</button>
      </fieldset>
    </details>
    <label className="form-label">{t("写作要求")}<textarea className="source-input" aria-label={t("AI 写作要求")} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={t("例如：整理为条目清晰的 Markdown 文档")}/></label>
    <label><input type="checkbox" checked={context} onChange={e => setContext(e.target.checked)}/>{t("发送当前选区；无选区时发送当前笔记")}</label>
    <div className="inline-options"><button className="primary" disabled={busy || loading || !saved || !prompt.trim()} onClick={() => void generate()}>{busy ? t("正在生成…") : t("发送并生成")}</button></div>
    <textarea className="source-input ai-result" aria-label={t("AI 生成结果")} value={result} onChange={e => setResult(e.target.value)}/>
    {targetPath && <p className="muted">{t("插入目标：{0}", targetPath)}</p>}
    <button className="secondary" disabled={busy || !result || !targetPath || !session?.documents[targetPath]} onClick={insert}>{t("插入笔记")}</button>
    {error && <p className="form-error" role="alert">{error}</p>}</>;
}

export function ApiDialog({ workspace }: { workspace: string }) {
  const sessions = useApp(s => s.sessions);
  const [status, setStatus] = useState<ApiStatus>();
  const [port, setPort] = useState(41185), [writable, setWritable] = useState(false);
  const [error, setError] = useState(""), [showToken, setShowToken] = useState(false), [busy, setBusy] = useState(true);
  const alive = useRef(true), running = useRef(false), revision = useRef(0);
  useEffect(() => {
    alive.current = true; let unlisten: (() => void) | undefined;
    async function refresh() {
      const current = ++revision.current;
      try { const value = await localApiStatus(); if (alive.current && current === revision.current) { setStatus(value); if (value.running) { setPort(value.port); setWritable(value.writable); } } }
      catch (e) { if (alive.current && current === revision.current) setError(displayError(e)); }
      finally { if (alive.current && current === revision.current && !running.current) setBusy(false); }
    }
    void refresh();
    if (isTauriRuntime()) void listen("local-api-changed", () => void refresh()).then(dispose => { if (alive.current) unlisten = dispose; else dispose(); });
    return () => { alive.current = false; revision.current++; unlisten?.(); };
  }, []);
  async function control(action: "start" | "stop") {
    if (running.current) return; running.current = true; setBusy(true); setError(""); revision.current++;
    try { const value = await localApiControl(workspace, port, writable, action); if (alive.current) { setStatus(value); setShowToken(false); } }
    catch (e) { if (alive.current) setError(displayError(e)); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }
  async function copyToken() { try { await navigator.clipboard.writeText(status?.token ?? ""); } catch (e) { if (alive.current) setError(displayError(e)); } }
  return <><h2>{t("本地 API · MCP · 浏览器剪藏")}</h2><p className="muted">{t("仅监听本机。服务绑定当前选择的工作目录，停止后令牌失效。")}</p>
    <div className="inline-options"><label>{t("端口")}<input type="number" min="1024" max="65535" value={port} disabled={busy || status?.running} onChange={e => setPort(Number(e.target.value))}/></label><label><input type="checkbox" checked={writable} disabled={busy || status?.running} onChange={e => setWritable(e.target.checked)}/>{t("允许写入与剪藏")}</label><button className="primary" disabled={busy || !status?.running && (!Number.isInteger(port) || port < 1024 || port > 65535 || !sessions[workspace])} onClick={() => void control(status?.running ? "stop" : "start")}>{busy ? t("正在处理…") : status?.running ? t("停止服务") : t("启动服务")}</button></div>
    {status?.running && <><p role="status">{t("已启动 · http://127.0.0.1:")}{status.port}</p><p>{t("服务工作目录：{0}", sessions[status.workspace]?.info.name ?? status.workspace)}</p><label className="form-label">{t("访问令牌")}<input type={showToken ? "text" : "password"} readOnly value={status.token}/></label><div className="inline-options"><button onClick={() => setShowToken(!showToken)}>{showToken ? t("隐藏") : t("显示")}{t("令牌")}</button><button onClick={() => void copyToken()}>{t("复制令牌")}</button></div><p>{t("请求须包含 Authorization: Bearer 令牌")}</p><p>{t("MCP 地址：http://127.0.0.1:")}{status.port}/mcp</p></>}
    <details><summary>{t("API 与浏览器扩展")}</summary><p>{t("读取：GET /notes，POST /read（path），POST /search（query）。写入：POST /write（path、text、expectedVersion）。剪藏：POST /clip（title、url、html）。")}</p><p>{t("浏览器剪藏扩展位于项目的 browser-extension 目录。加载扩展后填写本地服务地址与令牌，可保存当前网页或选中文字。")}</p></details>{error && <p className="form-error" role="alert">{error}</p>}</>;
}
