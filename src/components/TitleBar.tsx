import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  ChevronDown,
  Command as CommandIcon,
  Copy,
  FolderOpen,
  Info,
  Moon,
  Minus,
  Power,
  Search,
  Settings2,
  Square,
  Sun,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { t } from "../i18n";
import { useApp } from "../store";
import * as api from "../api";
import { coreCommands } from "../commands";
import { effectiveShortcut } from "../shortcuts";
import { PluginButtons } from "./PluginContributions";

type ResizeDirection = "East" | "North" | "NorthEast" | "NorthWest" | "South" | "SouthEast" | "SouthWest" | "West";
type MenuPoint = { x: number; y: number };
type TabMenu = MenuPoint & { id: string };

function shortcutFor(id: string, shortcuts: Record<string, string>): string {
  const command = coreCommands.find(([commandId]) => commandId === id);
  return command ? effectiveShortcut({ id, name: command[1], shortcut: command[2] }, shortcuts) : "";
}

function MenuItem({
  icon: Icon,
  label,
  shortcut,
  disabled,
  danger,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick(): void;
}) {
  return (
    <button
      role="menuitem"
      className={danger ? "app-menu-item app-menu-danger" : "app-menu-item"}
      disabled={disabled}
      onClick={onClick}
    >
      <span><Icon size={15} />{label}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}

export default function TitleBar({
  run,
  guard,
  openWorkspaceAt,
}: {
  run(id: string): void;
  guard(operation: () => Promise<unknown>): void;
  openWorkspaceAt(index: number): Promise<void>;
}) {
  const state = useApp();
  const settings = state.settings;
  const main = api.isMainWindow();
  const [appMenu, setAppMenu] = useState<MenuPoint>();
  const [tabMenu, setTabMenu] = useState<TabMenu>();
  const [dragId, setDragId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean }>();
  const [maximized, setMaximized] = useState(false);
  const appButton = useRef<HTMLButtonElement>(null);
  const appMenuRef = useRef<HTMLDivElement>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!api.isTauriRuntime()) return;
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    const sync = () => {
      void getCurrentWindow()
        .isMaximized()
        .then((value) => { if (!disposed) setMaximized(value); })
        .catch(() => {});
    };
    sync();
    void getCurrentWindow().onResized(sync).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    if (!appMenu) return;
    requestAnimationFrame(() => appMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  }, [appMenu]);
  useEffect(() => {
    if (!tabMenu) return;
    requestAnimationFrame(() => tabMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  }, [tabMenu]);

  useEffect(() => {
    if (!appMenu && !tabMenu) return;
    const close = () => { setAppMenu(undefined); setTabMenu(undefined); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        appButton.current?.focus();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [appMenu, tabMenu]);

  const closeMenus = () => { setAppMenu(undefined); setTabMenu(undefined); };
  const openAppMenu = (point: MenuPoint) => { setTabMenu(undefined); setAppMenu(point); };
  const openAppMenuAtButton = () => {
    const rect = appButton.current?.getBoundingClientRect();
    openAppMenu({ x: rect?.left ?? 8, y: (rect?.bottom ?? 40) + 4 });
  };
  const menuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [...(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'))];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      items[(index + delta + items.length) % items.length]?.focus();
    }
    if (event.key === "Home") { event.preventDefault(); items[0]?.focus(); }
    if (event.key === "End") { event.preventDefault(); items[items.length - 1]?.focus(); }
  };

  const activate = (id: string) => state.activate(id);
  const closeWorkspace = (id: string) => guard(() => state.closeWorkspace(id));
  const reorder = (targetId: string, after: boolean) => {
    if (!dragId || dragId === targetId) return;
    const remaining = state.order.filter((id) => id !== dragId);
    const index = remaining.indexOf(targetId);
    if (index >= 0) state.moveWorkspace(dragId, after ? index + 1 : index);
  };
  const closeOthers = (id: string) => guard(async () => {
    for (const other of [...state.order]) if (other !== id) await state.closeWorkspace(other);
  });
  const addRight = (id: string) => guard(async () => {
    const index = state.order.indexOf(id);
    await openWorkspaceAt(index < 0 ? state.order.length : index + 1);
  });
  const minimize = () => { if (api.isTauriRuntime()) void getCurrentWindow().minimize(); };
  const toggleMaximize = () => { if (api.isTauriRuntime()) void getCurrentWindow().toggleMaximize(); };
  const closeWindow = () => { if (api.isTauriRuntime()) void getCurrentWindow().close(); };
  const resize = (direction: ResizeDirection) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !api.isTauriRuntime()) return;
    event.preventDefault();
    void getCurrentWindow().startResizeDragging(direction);
  };
  const activeSession = state.sessions[state.active];

  return (
    <header
      className="title-bar"
      data-tauri-drag-region="deep"
      onContextMenu={(event) => {
        if ((event.target as Element).closest(".workspace-tab,button,[role='menu']")) return;
        event.preventDefault();
        openAppMenu({ x: Math.min(event.clientX, window.innerWidth - 250), y: event.clientY });
      }}
    >
      <button
        ref={appButton}
        className="app-menu-trigger"
        aria-label={t("应用菜单")}
        title={`MarkFolio · ${t("应用菜单")}`}
        onClick={openAppMenuAtButton}
      >
        <img className="app-menu-mark" src="/markfolio-icon.png" alt="" draggable={false} />
        <ChevronDown size={11} className="app-menu-caret" />
      </button>

      <div className="workspace-tabs" role="tablist" aria-label={t("工作目录页签")}>
        {state.order.map((id) => {
          const info = state.sessions[id]?.info;
          if (!info) return null;
          const mutating = state.sessions[id]?.mutating;
          return (
            <div
              key={id}
              className={`workspace-tab ${state.active === id ? "selected" : ""} ${dropTarget?.id === id ? (dropTarget.after ? "drop-after" : "drop-before") : ""}`}
              role="tab"
              tabIndex={0}
              aria-selected={state.active === id}
              draggable={main && !mutating}
              onClick={() => activate(id)}
              onAuxClick={(event) => {
                if (event.button === 1 && main) {
                  event.preventDefault();
                  closeWorkspace(id);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setAppMenu(undefined);
                setTabMenu({ x: Math.min(event.clientX, window.innerWidth - 230), y: event.clientY, id });
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(id); }
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  const tabs = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(".workspace-tab") ?? [])];
                  const index = tabs.indexOf(event.currentTarget);
                  const next = tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
                  next?.focus();
                  next?.click();
                }
                if (event.key === "Delete" && main) { event.preventDefault(); closeWorkspace(id); }
              }}
              onDragStart={(event) => {
                if (!main) return;
                setDragId(id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", id);
              }}
              onDragOver={(event) => {
                if (!dragId || dragId === id || !main) return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                setDropTarget({ id, after: event.clientX > rect.left + rect.width / 2 });
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (!main) return;
                const after = event.clientX > event.currentTarget.getBoundingClientRect().left + event.currentTarget.getBoundingClientRect().width / 2;
                reorder(id, after);
                setDragId(undefined);
                setDropTarget(undefined);
              }}
              onDragEnd={() => { setDragId(undefined); setDropTarget(undefined); }}
            >
              <FolderOpen size={14} />
              <span>{info.name}</span>
              {!info.available && <span className="unavailable">!</span>}
              {main && (
                <button
                  className="tab-close"
                  aria-label={t("关闭工作目录 {0}", info.name)}
                  title={t("关闭工作目录 {0}", info.name)}
                  disabled={mutating}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeWorkspace(id);
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
        {main && (
          <button
            className="titlebar-add"
            aria-label={t("打开另一个工作目录")}
            title={t("打开另一个工作目录")}
            onClick={() => run("workspace.open")}
          >
            <span>+</span>
          </button>
        )}
      </div>

      <div className="titlebar-actions">
        <PluginButtons workspace={state.active} kind="menu" />
        <button className="titlebar-tool" aria-label={t("快速搜索")} title={`${t("快速搜索")} · ${shortcutFor("nav.quickOpen", settings.shortcuts)}`} onClick={() => run("nav.quickOpen")}>
          <Search size={16} />
        </button>
        {api.isTauriRuntime() && (
          <div className="window-controls">
            <button className="window-control" aria-label={t("最小化")} title={t("最小化")} onClick={minimize}><Minus size={16} /></button>
            <button className="window-control" aria-label={maximized ? t("还原") : t("最大化")} title={maximized ? t("还原") : t("最大化")} onClick={toggleMaximize}>{maximized ? <Copy size={14} /> : <Square size={13} />}</button>
            <button className="window-control close" aria-label={t("关闭窗口")} title={t("关闭窗口")} onClick={closeWindow}><X size={17} /></button>
          </div>
        )}
      </div>

      {appMenu && (
        <>
          <div className="context-backdrop" data-tauri-drag-region="false" onClick={closeMenus} />
          <div ref={appMenuRef} className="app-menu" style={{ left: appMenu.x, top: appMenu.y }} role="menu" aria-label={t("应用菜单")} onKeyDown={menuKeyDown}>
            <div className="app-menu-heading"><img className="app-menu-heading-icon" src="/markfolio-icon.png" alt="" draggable={false} /><span>Mark<span className="brand-accent">Folio</span></span></div>
            <MenuItem icon={FolderOpen} label={t("打开工作目录")} shortcut={shortcutFor("workspace.open", settings.shortcuts)} disabled={!main || activeSession?.mutating} onClick={() => { closeMenus(); run("workspace.open"); }} />
            <MenuItem icon={Search} label={t("快速搜索")} shortcut={shortcutFor("nav.quickOpen", settings.shortcuts)} onClick={() => { closeMenus(); run("nav.quickOpen"); }} />
            <MenuItem icon={CommandIcon} label={t("命令面板")} shortcut={shortcutFor("app.palette", settings.shortcuts)} onClick={() => { closeMenus(); run("app.palette"); }} />
            <MenuItem icon={settings.theme === "dark" ? Sun : Moon} label={t("切换主题")} onClick={() => { closeMenus(); state.updateSettings({ theme: settings.theme === "dark" ? "light" : "dark" }); }} />
            <div className="app-menu-separator" role="separator" />
            <MenuItem icon={Settings2} label={t("设置")} shortcut={shortcutFor("app.settings", settings.shortcuts)} onClick={() => { closeMenus(); run("app.settings"); }} />
            <MenuItem icon={Info} label={`${t("关于 MarkFolio")}…`} onClick={() => { closeMenus(); run("app.about"); }} />
            <div className="app-menu-separator" role="separator" />
            <MenuItem icon={Power} label={main ? t("退出") : t("关闭窗口")} shortcut={main ? shortcutFor("app.quit", settings.shortcuts) : shortcutFor("app.closeWindow", settings.shortcuts)} danger onClick={() => { closeMenus(); run(main ? "app.quit" : "app.closeWindow"); }} />
          </div>
        </>
      )}

      {tabMenu && (
        <>
          <div className="context-backdrop" data-tauri-drag-region="false" onClick={closeMenus} />
          <div ref={tabMenuRef} className="app-menu tab-menu" style={{ left: tabMenu.x, top: tabMenu.y }} role="menu" aria-label={t("工作目录页签")} onKeyDown={menuKeyDown}>
            <MenuItem icon={X} label={t("关闭工作目录")} disabled={!main || state.sessions[tabMenu.id]?.mutating} onClick={() => { closeMenus(); closeWorkspace(tabMenu.id); }} />
            <MenuItem icon={X} label={t("关闭其他工作目录")} disabled={!main || state.order.length < 2} onClick={() => { closeMenus(); closeOthers(tabMenu.id); }} />
            <div className="app-menu-separator" role="separator" />
            <MenuItem icon={FolderOpen} label={t("在右侧新增工作目录")} disabled={!main} onClick={() => { closeMenus(); addRight(tabMenu.id); }} />
          </div>
        </>
      )}

      {api.isTauriRuntime() && !maximized && (
        <>
          <div className="window-resize n" data-tauri-drag-region="false" onPointerDown={resize("North")} />
          <div className="window-resize s" data-tauri-drag-region="false" onPointerDown={resize("South")} />
          <div className="window-resize e" data-tauri-drag-region="false" onPointerDown={resize("East")} />
          <div className="window-resize w" data-tauri-drag-region="false" onPointerDown={resize("West")} />
          <div className="window-resize ne" data-tauri-drag-region="false" onPointerDown={resize("NorthEast")} />
          <div className="window-resize nw" data-tauri-drag-region="false" onPointerDown={resize("NorthWest")} />
          <div className="window-resize se" data-tauri-drag-region="false" onPointerDown={resize("SouthEast")} />
          <div className="window-resize sw" data-tauri-drag-region="false" onPointerDown={resize("SouthWest")} />
        </>
      )}
    </header>
  );
}
