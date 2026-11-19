import { useEffect, useRef, useState } from "react";
import { FileText, Search, X } from "lucide-react";
import { t } from "../i18n";
import { useApp } from "../store";
import * as api from "../api";
import { displayError, fileName } from "../types";
import { editorActions } from "../Editor";
import { coreCommands } from "../commands";
import { effectiveShortcut } from "../shortcuts";

type TabMenu = { x: number; y: number; path: string };

export default function FileTabs({
  run,
  guard,
}: {
  run(id: string): void;
  guard(operation: () => Promise<unknown>): void;
}) {
  const state = useApp();
  const session = state.sessions[state.active];
  const [menu, setMenu] = useState<TabMenu>();
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(undefined); };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [menu]);
  if (!session) return null;
  const workspace = session.info.id;
  const paths = Object.keys(session.documents);
  const quickCommand = coreCommands.find(([id]) => id === "nav.quickOpen");
  const quickShortcut = quickCommand ? effectiveShortcut({ id: "nav.quickOpen", name: quickCommand[1], shortcut: quickCommand[2] }, state.settings.shortcuts) : "";

  const open = (path: string) => {
    if (path !== session.file) guard(() => state.openDocument(workspace, path));
  };
  const close = (path: string) => guard(async () => {
    await useApp.getState().closeDocument(workspace, path);
    editorActions.prune(workspace);
  });
  const closeMany = (selected: string[]) => guard(async () => {
    for (const path of selected) await useApp.getState().closeDocument(workspace, path);
    editorActions.prune(workspace);
  });
  const closeMenu = () => setMenu(undefined);

  return (
    <div className="file-tabs" role="tablist" aria-label={t("文件页签")}>
      {paths.length === 0 ? (
        <div className="file-tabs-empty">
          <span>{t("未打开文档")}</span>
          <button onClick={() => run("nav.quickOpen")}><Search size={13} />{t("快速搜索")}{quickShortcut && <kbd>{quickShortcut}</kbd>}</button>
        </div>
      ) : (
        <div className="file-tab-scroll">
          {paths.map((path) => {
            const buffer = session.documents[path];
            const active = session.file === path;
            return (
              <div
                key={path}
                className={`file-tab ${active ? "selected" : ""}`}
                role="tab"
                tabIndex={0}
                aria-selected={active}
                title={path}
                onClick={() => open(path)}
                onAuxClick={(event) => {
                  if (event.button === 1) { event.preventDefault(); close(path); }
                }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(path); }
                  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    const tabs = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(".file-tab") ?? [])];
                    const index = tabs.indexOf(event.currentTarget);
                    const next = tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
                    next?.focus();
                    next?.click();
                  }
                  if (event.key === "Delete") { event.preventDefault(); close(path); }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setMenu({ x: Math.min(event.clientX, window.innerWidth - 220), y: event.clientY, path });
                }}
              >
                <FileText size={13} />
                <span>{fileName(path).replace(/\.[^.]+$/, "")}</span>
                {buffer?.error ? <span className="file-tab-error" title={buffer.error}>!</span> : buffer?.dirty || buffer?.saving ? <span className="file-tab-dirty" aria-label={t("未保存")} /> : null}
                <button
                  className="file-tab-close"
                  aria-label={t("关闭文档页签 {0}", fileName(path))}
                  title={t("关闭文档页签 {0}", fileName(path))}
                  onClick={(event) => { event.stopPropagation(); close(path); }}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {menu && (
        <>
          <div className="context-backdrop" onClick={closeMenu} />
          <div ref={menuRef} className="app-menu tab-menu file-tab-menu" style={{ left: menu.x, top: menu.y }} role="menu" onKeyDown={(event) => {
            const items = [...(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'))];
            if (!items.length) return;
            const index = items.indexOf(document.activeElement as HTMLElement);
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const delta = event.key === "ArrowDown" ? 1 : -1;
              items[(index + delta + items.length) % items.length]?.focus();
            }
          }}>
            <button role="menuitem" className="app-menu-item" onClick={() => { closeMenu(); close(menu.path); }}><span><X size={15} />{t("关闭标签")}</span></button>
            <button role="menuitem" className="app-menu-item" disabled={paths.length < 2} onClick={() => { closeMenu(); closeMany(paths.filter((path) => path !== menu.path)); }}><span><X size={15} />{t("关闭其他标签")}</span></button>
            <button role="menuitem" className="app-menu-item" onClick={() => { closeMenu(); closeMany(paths); }}><span><X size={15} />{t("关闭全部标签")}</span></button>
            <div className="app-menu-separator" role="separator" />
            <button role="menuitem" className="app-menu-item" onClick={() => { closeMenu(); void navigator.clipboard.writeText(menu.path).then(() => state.setNotice(t("路径已复制"))).catch((error) => state.setNotice(displayError(error))); }}><span><FileText size={15} />{t("复制路径")}</span></button>
            <button role="menuitem" className="app-menu-item" onClick={() => { closeMenu(); guard(() => api.revealEntry(workspace, menu.path)); }}><span><Search size={15} />{t("在资源管理器中定位")}</span></button>
          </div>
        </>
      )}
    </div>
  );
}
