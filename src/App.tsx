import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  BookOpen,
  FolderOpen,
  FilePlus2,
  Search,
  Settings2,
  ChevronRight,
  X,
  Plus,
  MoreHorizontal,
  FileText,
  Paperclip,
  ArrowLeft,
  ArrowRight,
  PanelLeft,
  Columns2,
  Code2,
  Eye,
  Bold,
  Italic,
  Link,
  List,
  ListOrdered,
  Quote,
  SquareCheck,
  Minus,
  RefreshCw,
  Puzzle,
  Sun,
  Moon,
  Check,
  Clock3,
  Braces,
  Info,
  Command as CommandIcon,
} from "lucide-react";
import * as api from "./api";
import { useApp, flushDocuments, relocateBuffers } from "./store";
import {
  displayError,
  fileName,
  parentPath,
  joinPath,
  relativeLink,
  type Dialog,
} from "./types";
import Editor, { editorActions } from "./Editor";
import { PluginButtons, PluginDialogs } from "./components/PluginContributions";
import RichEditor from "./RichEditor";
import ToolWindow, { type ToolTarget } from "./components/ToolWindow";
import Preview from "./Preview";
import {
  importPlugin,
  registerCommand,
  synchronizePlugins,
  useRegistry,
} from "./plugins/runtime";
import { coreCommands } from "./commands";
import {
  effectiveShortcut,
  normalizeShortcut,
  shortcutFromEvent,
} from "./shortcuts";
import { operateFiles, batchSummary } from "./fileOperations";
import { IconButton, Panel, markdownFile } from "./components/Controls";
import FileTree from "./components/FileTree";
import SettingsDialog from "./components/SettingsDialog";
import ConflictDialog from "./components/ConflictDialog";
import DocumentList from "./components/DocumentList";
import { TagSidebar, PropertiesDialog, QuickOpen, visibleNotes } from "./components/NoteManagement";
import type { Dispose } from "./plugins/sdk";

export default function App() {
  const state = useApp();
  const registry = useRegistry();
  const session = state.sessions[state.active];
  const buffer = session?.documents[session.file];
  const [dialog, setDialog] = useState<Dialog>();
  const [quick, setQuick] = useState<"open" | "link">();
  const [tool,setTool]=useState<ToolTarget>();
  const [value, setValue] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [busy, setBusy] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [showPanels, setShowPanels] = useState(false);
  const [listMenu, setListMenu] = useState<{ x: number; y: number }>();
  const menuQueue = useRef(Promise.resolve());
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const dispatchRef = useRef<(id: string) => Promise<void>>(async () => {});
  const allowClose = useRef(false);
  const deferredText = useDeferredValue(buffer?.text ?? "");
  const menuSignature = JSON.stringify(
    coreCommands.map(([id, name, shortcut]) => {
      const hasWorkspace = !!session?.info.available;
      let enabled = true;
      if (
        id.startsWith("file.") ||
        id.startsWith("edit.") ||
        id === "focus.editor"
      )
        enabled = !!buffer && !session?.mutating;
      if (
        [
          "file.new",
          "folder.new",
          "workspace.close",
          "index.rebuild",
          "focus.search",
          "focus.tree",
          "focus.list",
          "files.selectAll",
        ].includes(id)
      )
        enabled = hasWorkspace && !session?.mutating;
      if (["file.move", "file.delete"].includes(id))
        enabled = !!session?.selected.length && !session.mutating;
      if (id === "file.duplicate")
        enabled = !!session?.selected.some(markdownFile) && !session.mutating;
      if (id === "nav.back") enabled = !!session && session.historyIndex > 0;
      if (id === "nav.forward")
        enabled =
          !!session && session.historyIndex < session.history.length - 1;
      if (dialog) enabled = ["edit.undo", "edit.redo"].includes(id);
      let binding = "";
      try {
        binding = normalizeShortcut(
          effectiveShortcut({ id, name, shortcut }, state.settings.shortcuts),
        );
      } catch {
        /* invalid saved settings are left unbound */
      }
      return {
        id,
        enabled,
        shortcut: binding,
        ...(id === "view.sidebar"
          ? { checked: state.settings.showSidebar }
          : id === "view.list"
            ? { checked: state.settings.showList }
            : {}),
      };
    }),
  );
  useEffect(() => {
    if (!api.isTauriRuntime()) return;
    menuQueue.current = menuQueue.current
      .catch(() => {})
      .then(async () => {
        await api.updateMenu(JSON.parse(menuSignature));
      })
      .catch((error) => useApp.getState().setNotice(displayError(error)));
  }, [menuSignature]);
  const guard = useCallback((operation: () => Promise<unknown>) => {
    void operation().catch((error) =>
      useApp.getState().setNotice(displayError(error)),
    );
  }, []);
  function showDialog(next: Dialog) {
    setDialog(next);
    setValue(
      next.type === "rename"
        ? fileName(next.path ?? "")
        : next.type === "move"
          ? (next.path ?? "")
          : "",
    );
    setDialogError("");
    setBusy(false);
    if (next.type === "palette") setPaletteQuery("");
  }

  useEffect(() => {
    void useApp.getState().initialize();
    const dispose = coreCommands.map(([id, name, shortcut]) =>
      registerCommand({
        id,
        name,
        shortcut,
        run: () => dispatchRef.current(id),
      }),
    );
    return () => dispose.forEach((fn) => fn());
  }, []);
  useEffect(()=>{const media=(event:Event)=>setTool({type:"media",...(event as CustomEvent<{workspace:string;path:string}>).detail});window.addEventListener("markfolio-media",media);return()=>window.removeEventListener("markfolio-media",media);},[]);
  useEffect(() => {
    const plugins = state.plugins;
    void Promise.all(
      plugins.map((bundle) =>
        importPlugin(bundle).catch((error) =>
          useApp.getState().setNotice(displayError(error)),
        ),
      ),
    ).then(synchronizePlugins);
  }, [state.plugins]);
  useEffect(() => {
    synchronizePlugins();
  }, [state.order, state.settings.plugins]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        state.settings.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : state.settings.theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [state.settings.theme]);
  useEffect(() => {
    setQuery(session?.query ?? "");
  }, [state.active, session?.folder]);
  useEffect(() => {
    if (!state.active || query === session?.query) return;
    const id = state.active;
    const timeout = setTimeout(
      () => guard(() => useApp.getState().search(id, query)),
      250,
    );
    return () => clearTimeout(timeout);
  }, [query, state.active, session?.query, guard]);
  useEffect(() => {
    if (!state.settings.autoSave) return;
    const timer = setTimeout(() => {
      for (const [id, session] of Object.entries(useApp.getState().sessions))
        for (const [path, buffer] of Object.entries(session.documents))
          if (buffer.dirty && !buffer.saving && !buffer.error)
            guard(() => useApp.getState().save(id, path));
    }, state.settings.autoSaveDelay);
    return () => clearTimeout(timer);
  }, [
    state.sessions,
    state.settings.autoSave,
    state.settings.autoSaveDelay,
    guard,
  ]);
  useEffect(() => {
    if (!api.isTauriRuntime()) return;
    const cleanup: Dispose[] = [];
    const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const indexTimers = new Map<string, ReturnType<typeof setTimeout>>();
    let cancelled = false;
    const keep = (dispose: Dispose) => {
      if (cancelled) dispose();
      else cleanup.push(dispose);
    };
    void listen<string>("menu-command", (event) =>
      guard(() => dispatchRef.current(event.payload)),
    ).then(keep);
    void listen<string>("workspace-changed", (event) => {
      const id = event.payload;
      clearTimeout(refreshTimers.get(id));
      clearTimeout(indexTimers.get(id));
      refreshTimers.set(
        id,
        setTimeout(() => guard(() => useApp.getState().refresh(id)), 300),
      );
      indexTimers.set(
        id,
        setTimeout(() => {
          void useApp.getState().reindex(id);
        }, 1800),
      );
    }).then(keep);
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (allowClose.current) return;
        event.preventDefault();
        try {
          await flushDocuments();
          allowClose.current = true;
          await getCurrentWindow().close();
        } catch (error) {
          useApp.getState().setNotice("关闭已取消：" + displayError(error));
        }
      })
      .then(keep);
    return () => {
      cancelled = true;
      cleanup.forEach((fn) => fn());
      refreshTimers.forEach(clearTimeout);
      indexTimers.forEach(clearTimeout);
    };
  }, [guard]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (dialog?.type === "settings") return;
      if (event.key === "Escape") {
        if (busy) return;
        setDialog(undefined);
        setQuick(undefined);
        setListMenu(undefined);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Tab" && !dialog) {
        event.preventDefault();
        const current = useApp.getState();
        const index = current.order.indexOf(current.active);
        current.activate(
          current.order[
            (index + (event.shiftKey ? -1 : 1) + current.order.length) %
              current.order.length
          ] ?? "",
        );
      }
      if (dialog || event.isComposing || event.defaultPrevented) return;
      const binding = shortcutFromEvent(event);
      if (!binding) return;
      const commands = useRegistry
        .getState()
        .commands.filter(
          (command) =>
            !command.workspace ||
            command.workspace === useApp.getState().active,
        );
      const command = commands.find((command) => {
        try {
          return (
            normalizeShortcut(
              effectiveShortcut(command, useApp.getState().settings.shortcuts),
            ) === binding
          );
        } catch {
          return false;
        }
      });
      if (!command) return;
      if (
        binding === "Delete" &&
        !(event.target as HTMLElement).closest(".tree-scroll,.file-list-scroll")
      )
        return;
      // Native menu owns core accelerators on desktop; plugins and browser preview use this handler.
      if (api.isTauriRuntime() && !command.plugin && binding !== "Delete")
        return;
      event.preventDefault();
      event.stopPropagation();
      guard(async () => command.run());
    };
    window.addEventListener("keydown", keyboard, true);
    return () => window.removeEventListener("keydown", keyboard, true);
  }, [dialog, busy, guard]);

  dispatchRef.current = async (id) => {
    const current = useApp.getState();
    const ws = current.active;
    const active = current.sessions[ws];
    if (
      active?.mutating &&
      (id.startsWith("file.") ||
        id === "folder.new" ||
        id === "workspace.close")
    )
      return;
    switch (id) {
      case "workspace.open":
        await current.openWorkspace();
        break;
      case "workspace.close":
        if (active) await current.closeWorkspace(ws);
        break;
      case "file.new":
        if (active)
          showDialog({ type: "new-file", workspace: ws, path: active.folder });
        break;
      case "folder.new":
        if (active)
          showDialog({
            type: "new-folder",
            workspace: ws,
            path: active.folder,
          });
        break;
      case "file.save":
        if (active?.file) {
          await current.save(ws, active.file);
          current.setNotice("文档已保存");
        }
        break;
      case "file.rename":
        if (active?.file)
          showDialog({ type: "rename", workspace: ws, path: active.file });
        break;
      case "file.duplicate": {
        if (!active || active.mutating) break;
        const paths = (
          active.selected.length
            ? active.selected
            : active.file
              ? [active.file]
              : []
        ).filter(markdownFile);
        if (!paths.length) break;
        const result = await operateFiles(ws, paths, "duplicate");
        current.setNotice(batchSummary(result));
        if (result.completed.length === 1 && result.completed[0].to)
          await current.openDocument(ws, result.completed[0].to);
        break;
      }
      case "file.move":
      case "file.delete":
        if (active && !active.mutating && active.selected.length)
          showDialog({
            type: id === "file.move" ? "batch-move" : "batch-delete",
            workspace: ws,
            paths: [...active.selected],
          });
        break;
      case "files.selectAll":
        if (active) current.selectFiles(ws,(active.query?active.hits:visibleNotes(active,current.settings)).map(entry=>entry.path));
        break;
      case "nav.quickOpen": setQuick("open"); break;
      case "tools.attachments": case "tools.trash": case "tools.transfer": if(active)setTool({type:id.slice(6),workspace:ws});break;
      case "file.chooseLink": setQuick("link"); break;
      case "file.copyLink":
        if(active?.file) { await navigator.clipboard.writeText("markfolio://open?workspace="+encodeURIComponent(ws)+"&path="+encodeURIComponent(active.file));current.setNotice("笔记链接已复制"); }
        break;
      case "edit.moveLineUp": case "edit.moveLineDown": case "edit.copyLineUp": case "edit.copyLineDown": case "edit.deleteLine": case "edit.toggleComment": case "edit.selectAll": case "edit.selectLine": case "edit.indentMore": case "edit.indentLess": case "edit.sortLines": case "edit.sortLinesReverse":
        editorActions.command(ws,id.slice(5));break;
      case "focus.search":
        current.updateSettings({ showList: true });
        requestAnimationFrame(() => searchRef.current?.focus());
        break;
      case "focus.tree":
        current.updateSettings({ showSidebar: true });
        requestAnimationFrame(() =>
          (document.querySelector(".tree-scroll") as HTMLElement)?.focus(),
        );
        break;
      case "focus.list":
        current.updateSettings({ showList: true });
        requestAnimationFrame(() =>
          (document.querySelector(".file-list-scroll") as HTMLElement)?.focus(),
        );
        break;
      case "focus.editor":
        if (current.settings.mode === "preview")
          current.updateSettings({ mode: "editor" });
        requestAnimationFrame(() => editorActions.focus(ws));
        break;
      case "file.properties":
        if (active?.file)
          showDialog({ type: "properties", workspace: ws, path: active.file });
        break;
      case "file.external":
        if (active?.file) {
          await current.save(ws, active.file);
          await api.openLocalFile(ws, active.file);
        }
        break;
      case "file.attach":
        if (active?.file) {
          const path = await api.attachFile(ws, parentPath(active.file));
          if (path) {
            const reference = relativeLink(active.file, path);
            editorActions.insert(
              ws,
              `${/\.(png|jpe?g|webp|gif|svg)$/i.test(path) ? "!" : ""}[${fileName(path)}](${reference})`,
            );
            await current.refresh(ws);
          }
        }
        break;
      case "file.print":
        if (active?.file) window.print();
        break;
      case "edit.undo":
        if (document.activeElement?.closest(".cm-editor"))
          editorActions.undo(ws);
        else if (document.activeElement?.matches("input,textarea"))
          document.execCommand("undo");
        else editorActions.undo(ws);
        break;
      case "edit.redo":
        if (document.activeElement?.closest(".cm-editor"))
          editorActions.redo(ws);
        else if (document.activeElement?.matches("input,textarea"))
          document.execCommand("redo");
        else editorActions.redo(ws);
        break;
      case "edit.find":
        editorActions.find(ws);
        break;
      case "view.sidebar":
        current.updateSettings({ showSidebar: !current.settings.showSidebar });
        break;
      case "view.list":
        current.updateSettings({ showList: !current.settings.showList });
        break;
      case "view.cycle":
        current.updateSettings({
          mode:
            current.settings.mode === "split"
              ? "editor"
              : current.settings.mode === "editor"
                ? "preview"
                : "split",
        });
        break;
      case "view.reset":
        current.updateSettings({
          showSidebar: true,
          showList: true,
          mode: "split",
          sidebarWidth: 246,
          listWidth: 276,
        });
        break;
      case "nav.back":
        await current.navigate(ws, -1);
        break;
      case "nav.forward":
        await current.navigate(ws, 1);
        break;
      case "index.rebuild":
        if (active) await current.reindex(ws, true);
        break;
      case "app.palette":
        showDialog({ type: "palette" });
        break;
      case "app.settings":
        showDialog({ type: "settings" });
        break;
      case "app.plugins":
        showDialog({ type: "settings", tab: "plugins" });
        break;
      case "app.about":
        showDialog({ type: "about" });
        break;
      case "app.quit":
        await flushDocuments();
        if (api.isTauriRuntime()) {
          allowClose.current = true;
          await getCurrentWindow().close();
        }
        break;
    }
  };

  async function submitEntry() {
    if (!dialog?.workspace) return;
    setBusy(true);
    setDialogError("");
    const id = dialog.workspace;
    const path = dialog.path ?? "";
    try {
      if (
        dialog.type === "delete" ||
        dialog.type === "batch-delete" ||
        dialog.type === "batch-move"
      ) {
        const paths = dialog.paths ?? [path];
        const result = await operateFiles(
          id,
          paths,
          dialog.type === "batch-move" ? "move" : "delete",
          value.trim(),
        );
        useApp.getState().setNotice(batchSummary(result));
        if (result.failed.length) {
          setDialog({
            ...dialog,
            paths: result.failed.map((item) => item.path),
          });
          setDialogError(
            result.failed
              .map((item) => `${item.path}：${item.message}`)
              .join("；"),
          );
          return;
        }
      } else {
        const name = value.trim();
        if (!name || /[<>:"\\|?*\u0000-\u001f]/.test(name))
          throw new Error("请输入有效名称");
        if (dialog.type === "new-file" || dialog.type === "new-folder") {
          if (name.includes("/")) throw new Error("名称不能包含路径分隔符");
          const destination = joinPath(
            path,
            dialog.type === "new-file" && !/\.(md|markdown|txt)$/i.test(name)
              ? name + ".md"
              : name,
          );
          await api.createEntry(id, destination, dialog.type === "new-folder");
          if (dialog.type === "new-file")
            await useApp.getState().openDocument(id, destination);
        } else {
          const destination =
            dialog.type === "move" ? name : joinPath(parentPath(path), name);
          await relocateBuffers(id, path, destination);
        }
      }
      await useApp.getState().refresh(id);
      void useApp.getState().reindex(id);
      setDialog(undefined);
    } catch (error) {
      setDialogError(displayError(error));
    } finally {
      setBusy(false);
    }
  }
  function resize(
    event: React.PointerEvent,
    field: "sidebarWidth" | "listWidth",
  ) {
    event.preventDefault();
    const start = event.clientX;
    const original = state.settings[field];
    const move = (event: PointerEvent) =>
      useApp.getState().updateSettings({
        [field]: Math.max(175, Math.min(500, original + event.clientX - start)),
      });
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }
  const panels = registry.panels.filter(
    (panel) => panel.workspace === state.active,
  );
  const filteredCommands = registry.commands.filter(
    (command) =>
      (!command.workspace || command.workspace === state.active) &&
      command.name.toLowerCase().includes(paletteQuery.toLowerCase()),
  );
  const settings = state.settings;
  const run = (id: string) => guard(() => dispatchRef.current(id));
  const format = (before: string, after = "", placeholder = "") =>
    editorActions.insert(state.active, placeholder, before, after);

  return (
    <div className="app-shell">
      <header className="workspace-bar">
        <div className="brand">
          <span className="brand-mark">
            <BookOpen size={22} />
          </span>
          <span>
            Mark<span className="brand-accent">Folio</span>
          </span>
        </div>
        <div
          className="workspace-tabs"
          role="tablist"
          aria-label="工作目录页签"
        >
          {state.order.map((id) => (
            <div
              key={id}
              className={`workspace-tab ${state.active === id ? "selected" : ""}`}
              role="tab"
              aria-selected={state.active === id}
              onClick={() => state.activate(id)}
            >
              <FolderOpen size={14} />
              <span>{state.sessions[id].info.name}</span>
              {!state.sessions[id].info.available && (
                <span className="unavailable">!</span>
              )}
              <button
                aria-label={`关闭工作目录 ${state.sessions[id].info.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  guard(() => state.closeWorkspace(id));
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <IconButton
            label="打开另一个工作目录"
            onClick={() => run("workspace.open")}
          >
            <Plus size={17} />
          </IconButton>
        </div>
        <div className="header-actions"><PluginButtons workspace={state.active} kind="menu" />
          <IconButton label="命令面板" onClick={() => run("app.palette")}>
            <CommandIcon size={17} />
          </IconButton>
          <IconButton
            label="切换主题"
            onClick={() =>
              state.updateSettings({
                theme: settings.theme === "dark" ? "light" : "dark",
              })
            }
          >
            {settings.theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </IconButton>
          <IconButton label="设置" onClick={() => run("app.settings")}>
            <Settings2 size={17} />
          </IconButton>
        </div>
      </header>
      {!state.ready ? (
        <div className="loading">正在打开 MarkFolio…</div>
      ) : !session ? (
        <main className="welcome">
          <div className="welcome-book">
            <BookOpen size={54} strokeWidth={1.3} />
          </div>
          <span className="eyebrow">YOUR WORDS, YOUR FILES</span>
          <h1>让每一页，井然有序。</h1>
          <p>
            打开一个本地文件夹，开始管理 Markdown 文档。
            <br />
            多个工作目录，各自保持独立，随时切换。
          </p>
          <button
            className="primary large"
            onClick={() => run("workspace.open")}
          >
            <FolderOpen size={18} />
            打开工作目录<span className="key-hint">Ctrl O</span>
          </button>
          <div className="welcome-features">
            <span>
              <FileText size={16} />
              原始 Markdown
            </span>
            <span>
              <Columns2 size={16} />
              多工作目录
            </span>
            <span>
              <Puzzle size={16} />
              插件扩展
            </span>
          </div>
          {!api.isTauriRuntime() && (
            <p className="preview-note">
              浏览器界面预览 · 本地文件功能请使用桌面版
            </p>
          )}
        </main>
      ) : (
        <main className="workspace-content">
          {settings.showSidebar && (
            <>
              <aside
                className="sidebar"
                style={{ width: settings.sidebarWidth }}
              >
                <FileTree session={session} action={showDialog} /><TagSidebar session={session} />
                <div className="sidebar-footer">
                  <div className="workspace-indicator">
                    <span className="green-dot" />
                    <span>本地工作目录</span>
                  </div>
                  <button onClick={() => run("app.plugins")}>
                    <Puzzle size={15} />
                    插件
                    <ChevronRight size={13} />
                  </button>
                </div>
              </aside>
              <div
                className="resize-handle"
                onPointerDown={(event) => resize(event, "sidebarWidth")}
              />
            </>
          )}
          {settings.showList && (<><DocumentList session={session} query={query} setQuery={setQuery} searchRef={searchRef} run={run} /><div className="resize-handle" onPointerDown={event=>resize(event,"listWidth")} /></>)}
          <section className="document-area">
            <div className="document-navigation">
              <div>
                <IconButton
                  label="后退"
                  onClick={() => run("nav.back")}
                  disabled={session.historyIndex <= 0}
                >
                  <ArrowLeft size={16} />
                </IconButton>
                <IconButton
                  label="前进"
                  onClick={() => run("nav.forward")}
                  disabled={session.historyIndex >= session.history.length - 1}
                >
                  <ArrowRight size={16} />
                </IconButton>
                {!settings.showSidebar && (
                  <IconButton
                    label="显示侧栏"
                    onClick={() => run("view.sidebar")}
                  >
                    <PanelLeft size={16} />
                  </IconButton>
                )}
                <span className="breadcrumb">
                  {session.info.name}
                  <ChevronRight size={12} />
                  {session.file || "选择一篇文档"}
                </span>
              </div>
              <div>
                {panels.length > 0 && (
                  <IconButton
                    label="插件面板"
                    active={showPanels}
                    onClick={() => setShowPanels(!showPanels)}
                  >
                    <Puzzle size={16} />
                  </IconButton>
                )}
                <IconButton
                  label="文档属性"
                  disabled={!buffer}
                  onClick={() => run("file.properties")}
                >
                  <MoreHorizontal size={18} />
                </IconButton>
              </div>
            </div>
            {buffer ? (
              <>
                <div className="document-title">
                  <div>
                    <span className="file-type">MARKDOWN</span>
                    <h1
                      title="双击重命名"
                      onDoubleClick={() => run("file.rename")}
                    >
                      {fileName(buffer.path).replace(/\.(md|markdown)$/i, "")}
                    </h1>
                  </div>
                  <span className={`save-state ${buffer.error ? "error" : ""}`}>
                    {buffer.error ? (
                      <Info size={13} />
                    ) : buffer.saving || buffer.dirty ? (
                      <Clock3 size={13} />
                    ) : (
                      <Check size={13} />
                    )}
                    {buffer.error
                      ? "需要处理冲突"
                      : buffer.saving
                        ? "正在保存"
                        : buffer.dirty
                          ? "未保存"
                          : "已保存"}
                  </span>
                </div>
                <div className="format-toolbar" onPointerDown={e=>{if((e.target as Element).closest(".format-tools"))e.preventDefault();}}>
                  <div className="format-tools"><PluginButtons workspace={state.active} kind="toolbar" />
                    <IconButton
                      label="加粗"
                      onClick={() => format("**", "**", "加粗文本")}
                    >
                      <Bold size={15} />
                    </IconButton>
                    <IconButton
                      label="斜体"
                      onClick={() => format("*", "*", "斜体文本")}
                    >
                      <Italic size={15} />
                    </IconButton>
                    <IconButton
                      label="标题"
                      onClick={() => format("## ", "", "标题")}
                    >
                      <span className="heading-icon">H</span>
                    </IconButton>
                    <span className="toolbar-separator" />
                    <IconButton
                      label="插入链接"
                      onClick={() => format("[", "](链接地址)", "链接文本")}
                    >
                      <Link size={15} />
                    </IconButton>
                    <IconButton
                      label="行内代码"
                      onClick={() => format("`", "`", "代码")}
                    >
                      <Code2 size={16} />
                    </IconButton>
                    <IconButton
                      label="代码块"
                      onClick={() => format("```\n", "\n```", "代码")}
                    >
                      <Braces size={16} />
                    </IconButton>
                    <IconButton label="附件" onClick={() => run("file.attach")}>
                      <Paperclip size={15} />
                    </IconButton>
                    <span className="toolbar-separator" />
                    <IconButton
                      label="无序列表"
                      onClick={() => format("- ", "", "列表项")}
                    >
                      <List size={16} />
                    </IconButton>
                    <IconButton
                      label="有序列表"
                      onClick={() => format("1. ", "", "列表项")}
                    >
                      <ListOrdered size={16} />
                    </IconButton>
                    <IconButton
                      label="待办"
                      onClick={() => format("- [ ] ", "", "待办事项")}
                    >
                      <SquareCheck size={15} />
                    </IconButton>
                    <IconButton
                      label="引用"
                      onClick={() => format("> ", "", "引用")}
                    >
                      <Quote size={15} />
                    </IconButton>
                    <IconButton
                      label="分隔线"
                      onClick={() => format("\n---\n")}
                    >
                      <Minus size={16} />
                    </IconButton>
                  </div>
                  <div className="view-modes">
                    <button title="Markdown / 富文本切换" onClick={()=>state.updateSettings({editorMode:settings.editorMode==="markdown"?"rich":"markdown"})}>{settings.editorMode==="markdown"?"富文本":"Markdown"}</button>
                    <IconButton
                      label="仅编辑"
                      active={settings.mode === "editor"}
                      onClick={() => state.updateSettings({ mode: "editor" })}
                    >
                      <Code2 size={15} />
                    </IconButton>
                    <IconButton
                      label="编辑与预览"
                      active={settings.mode === "split"}
                      onClick={() => state.updateSettings({ mode: "split" })}
                    >
                      <Columns2 size={15} />
                    </IconButton>
                    <IconButton
                      label="仅预览"
                      active={settings.mode === "preview"}
                      onClick={() => state.updateSettings({ mode: "preview" })}
                    >
                      <Eye size={15} />
                    </IconButton>
                  </div>
                </div>
                {buffer.error && (
                  <div className="conflict-banner">
                    <Info size={15} />
                    <span>{buffer.error}</span>
                    <button
                      onClick={() =>
                        showDialog({
                          type: "conflict",
                          workspace: state.active,
                          path: buffer.path,
                        })
                      }
                    >
                      比较与处理
                    </button>
                  </div>
                )}
                <div className={`editing-layout mode-${settings.mode}`}>
                  <div className="editing-panes">
                    {settings.mode !== "preview" && (
                      <div className="editor-pane">
                        <div className="pane-label">编辑器</div>
                        {settings.editorMode === "rich" ? <RichEditor key={`${state.active}:${buffer.path}`} workspace={state.active} buffer={buffer} settings={settings} readOnly={session.mutating}/> : <Editor
                          workspace={state.active}
                          buffer={buffer}
                          settings={settings}
                          readOnly={session.mutating}
                        />}
                      </div>
                    )}
                    {
                      <div className="preview-pane">
                        <div className="pane-label">预览</div>
                        <Preview
                          workspace={state.active}
                          path={buffer.path}
                          text={deferredText}
                          math={settings.math}
                          diagrams={settings.diagrams}
                        />
                      </div>
                    }
                  </div>
                  {showPanels && (
                    <aside className="plugin-panels">
                      {panels.map((panel) => (
                        <Panel
                          key={`${panel.plugin}:${panel.id}`}
                          panel={panel}
                        />
                      ))}
                    </aside>
                  )}
                </div>
                <footer className="document-status">
                  <span>
                    <FileText size={12} />
                    {buffer.text.replace(/\s/g, "").length} 字符
                    <span className="status-divider" />
                    {buffer.text.split("\n").length} 行
                  </span>
                  <span>
                    {session.indexing && (
                      <>
                        <RefreshCw size={11} className="spinning" />
                        索引中
                        <span className="status-divider" />
                      </>
                    )}
                    {buffer.encoding.toUpperCase()}
                    <span className="status-divider" />
                    {buffer.lineEnding.toUpperCase()}
                    <span className="status-divider" />
                    Markdown
                  </span>
                </footer>
              </>
            ) : (
              <div className="no-document">
                <BookOpen size={46} strokeWidth={1} />
                <h2>选择一篇笔记</h2>
                <p>在文件树中打开文档，或创建新的 Markdown 笔记。</p>
                <button className="primary" onClick={() => run("file.new")}>
                  <FilePlus2 size={16} />
                  新建笔记
                </button>
              </div>
            )}
          </section>
        </main>
      )}
      {state.notice && (
        <div className="toast" role="status">
          <Info size={16} />
          <span>{state.notice}</span>
          <button aria-label="关闭提示" onClick={() => state.setNotice("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {listMenu && (
        <>
          <div
            className="context-backdrop"
            onClick={() => setListMenu(undefined)}
          />
          <div
            className="context-menu"
            style={{ left: listMenu.x, top: listMenu.y }}
            role="menu"
          >
            {[
              ["file.duplicate", "复制笔记"],
              ["file.move", "移动到…"],
              ["file.delete", "移入回收站"],
              ["files.selectAll", "全选文件"],
            ].map(([id, label]) => (
              <button
                role="menuitem"
                key={id}
                disabled={session?.mutating}
                onClick={() => {
                  setListMenu(undefined);
                  run(id);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      {quick && session && <div className="modal-backdrop"><section className="modal palette-modal" role="dialog" aria-modal="true" aria-label="快速打开"><button className="modal-close" onClick={()=>setQuick(undefined)}><X size={18}/></button><QuickOpen workspace={state.active} insertLink={quick==="link"} close={()=>setQuick(undefined)} /></section></div>}
      <PluginDialogs/>
      {tool&&<ToolWindow target={tool} close={()=>setTool(undefined)}/>}
      {dialog?.type === "settings" && (
        <div className="modal-backdrop">
          <SettingsDialog
            initialTab={dialog.tab ?? "general"}
            close={() => setDialog(undefined)}
          />
        </div>
      )}
      {dialog && dialog.type !== "settings" && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (!busy && event.target === event.currentTarget)
              setDialog(undefined);
          }}
        >
          <section
            className={`modal ${dialog.type === "palette" ? "palette-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label="文档操作"
          >
            <button
              className="modal-close"
              aria-label="关闭对话框"
              disabled={busy}
              onClick={() => setDialog(undefined)}
            >
              <X size={18} />
            </button>
            {dialog.type === "palette" ? (
              <>
                <div className="palette-search">
                  <Search size={18} />
                  <input
                    autoFocus
                    aria-label="搜索命令"
                    placeholder="输入命令名称…"
                    value={paletteQuery}
                    onChange={(event) => setPaletteQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && filteredCommands[0]) {
                        guard(async () => {
                          setDialog(undefined);
                          await filteredCommands[0].run();
                        });
                      }
                    }}
                  />
                </div>
                <div className="palette-results">
                  {filteredCommands.map((command) => (
                    <button
                      key={command.id}
                      onClick={() => {
                        setDialog(undefined);
                        guard(async () => command.run());
                      }}
                    >
                      <span>
                        {command.plugin ? (
                          <Puzzle size={14} />
                        ) : (
                          <CommandIcon size={14} />
                        )}
                        {command.name}
                      </span>
                      <kbd>
                        {effectiveShortcut(command, settings.shortcuts)}
                      </kbd>
                    </button>
                  ))}
                </div>
                <div className="palette-footer">
                  Enter 执行命令<span>Esc 关闭</span>
                </div>
              </>
            ) : dialog.type === "properties" ? (
              <PropertiesDialog workspace={dialog.workspace ?? state.active} path={dialog.path ?? ""} close={()=>setDialog(undefined)} />
            ) : dialog.type === "about" ? (
              <>
                <div className="about-icon">
                  <BookOpen size={34} />
                </div>
                <h2>MarkFolio</h2>
                <p>本地 Markdown 文档管理工具</p>
                <p className="muted">
                  版本 {state.version || "0.1.0"} · Tauri + Rust + React
                </p>
                <p>文档属于你。工作目录各自独立，插件按需扩展。</p>
              </>
            ) : dialog.type === "conflict" ? (
              <ConflictDialog
                workspace={dialog.workspace ?? ""}
                path={dialog.path ?? ""}
                close={() => setDialog(undefined)}
              />
            ) : (
              <>
                <h2>
                  {
                    (
                      {
                        "new-file": "新建笔记",
                        "new-folder": "新建文件夹",
                        rename: "重命名",
                        move: "移动文件",
                        delete: "移入回收站",
                        "batch-delete": "选中文件移入回收站",
                        "batch-move": "移动选中文件",
                      } as Record<string, string>
                    )[dialog.type]
                  }
                </h2>
                <p className="muted">
                  {dialog.type === "delete" || dialog.type === "batch-delete"
                    ? `${dialog.paths?.length ?? 1} 项将移入系统回收站，可以在系统中恢复。未保存的文件会保留。`
                    : dialog.type === "batch-move"
                      ? "输入目标文件夹的相对路径。留空表示工作目录根目录，目标需已存在。"
                      : dialog.type === "move"
                        ? "输入相对于工作目录的目标路径，目标文件夹需已存在。"
                        : dialog.type === "rename"
                          ? "重命名实际文件，正文内容保持原样。"
                          : `创建位置：${dialog.path || "工作目录根目录"}`}
                </p>
                {dialog.paths && (
                  <ul className="batch-paths">
                    {dialog.paths.map((path) => (
                      <li key={path}>{path}</li>
                    ))}
                  </ul>
                )}
                {dialog.type !== "delete" && dialog.type !== "batch-delete" && (
                  <input
                    className="text-input"
                    autoFocus
                    aria-label="名称或目标路径"
                    placeholder={
                      dialog.type === "new-file" ? "笔记名称" : "名称"
                    }
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void submitEntry();
                    }}
                  />
                )}
                {dialogError && <p className="form-error">{dialogError}</p>}
                <div className="modal-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => setDialog(undefined)}
                  >
                    取消
                  </button>
                  <button
                    className={
                      dialog.type === "delete" || dialog.type === "batch-delete"
                        ? "danger"
                        : "primary"
                    }
                    disabled={busy}
                    onClick={() => void submitEntry()}
                  >
                    {busy
                      ? "处理中…"
                      : dialog.type === "delete" ||
                          dialog.type === "batch-delete"
                        ? "移入回收站"
                        : "确定"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
