import { t, setLocale, useLocale } from "./i18n";
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
  FolderOpen,
  FilePlus2,
  Search,
  ChevronRight,
  X,
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
  type Settings,
} from "./types";
import Editor, { editorActions } from "./Editor";
import { PluginButtons, PluginDialogs } from "./components/PluginContributions";
import { checkReminders } from "./reminders";
import RichEditor from "./RichEditor";
import ToolWindow, { type ToolTarget } from "./components/ToolWindow";
import Preview from "./Preview";
import {
  importPlugin,
  definitions,
  removePlugin,
  registerCommand,
  synchronizePlugins,
  useRegistry,
} from "./plugins/runtime";
import { coreCommands } from "./commands";
import { nextEditorLayout,noteSortFor,noteSortPatch } from "./settings";
import { htmlToMarkdown } from "./conversion";
import { createTOC } from "./markdown";
import { updateMetadata } from "./metadata";
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
import { TagSidebar, PropertiesDialog, StatisticsDialog, QuickOpen, visibleNotes } from "./components/NoteManagement";
import TitleBar from "./components/TitleBar";
import FileTabs from "./components/FileTabs";
import AboutDialog from "./components/AboutDialog";
import type { Dispose } from "./plugins/sdk";

export default function App() {
  const locale = useLocale();
  const state = useApp();
  useEffect(()=>setLocale(state.settings.locale),[state.settings.locale]);
  const registry = useRegistry();
  const session = state.sessions[state.active];
  const buffer = session?.documents[session.file];
  const [dialog, setDialog] = useState<Dialog>();
  const [quick, setQuick] = useState<"open" | "link">();
  const [tool,setTool]=useState<ToolTarget>();
  const [externalSessions,setExternalSessions]=useState<string[]>([]);
  const receiveExternalSessions=(sessions:api.ExternalSession[])=>setExternalSessions(sessions.map(s=>`${s.workspace}:${s.path}`));
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
      const sorting=session?noteSortFor(state.settings,state.active,session.folder,session.view):{sort:state.settings.sort,reverseSort:state.settings.reverseSort};
      let enabled = true;
      if (
        id.startsWith("file.") ||
        id.startsWith("edit.") ||
        id.startsWith("format.") ||
        ["focus.editor","focus.preview","focus.title","focus.toolbar"].includes(id)
      )
        enabled = !!buffer && !session?.mutating;
      if (
        [
          "file.new",
          "file.newTodo",
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
      if (["workspace.open","workspace.close"].includes(id)&&!api.isMainWindow())enabled=false;
      if (id === "file.externalStop")enabled=!!session&&externalSessions.includes(`${state.active}:${session.file}`);
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
            : id === "view.noteCounts" ? {checked:state.settings.showNoteCounts}
            : id === "view.todoTop" ? {checked:state.settings.uncompletedTodosOnTop}
            : id === "view.completedTodos" ? {checked:state.settings.showCompletedTodos}
            : id === "view.tabFocus" ? {checked:state.settings.tabMovesFocus} : {}),
        ...(id.startsWith("view.sort")&&id!=="view.sortReverse"?{checked:sorting.sort===id.slice(9).toLowerCase()}:{}),
        ...(id==="view.sortReverse"?{checked:sorting.reverseSort}:{}),
        ...(id==="view.perFolderSort"?{checked:state.settings.perFolderSort}:{}),
        ...(id==="view.folderSortName"?{checked:state.settings.folderSort==="name"}:{}),
        ...(id==="view.folderSortModified"?{checked:state.settings.folderSort==="modified"}:{}),
        ...(id==="view.folderSortReverse"?{checked:state.settings.folderSortReverse}:{}),
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
  function closeAbout() {
    setDialog(undefined);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(".app-menu-trigger")?.focus());
  }
  function openNoticesFromAbout() {
    setDialog(undefined);
    setTool({ type: "notices", workspace: state.active });
  }
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
        name: t(name),
        shortcut,
        run: () => dispatchRef.current(id),
      }),
    );
    return () => dispose.forEach((fn) => fn());
  }, [locale]);
  useEffect(()=>{const media=(event:Event)=>setTool({type:"media",...(event as CustomEvent<{workspace:string;path:string}>).detail});window.addEventListener("markfolio-media",media);return()=>window.removeEventListener("markfolio-media",media);},[]);
  useEffect(() => {
    const plugins = state.plugins;
    for(const definition of definitions())if(!["daily-note","markdown-tools","word-statistics"].includes(definition.manifest.id)&&!plugins.some(bundle=>bundle.manifest.id===definition.manifest.id))removePlugin(definition.manifest.id);
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
  }, [state.order, state.settings.plugins, state.settings.safeMode]);
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
    let pluginRevision=0;
    let cancelled = false;
    const keep = (dispose: Dispose) => {
      if (cancelled) dispose();
      else cleanup.push(dispose);
    };
    void listen<string>("menu-command", (event) =>
      guard(() => dispatchRef.current(event.payload)),
    ).then(keep);
    void listen<api.ExternalSession[]>("external-edit-sessions",event=>receiveExternalSessions(event.payload)).then(keep);
    void listen<{origin:string;settings:Settings}>("settings-changed",event=>{if(event.payload.origin!==getCurrentWindow().label)useApp.getState().receiveSettings(event.payload.settings);}).then(keep);
    void listen("plugins-changed",()=>{const revision=++pluginRevision;void api.listPlugins().then(plugins=>{if(!cancelled&&revision===pluginRevision)useApp.setState({plugins});}).catch(error=>{if(!cancelled)useApp.getState().setNotice(displayError(error));});}).then(keep);
    void listen<string>("prepare-exit",event=>{
      const ready=window.dispatchEvent(new Event("markfolio-before-close",{cancelable:true}));
      if(!ready){guard(()=>api.exitResponse(event.payload,false));return;}
      const shell=document.querySelector<HTMLElement>(".app-shell");if(shell)shell.inert=true;
      void flushDocuments().then(()=>api.exitResponse(event.payload,true)).catch(error=>{useApp.getState().setNotice(t("关闭已取消：")+displayError(error));void api.exitResponse(event.payload,false);});
    }).then(keep);
    void listen<string>("exit-cancelled",event=>{const shell=document.querySelector<HTMLElement>(".app-shell");if(shell)shell.inert=false;useApp.getState().setNotice(t(event.payload));}).then(keep);
    void listen<string>("workspace-changed", (event) => {
      const id = event.payload;
      void api.externalEditorSessions().then(receiveExternalSessions).catch(()=>{});
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
        if(getCurrentWindow().label==="main"&&!(useApp.getState().settings.minimizeToTray&&useApp.getState().settings.tray)){await api.requestExit();return;}
        if(!window.dispatchEvent(new Event("markfolio-before-close",{cancelable:true})))return;
        const shell=document.querySelector<HTMLElement>(".app-shell");if(shell)shell.inert=true;
        try {
          await flushDocuments();
          if(getCurrentWindow().label==="main"&&useApp.getState().settings.minimizeToTray&&useApp.getState().settings.tray){await getCurrentWindow().hide();if(shell)shell.inert=false;return;}
          allowClose.current = true;
          await getCurrentWindow().close();
        } catch (error) {
          if(shell)shell.inert=false;
          useApp.getState().setNotice(t("关闭已取消：") + displayError(error));
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
  useEffect(()=>{if(state.ready&&api.isTauriRuntime())void api.externalEditorSessions().then(receiveExternalSessions).catch(()=>{});},[state.ready,state.order]);
  useEffect(()=>{const style=document.createElement("style");style.dataset.markfolioCustom="true";style.textContent=state.settings.customCss;document.head.append(style);return()=>style.remove();},[state.settings.customCss]);
  useEffect(()=>{if(!state.ready||!api.isMainWindow())return;checkReminders();const timer=setInterval(checkReminders,15000);return()=>clearInterval(timer);},[state.ready]);
  const desktopSignature=JSON.stringify({zoom:state.settings.zoom,menuVisible:false,globalShortcut:state.settings.globalShortcut,tray:state.settings.tray,locale:state.settings.locale});
  useEffect(()=>{if(state.ready&&api.isTauriRuntime())guard(()=>api.desktopPreferences(JSON.parse(desktopSignature)));},[state.ready,desktopSignature,guard]);
  useEffect(()=>{const unlock=(event:Event)=>setTool({type:"lock",...(event as CustomEvent<{workspace:string;path:string}>).detail});window.addEventListener("markfolio-unlock",unlock);return()=>window.removeEventListener("markfolio-unlock",unlock);},[]);
  useEffect(()=>{if(!state.ready)return;const params=new URLSearchParams(location.search);const workspace=params.get("workspace"),note=params.get("note");if(workspace&&note&&useApp.getState().sessions[workspace]){useApp.getState().activate(workspace);guard(()=>useApp.getState().openDocument(workspace,note));}},[state.ready,guard]);
  useEffect(()=>{if(!api.isTauriRuntime())return;const cleanup:Dispose[]=[];let cancelled=false;
    const keep=(dispose:Dispose)=>{if(cancelled)dispose();else cleanup.push(dispose);};
    const open=(value:string)=>{try{const url=new URL(value);if(url.protocol!=="markfolio:"||url.hostname!=="open")return;const workspace=url.searchParams.get("workspace"),path=url.searchParams.get("path");if(workspace&&path&&useApp.getState().sessions[workspace]){useApp.getState().activate(workspace);guard(()=>useApp.getState().openDocument(workspace,path));}}catch{}};
    void listen<string[]>("open-deep-link",event=>event.payload.forEach(open)).then(keep);
    void listen<string[]>("second-instance",event=>event.payload.forEach(open)).then(keep);
    if(state.ready)void api.initialLinks().then(links=>links.forEach(open)).catch(()=>{});
    void listen<{workspace:string;path:string}>("note-locked",event=>{const {workspace,path}=event.payload;editorActions.clear(workspace);useApp.setState(s=>{const session=s.sessions[workspace];if(!session)return {};return {sessions:{...s.sessions,[workspace]:{...session,file:session.file===path?"":session.file,documents:Object.fromEntries(Object.entries(session.documents).filter(([p])=>p!==path))}}};});}).then(keep);
    return()=>{cancelled=true;cleanup.forEach(fn=>fn());};
  },[guard,state.ready]);
  useEffect(()=>{if(!state.ready||!state.settings.updateUrl||!api.isTauriRuntime()||getCurrentWindow().label!=="main")return;let cancelled=false;void api.checkUpdate(state.settings.updateUrl).then(release=>{const a=release.version.split('.').map(Number),b=state.version.split('.').map(Number);if(!cancelled&&a.some((n,i)=>n>b[i]&&a.slice(0,i).every((v,j)=>v===b[j])))state.setNotice(`MarkFolio ${release.version} · ${t("检查应用更新")}`);}).catch(()=>{});return()=>{cancelled=true;};},[state.ready,state.settings.updateUrl]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (dialog?.type === "settings") return;
      if (event.key === "Escape") {
        if (busy) return;
        const about = dialog?.type === "about";
        setDialog(undefined);
        setQuick(undefined);
        setListMenu(undefined);
        if (about) requestAnimationFrame(() => document.querySelector<HTMLElement>(".app-menu-trigger")?.focus());
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
      // 自定义标题栏隐藏原生菜单栏，快捷键统一由 WebView 处理，避免原生加速键与命令注册重复触发。
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
      case "file.newTodo":
        if(active)showDialog({type:"new-todo",workspace:ws,path:active.folder});
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
          current.setNotice(t("文档已保存"));
        }
        break;
      case "file.closeTab":
        if (active?.file) {
          await current.closeDocument(ws, active.file);
          editorActions.prune(ws);
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
      case "tools.updates":setTool({type:"updates",workspace:ws});break;
      case "tools.attachments": case "tools.trash": case "tools.transfer": case "tools.ocr": case "tools.whiteboard": case "tools.lock": case "tools.ai": case "tools.api": if(active)setTool({type:id.slice(6),workspace:ws});break;
      case "file.chooseLink": setQuick("link"); break;
      case "file.window": if(active?.file){await current.save(ws,active.file);await api.openNoteWindow(ws,active.file);}break;
      case "tools.externalEditor": {const name=await api.selectExternalEditor();if(name)current.setNotice(t("已配置外部编辑器：{0}", name));break;}
      case "file.externalStop": if(active?.file)receiveExternalSessions(await api.externalEdit(ws,active.file,"stop"));break;
      case "view.zoomIn":current.updateSettings({zoom:Math.min(200,current.settings.zoom+10)});break;
      case "view.zoomOut":current.updateSettings({zoom:Math.max(50,current.settings.zoom-10)});break;
      case "view.zoomReset":current.updateSettings({zoom:100});break;
      case "view.editor":current.updateSettings({editorMode:current.settings.editorMode==="markdown"?"rich":"markdown"});break;
      case "view.noteCounts":current.updateSettings({showNoteCounts:!current.settings.showNoteCounts});break;
      case "view.todoTop":current.updateSettings({uncompletedTodosOnTop:!current.settings.uncompletedTodosOnTop});break;
      case "view.completedTodos":current.updateSettings({showCompletedTodos:!current.settings.showCompletedTodos});break;
      case "view.tabFocus":current.updateSettings({tabMovesFocus:!current.settings.tabMovesFocus});break;
      case "view.sortName":case "view.sortModified":case "view.sortCreated":case "view.sortSize":case "view.sortManual":if(active)current.updateSettings(noteSortPatch(current.settings,ws,active.folder,active.view,{sort:id.slice(9).toLowerCase() as Settings["sort"]}));break;
      case "view.sortReverse":if(active){const sorting=noteSortFor(current.settings,ws,active.folder,active.view);current.updateSettings(noteSortPatch(current.settings,ws,active.folder,active.view,{reverseSort:!sorting.reverseSort}));}break;
      case "view.perFolderSort":current.updateSettings({perFolderSort:!current.settings.perFolderSort});break;
      case "view.folderSortName":current.updateSettings({folderSort:"name"});break;
      case "view.folderSortModified":current.updateSettings({folderSort:"modified"});break;
      case "view.folderSortReverse":current.updateSettings({folderSortReverse:!current.settings.folderSortReverse});break;
      case "focus.toolbar":if(current.settings.mode==="preview")current.updateSettings({mode:"split"});requestAnimationFrame(()=>document.querySelector<HTMLElement>(".format-tools button")?.focus());break;
      case "file.statistics":if(active?.file)showDialog({type:"statistics",workspace:ws,path:active.file});break;
      case "file.reveal":if(active?.file)await api.revealEntry(ws,active.file);break;
      case "app.closeWindow":if(api.isTauriRuntime())await getCurrentWindow().close();break;
      case "focus.preview":if(current.settings.mode==="editor")current.updateSettings({mode:"split"});requestAnimationFrame(()=>document.querySelector<HTMLElement>(".preview-pane .markdown-preview")?.focus());break;
      case "focus.title":requestAnimationFrame(()=>document.querySelector<HTMLElement>(".document-title h1")?.focus());break;
      case "focus.tabs":requestAnimationFrame(()=>document.querySelector<HTMLElement>(".workspace-tab")?.focus());break;
      case "file.copyLink":
        if(active?.file) { await navigator.clipboard.writeText("markfolio://open?workspace="+encodeURIComponent(ws)+"&path="+encodeURIComponent(active.file));current.setNotice(t("笔记链接已复制")); }
        break;
      case "edit.moveLineUp": case "edit.moveLineDown": case "edit.copyLineUp": case "edit.copyLineDown": case "edit.deleteLine": case "edit.toggleComment": case "edit.selectAll": case "edit.selectLine": case "edit.indentMore": case "edit.indentLess": case "edit.sortLines": case "edit.sortLinesReverse":case "edit.tableAddRow":case "edit.tableDeleteRow":case "edit.tableAddColumn":case "edit.tableDeleteColumn":
        editorActions.command(ws,id.slice(5));break;
      case "edit.dateTime":editorActions.insert(ws,new Date().toLocaleString(current.settings.locale));break;
      case "edit.pastePlain":case "edit.pasteMarkdown":{
        const target=editorActions.capture(ws);if(!target)break;
        try {
        let text="";
        if(id==="edit.pasteMarkdown"&&navigator.clipboard.read){const items=await navigator.clipboard.read();for(const item of items){if(item.types.includes("text/html")){text=htmlToMarkdown(await (await item.getType("text/html")).text());break;}if(item.types.includes("text/plain"))text=await (await item.getType("text/plain")).text();}}
        else text=await navigator.clipboard.readText();
        if(!editorActions.insertCaptured(target,text))current.setNotice(t("原笔记选区已失效，请重新粘贴"));
        }finally{editorActions.discardCapture(target);}break;
      }
      case "format.bold":editorActions.insert(ws,t("加粗文本"),"**","**");break;
      case "format.italic":editorActions.insert(ws,t("斜体文本"),"*","*");break;
      case "format.heading":editorActions.insert(ws,t("标题"),"## ");break;
      case "format.link":editorActions.insert(ws,t("链接文本"),"[",t("](链接地址)"));break;
      case "format.code":editorActions.insert(ws,t("代码"),"`","`");break;
      case "format.codeBlock":editorActions.insert(ws,t("代码"),"```\n","\n```");break;
      case "format.bullet":editorActions.insert(ws,t("列表项"),"- ");break;
      case "format.numbered":editorActions.insert(ws,t("列表项"),"1. ");break;
      case "format.task":editorActions.insert(ws,t("待办事项"),"- [ ] ");break;
      case "format.quote":editorActions.insert(ws,t("引用"),"> ");break;
      case "format.rule":editorActions.insert(ws,"\n---\n");break;
      case "format.table":editorActions.insert(ws,"\n| A | B |\n| --- | --- |\n|  |  |\n");break;
      case "format.toc":if(active?.file)editorActions.insert(ws,createTOC(active.documents[active.file].text));break;
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
          receiveExternalSessions(await api.externalEdit(ws, active.file,"start"));
        }
        break;
      case "file.attach":
        if (active?.file) {
          const target=editorActions.capture(ws);if(!target)break;
          try {
          const path = await api.attachFile(ws, parentPath(active.file));
          if (path) {
            const reference = relativeLink(active.file, path);
            const inserted=editorActions.insertCaptured(
              target,
              `${/\.(png|jpe?g|webp|gif|svg)$/i.test(path) ? "!" : ""}[${fileName(path)}](${reference})`,
            );
            if(!inserted)current.setNotice(t("附件已保存：{0}；原笔记选区已失效，请重新插入链接",path));
            await current.refresh(ws);
          }
          }finally{editorActions.discardCapture(target);}
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
          mode: nextEditorLayout(current.settings.mode,current.settings.layoutCycle),
        });
        break;
      case "view.reset":
        current.updateSettings({
          showSidebar: true,
          showList: true,
          mode: "split",
          sidebarWidth: 246,
          listWidth: 276,
          layoutOrder:"tree-list-editor",
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
        if (api.isTauriRuntime()) {
          await api.requestExit();
        } else {
          if(window.dispatchEvent(new Event("markfolio-before-close",{cancelable:true})))await flushDocuments();
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
          throw new Error(t("请输入有效名称"));
        if (dialog.type === "new-file" || dialog.type === "new-todo" || dialog.type === "new-folder") {
          if (name.includes("/")) throw new Error(t("名称不能包含路径分隔符"));
          const destination = joinPath(
            path,
            ["new-file","new-todo"].includes(dialog.type) && !/\.(md|markdown|txt)$/i.test(name)
              ? name + ".md"
              : name,
          );
          await api.createEntry(id, destination, dialog.type === "new-folder");
          if (["new-file","new-todo"].includes(dialog.type))
            await useApp.getState().openDocument(id, destination);
          if(dialog.type==="new-todo"){editorActions.replaceDocument(id,destination,updateMetadata("",{type:"todo",todo:true,completed:false}));await useApp.getState().save(id,destination);}
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
  const layoutParts = settings.layoutOrder.split("-");
  const treeOrder = layoutParts.indexOf("tree") * 2;
  const listOrder = layoutParts.indexOf("list") * 2;
  const editorOrder = layoutParts.indexOf("editor") * 2;
  const mainOrder = settings.showList ? Math.min(listOrder, editorOrder) : editorOrder;
  async function openWorkspaceAt(index: number) {
    const before = new Set(useApp.getState().order);
    await useApp.getState().openWorkspace();
    const current = useApp.getState();
    const added = current.order.find((id) => !before.has(id));
    if (added) current.moveWorkspace(added, index);
  }
  const run = (id: string) => guard(() => dispatchRef.current(id));
  const format = (before: string, after = "", placeholder = "") =>
    editorActions.insert(state.active, placeholder, before, after);

  return (
    <div className="app-shell">
      <TitleBar run={run} guard={guard} openWorkspaceAt={openWorkspaceAt} />
      {!state.ready ? (
        <div className="loading">{t("正在打开 MarkFolio…")}</div>
      ) : !session ? (
        <main className="welcome">
          <div className="welcome-book">
            <img src="/markfolio-icon.png" alt="" draggable={false} />
          </div>
          <span className="eyebrow">YOUR WORDS, YOUR FILES</span>
          <h1>{t("让每一页，井然有序。")}</h1>
          <p>
            {t("打开一个本地文件夹，开始管理 Markdown 文档。")}<br />
            {t("多个工作目录，各自保持独立，随时切换。")}</p>
          <button
            className="primary large"
            onClick={() => run("workspace.open")}
          >
            <FolderOpen size={18} />
            {t("打开工作目录")}<span className="key-hint">Ctrl O</span>
          </button>
          <div className="welcome-features">
            <span>
              <FileText size={16} />
              {t("原始 Markdown")}</span>
            <span>
              <Columns2 size={16} />
              {t("多工作目录")}</span>
            <span>
              <Puzzle size={16} />
              {t("插件扩展")}</span>
          </div>
          {!api.isTauriRuntime() && (
            <p className="preview-note">
              {t("浏览器界面预览 · 本地文件功能请使用桌面版")}</p>
          )}
        </main>
      ) : (
        <main className="workspace-content">
          {settings.showSidebar && (
            <>
              <aside
                className="sidebar"
                style={{ width: settings.sidebarWidth,order:treeOrder }}
              >
                <FileTree session={session} action={showDialog} /><TagSidebar session={session} />
                <div className="sidebar-footer">
                  <div className="workspace-indicator">
                    <span className="green-dot" />
                    <span>{t("本地工作目录")}</span>
                  </div>
                  <button onClick={() => run("app.plugins")}>
                    <Puzzle size={15} />
                    {t("插件")}<ChevronRight size={13} />
                  </button>
                </div>
              </aside>
              <div
                className="resize-handle"
                style={{order:treeOrder+1}}
                onPointerDown={(event) => resize(event, "sidebarWidth")}
              />
            </>
          )}
          <div className="workspace-main" style={{order: mainOrder}}>
            <FileTabs run={run} guard={guard} />
            <div className="workspace-columns">
              {settings.showList && (<><DocumentList session={session} query={query} setQuery={setQuery} searchRef={searchRef} run={run} /><div className="resize-handle" style={{order:1}} onPointerDown={event=>resize(event,"listWidth")} /></>)}
              <section className="document-area" style={{order: editorOrder}}>
            <div className="document-navigation">
              <div>
                <IconButton
                  label={t("后退")}
                  onClick={() => run("nav.back")}
                  disabled={session.historyIndex <= 0}
                >
                  <ArrowLeft size={16} />
                </IconButton>
                <IconButton
                  label={t("前进")}
                  onClick={() => run("nav.forward")}
                  disabled={session.historyIndex >= session.history.length - 1}
                >
                  <ArrowRight size={16} />
                </IconButton>
                {!settings.showSidebar && (
                  <IconButton
                    label={t("显示侧栏")}
                    onClick={() => run("view.sidebar")}
                  >
                    <PanelLeft size={16} />
                  </IconButton>
                )}
                <span className="breadcrumb">
                  {session.info.name}
                  <ChevronRight size={12} />
                  {session.file || t("选择一篇文档")}
                </span>
              </div>
              <div>
                {panels.length > 0 && (
                  <IconButton
                    label={t("插件面板")}
                    active={showPanels}
                    onClick={() => setShowPanels(!showPanels)}
                  >
                    <Puzzle size={16} />
                  </IconButton>
                )}
                <IconButton
                  label={t("文档属性")}
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
                      tabIndex={0}
                      title={t("双击重命名")}
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
                      ? t("需要处理冲突")
                      : buffer.saving
                        ? t("正在保存")
                        : buffer.dirty
                          ? t("未保存")
                          : t("已保存")}
                  </span>
                </div>
                <div className="format-toolbar" onPointerDown={e=>{if((e.target as Element).closest(".format-tools"))e.preventDefault();}}>
                  <div className="format-tools"><PluginButtons workspace={state.active} kind="toolbar" />
                    <IconButton
                      label={t("加粗")}
                      onClick={() => format("**", "**", t("加粗文本"))}
                    >
                      <Bold size={15} />
                    </IconButton>
                    <IconButton
                      label={t("斜体")}
                      onClick={() => format("*", "*", t("斜体文本"))}
                    >
                      <Italic size={15} />
                    </IconButton>
                    <IconButton
                      label={t("标题")}
                      onClick={() => format("## ", "", t("标题"))}
                    >
                      <span className="heading-icon">H</span>
                    </IconButton>
                    <span className="toolbar-separator" />
                    <IconButton
                      label={t("插入链接")}
                      onClick={() => format("[", t("](链接地址)"), t("链接文本"))}
                    >
                      <Link size={15} />
                    </IconButton>
                    <IconButton
                      label={t("行内代码")}
                      onClick={() => format("`", "`", t("代码"))}
                    >
                      <Code2 size={16} />
                    </IconButton>
                    <IconButton
                      label={t("代码块")}
                      onClick={() => format("```\n", "\n```", t("代码"))}
                    >
                      <Braces size={16} />
                    </IconButton>
                    <IconButton label={t("附件")} onClick={() => run("file.attach")}>
                      <Paperclip size={15} />
                    </IconButton>
                    <span className="toolbar-separator" />
                    <IconButton
                      label={t("无序列表")}
                      onClick={() => format("- ", "", t("列表项"))}
                    >
                      <List size={16} />
                    </IconButton>
                    <IconButton
                      label={t("有序列表")}
                      onClick={() => format("1. ", "", t("列表项"))}
                    >
                      <ListOrdered size={16} />
                    </IconButton>
                    <IconButton
                      label={t("待办")}
                      onClick={() => format("- [ ] ", "", t("待办事项"))}
                    >
                      <SquareCheck size={15} />
                    </IconButton>
                    <IconButton
                      label={t("引用")}
                      onClick={() => format("> ", "", t("引用"))}
                    >
                      <Quote size={15} />
                    </IconButton>
                    <IconButton
                      label={t("分隔线")}
                      onClick={() => format("\n---\n")}
                    >
                      <Minus size={16} />
                    </IconButton>
                  </div>
                  <div className="view-modes">
                    <button title={t("Markdown / 富文本切换")} onClick={()=>state.updateSettings({editorMode:settings.editorMode==="markdown"?"rich":"markdown"})}>{settings.editorMode==="markdown"?t("富文本"):"Markdown"}</button>
                    <IconButton
                      label={t("仅编辑")}
                      active={settings.mode === "editor"}
                      onClick={() => state.updateSettings({ mode: "editor" })}
                    >
                      <Code2 size={15} />
                    </IconButton>
                    <IconButton
                      label={t("编辑与预览")}
                      active={settings.mode === "split"}
                      onClick={() => state.updateSettings({ mode: "split" })}
                    >
                      <Columns2 size={15} />
                    </IconButton>
                    <IconButton
                      label={t("仅预览")}
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
                      {t("比较与处理")}</button>
                  </div>
                )}
                <div className={`editing-layout mode-${settings.mode}`}>
                  <div className="editing-panes">
                    {settings.mode !== "preview" && (
                      <div className="editor-pane">
                        <div className="pane-label">{t("编辑器")}</div>
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
                        <div className="pane-label">{t("预览")}</div>
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
                    {buffer.text.replace(/\s/g, "").length} {t("字符")}<span className="status-divider" />
                    {buffer.text.split("\n").length} {t("行")}</span>
                  <span>
                    {session.indexing && (
                      <>
                        <RefreshCw size={11} className="spinning" />
                        {t("索引中")}<span className="status-divider" />
                      </>
                    )}
                    {externalSessions.includes(`${state.active}:${buffer.path}`)&&<span>{t("外部编辑中 ·")}</span>}{buffer.encoding.toUpperCase()}
                    <span className="status-divider" />
                    {buffer.lineEnding.toUpperCase()}
                    <span className="status-divider" />
                    Markdown
                  </span>
                </footer>
              </>
            ) : (
              <div className="no-document">
                <img className="no-document-icon" src="/markfolio-icon.png" alt="" draggable={false} />
                <h2>{t("选择一篇笔记")}</h2>
                <p>{t("在文件树中打开文档，或创建新的 Markdown 笔记。")}</p>
                <button className="primary" onClick={() => run("file.new")}>
                  <FilePlus2 size={16} />
                  {t("新建笔记")}</button>
              </div>
            )}
          </section>
            </div>
          </div>
        </main>
      )}
      {state.notice && (
        <div className="toast" role="status">
          <Info size={16} />
          <span>{state.notice}</span>
          <button aria-label={t("关闭提示")} onClick={() => state.setNotice("")}>
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
              ["file.duplicate", t("复制笔记")],
              ["file.move", t("移动到…")],
              ["file.delete", t("移入回收站")],
              ["files.selectAll", t("全选文件")],
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
      {quick && session && <div className="modal-backdrop"><section className="modal palette-modal quick-open-modal" role="dialog" aria-modal="true" aria-label={quick==="link"?t("选择笔记链接"):t("快速搜索")}><button className="modal-close" onClick={()=>setQuick(undefined)}><X size={18}/></button><QuickOpen workspace={state.active} insertLink={quick==="link"} close={()=>setQuick(undefined)} /></section></div>}
      <PluginDialogs/>
      {dialog?.type === "about" && <AboutDialog close={closeAbout} openNotices={openNoticesFromAbout} />}
      {tool&&<ToolWindow target={tool} close={()=>setTool(undefined)}/>}
      {dialog?.type === "settings" && (
        <div className="modal-backdrop">
          <SettingsDialog
            initialTab={dialog.tab ?? "general"}
            close={() => setDialog(undefined)}
          />
        </div>
      )}
      {dialog && dialog.type !== "settings" && dialog.type !== "about" && (
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
            aria-label={t("文档操作")}
          >
            <button
              className="modal-close"
              aria-label={t("关闭对话框")}
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
                    aria-label={t("搜索命令")}
                    placeholder={t("输入命令名称…")}
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
                  {t("Enter 执行命令")}<span>{t("Esc 关闭")}</span>
                </div>
              </>
            ) : dialog.type === "properties" ? (
              <PropertiesDialog workspace={dialog.workspace ?? state.active} path={dialog.path ?? ""} close={()=>setDialog(undefined)} />
            ) : dialog.type === "statistics" ? (
              <StatisticsDialog text={state.sessions[dialog.workspace??state.active]?.documents[dialog.path??""]?.text??""}/>
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
                        "new-file": t("新建笔记"),
                        "new-todo": t("新建待办笔记"),
                        "new-folder": t("新建文件夹"),
                        rename: t("重命名"),
                        move: t("移动文件"),
                        delete: t("移入回收站"),
                        "batch-delete": t("选中文件移入回收站"),
                        "batch-move": t("移动选中文件"),
                      } as Record<string, string>
                    )[dialog.type]
                  }
                </h2>
                <p className="muted">
                  {dialog.type === "delete" || dialog.type === "batch-delete"
                    ? t(settings.trashMode==="app"?"{0} 项将移入应用垃圾箱，可以恢复。未保存的文件会保留。":"{0} 项将移入系统回收站，可以在系统中恢复。未保存的文件会保留。", dialog.paths?.length ?? 1)
                    : dialog.type === "batch-move"
                      ? t("输入目标文件夹的相对路径。留空表示工作目录根目录，目标需已存在。")
                      : dialog.type === "move"
                        ? t("输入相对于工作目录的目标路径，目标文件夹需已存在。")
                        : dialog.type === "rename"
                          ? t("重命名实际文件，正文内容保持原样。")
                          : t("创建位置：{0}", dialog.path || "工作目录根目录")}
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
                    aria-label={t("名称或目标路径")}
                    placeholder={
                      dialog.type === "new-file" ? t("笔记名称") : t("名称")
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
                    {t("取消")}</button>
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
                      ? t("处理中…")
                      : dialog.type === "delete" ||
                          dialog.type === "batch-delete"
                        ? t("移入回收站")
                        : t("确定")}
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
