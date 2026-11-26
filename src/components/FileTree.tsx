import { t } from "../i18n";
import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Link,
  MapPin,
  PanelRight,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import * as api from "../api";
import { useApp, type Session } from "../store";
import { displayError, fileName, type Dialog } from "../types";
import { IconButton, IconForFile, markdownFile } from "./Controls";
import { operateFiles, batchSummary } from "../fileOperations";
import { visibleNotes } from "./NoteManagement";
import NoteMenuItems from "./NoteMenuItems";

type TreeMenu =
  | { kind: "note" | "file" | "directory"; path: string; x: number; y: number }
  | { kind: "blank"; x: number; y: number };

export default function FileTree({
  session,
  action,
}: {
  session: Session;
  action(dialog: Dialog): void;
}) {
  const state = useApp();
  const [menu, setMenu] = useState<TreeMenu>();
  const id = session.info.id;
  const closeMenu = () => setMenu(undefined);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest(".context-menu")) setMenu(undefined);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(undefined);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", escape, true);
    };
  }, [menu]);
  const point = (event: React.MouseEvent) => ({
    x: Math.min(event.clientX, window.innerWidth - 230),
    y: Math.min(event.clientY, window.innerHeight - 340),
  });
  const copyText = (text: string, notice: string) => {
    void navigator.clipboard.writeText(text).then(() => state.setNotice(notice)).catch((error) => state.setNotice(displayError(error)));
  };
  const copyFullPath = (path: string) => {
    void api.copyEntryPath(id, path).then(() => state.setNotice(t("完整路径已复制"))).catch((error) => state.setNotice(displayError(error)));
  };
  const selectedPaths = (path: string) => session.selected.length > 1 && session.selected.includes(path) ? [...session.selected] : [path];
  const duplicate = (path: string) => {
    void operateFiles(id, selectedPaths(path).filter(markdownFile), "duplicate")
      .then((result) => state.setNotice(batchSummary(result)))
      .catch((error) => state.setNotice(displayError(error)));
  };
  const move = (path: string) => {
    const paths = selectedPaths(path);
    action(paths.length > 1 ? { type: "batch-move", workspace: id, paths } : { type: "move", workspace: id, path });
  };
  const remove = (path: string) => {
    const paths = selectedPaths(path);
    action(paths.length > 1 ? { type: "batch-delete", workspace: id, paths } : { type: "delete", workspace: id, path });
  };
  const openDirectory = (path: string) => {
    void api.openLocalFile(id, path).catch((error) => state.setNotice(displayError(error)));
  };
  const expand = (path: string) => {
    void state.expand(id, path).catch((error) => state.setNotice(displayError(error)));
  };

  function render(directory: string, depth: number): React.ReactNode {
    return [...(session.tree[directory] ?? [])].sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || (a.isDirectory && b.isDirectory ? ((state.settings.folderSort === "modified" ? b.modified - a.modified : a.name.localeCompare(b.name, state.settings.locale, { numeric: true })) * (state.settings.folderSortReverse ? -1 : 1)) : a.name.localeCompare(b.name, state.settings.locale, { numeric: true }))).map((entry) => (
      <div key={entry.path}>
        <div
          role="treeitem"
          aria-selected={session.selected.includes(entry.path)}
          aria-expanded={entry.isDirectory ? session.expanded.includes(entry.path) : undefined}
          className={`tree-row ${session.selected.includes(entry.path) ? "selected" : ""}`}
          tabIndex={0}
          onKeyDown={(event) => {
            const items = [...event.currentTarget.closest(".tree-scroll")!.querySelectorAll<HTMLElement>('[role="treeitem"]')];
            const index = items.indexOf(event.currentTarget);
            if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); items[Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus(); }
            else if (event.key === "ArrowRight" && entry.isDirectory && !session.expanded.includes(entry.path)) { event.preventDefault(); expand(entry.path); }
            else if (event.key === "ArrowLeft" && entry.isDirectory && session.expanded.includes(entry.path)) { event.preventDefault(); expand(entry.path); }
            else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); }
          }}
          style={{ paddingLeft: 12 + depth * 16 }}
          draggable={!session.mutating}
          onDragStart={(event) => {
            event.dataTransfer.setData("application/x-markfolio-entry", JSON.stringify({ workspace: id, paths: session.selected.includes(entry.path) ? session.selected : [entry.path] }));
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(event) => {
            if (entry.isDirectory && event.dataTransfer.types.includes("application/x-markfolio-entry")) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            try {
              const item = JSON.parse(event.dataTransfer.getData("application/x-markfolio-entry")) as { workspace: string; paths: string[] };
              if (item.workspace !== id) throw new Error(t("请在同一工作目录中移动文件"));
              void operateFiles(item.workspace, item.paths, "move", entry.path)
                .then((result) => state.setNotice(batchSummary(result)))
                .catch((error) => state.setNotice(displayError(error)));
            } catch (error) {
              state.setNotice(displayError(error));
            }
          }}
          onClick={(event) => {
            if (event.ctrlKey || event.metaKey) {
              state.selectFiles(id, session.selected.includes(entry.path) ? session.selected.filter((path) => path !== entry.path) : [...session.selected, entry.path], entry.path);
              return;
            }
            if (entry.isDirectory) {
              state.setFolder(id, entry.path);
              state.selectFiles(id, [entry.path]);
              expand(entry.path);
              return;
            }
            state.selectFiles(id, [entry.path]);
            if (entry.path.endsWith(".mflock")) { window.dispatchEvent(new CustomEvent("markfolio-unlock", { detail: { workspace: id, path: entry.path } })); return; }
            if (markdownFile(entry.path)) void state.openDocument(id, entry.path).catch((error) => state.setNotice(displayError(error)));
            else void api.openLocalFile(id, entry.path).catch((error) => state.setNotice(displayError(error)));
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!session.selected.includes(entry.path)) state.selectFiles(id, [entry.path]);
            setMenu({ kind: entry.isDirectory ? "directory" : markdownFile(entry.path) ? "note" : "file", path: entry.path, ...point(event) });
          }}
        >
          {entry.isDirectory ? (
            <button
              className="tree-chevron"
              aria-label={t("展开 {0}", entry.name)}
              onClick={(event) => { event.stopPropagation(); expand(entry.path); }}
            >
              {session.expanded.includes(entry.path) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : <span className="tree-spacer" />}
          {entry.isDirectory ? <Folder size={15} className="folder-icon" /> : <IconForFile path={entry.path} />}
          <span>{entry.name}</span>
          {entry.isDirectory && state.settings.showNoteCounts && <small className="tree-note-count">{session.catalog.filter((note) => note.path.startsWith(entry.path + "/")).length}</small>}
          {!!session.documents[entry.path]?.dirty && <span className="dirty-dot" />}
        </div>
        {entry.isDirectory && session.expanded.includes(entry.path) && render(entry.path, depth + 1)}
      </div>
    ));
  }

  return (
    <>
      <div className="sidebar-heading">
        <span className="sidebar-workspace"><FolderOpen size={14} /><span>{session.info.name}</span></span>
        <div>
          <IconButton label={t("显示 / 隐藏文件列表")} active={state.settings.showList} onClick={() => state.updateSettings({ showList: !state.settings.showList })}>
            <PanelRight size={15} />
          </IconButton>
          <IconButton label={t("刷新文件树")} onClick={() => void state.refresh(id)}>
            <RefreshCw size={14} />
          </IconButton>
        </div>
      </div>
      <div
        className="tree-scroll"
        role="tree"
        tabIndex={0}
        aria-multiselectable="true"
        aria-label={t("工作目录文件树")}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("application/x-markfolio-entry")) event.preventDefault();
        }}
        onDrop={(event) => {
          if ((event.target as Element).closest('[role="treeitem"]')) return;
          event.preventDefault();
          try {
            const item = JSON.parse(event.dataTransfer.getData("application/x-markfolio-entry"));
            if (item.workspace !== id) throw new Error(t("请在同一工作目录中移动文件"));
            void operateFiles(item.workspace, item.paths, "move", "")
              .then((result) => state.setNotice(batchSummary(result)))
              .catch((error) => state.setNotice(displayError(error)));
          } catch (error) {
            state.setNotice(displayError(error));
          }
        }}
        onContextMenu={(event) => {
          if ((event.target as Element).closest('[role="treeitem"]')) return;
          event.preventDefault();
          setMenu({ kind: "blank", ...point(event) });
        }}
      >
        {render("", 0)}
        {!session.tree[""]?.length && <p className="tree-empty">{t("文件夹是空的")}<br />{t("点击新建笔记开始记录")}</p>}
      </div>
      {menu && (
        <>
          <div className="context-menu" style={{ left: menu.x, top: menu.y }} role="menu">
            {menu.kind === "note" ? (
              <NoteMenuItems
                workspace={id}
                path={menu.path}
                close={closeMenu}
                onDuplicate={() => duplicate(menu.path)}
                onMove={() => move(menu.path)}
                onDelete={() => remove(menu.path)}
                onProperties={() => action({ type: "properties", workspace: id, path: menu.path })}
                onSelectAll={() => state.selectFiles(id, session.query ? session.hits.map((hit) => hit.path) : visibleNotes(session, state.settings).map((note) => note.path))}
              />
            ) : menu.kind === "directory" ? (
              <>
                <button role="menuitem" disabled={session.mutating} onClick={() => { closeMenu(); action({ type: "new-file", workspace: id, path: menu.path }); }}><FilePlus2 size={15} /><span>{t("新建笔记")}</span></button>
                <button role="menuitem" disabled={session.mutating} onClick={() => { closeMenu(); action({ type: "new-folder", workspace: id, path: menu.path }); }}><FolderPlus size={15} /><span>{t("新建目录")}</span></button>
                {menu.path && <>
                  <div className="app-menu-separator" role="separator" />
                  <button role="menuitem" disabled={session.mutating} onClick={() => { closeMenu(); action({ type: "rename", workspace: id, path: menu.path }); }}><Pencil size={15} /><span>{t("重命名")}</span></button>
                  <button role="menuitem" disabled={session.mutating} onClick={() => { closeMenu(); action({ type: "move", workspace: id, path: menu.path }); }}><FolderOpen size={15} /><span>{t("移动到…")}</span></button>
                  <button role="menuitem" disabled={session.mutating} onClick={() => { closeMenu(); action({ type: "delete", workspace: id, path: menu.path }); }}><Trash2 size={15} /><span>{t("移入回收站")}</span></button>
                </>}
                <div className="app-menu-separator" role="separator" />
                {menu.path && <button role="menuitem" onClick={() => { closeMenu(); copyText(menu.path, t("路径已复制")); }}><Link size={15} /><span>{t("复制相对路径")}</span></button>}
                <button role="menuitem" onClick={() => { closeMenu(); copyFullPath(menu.path); }}><Copy size={15} /><span>{t("复制完整路径")}</span></button>
                <button role="menuitem" onClick={() => { closeMenu(); openDirectory(menu.path); }}><FolderOpen size={15} /><span>{t("在资源管理器中打开")}</span></button>
              </>
            ) : menu.kind === "blank" ? (
              <>
                <button role="menuitem" disabled={session.mutating} onClick={() => { closeMenu(); action({ type: "new-folder", workspace: id, path: "" }); }}><FolderPlus size={15} /><span>{t("新建目录")}</span></button>
                <button role="menuitem" disabled={session.mutating} onClick={() => { closeMenu(); action({ type: "new-file", workspace: id, path: "" }); }}><FilePlus2 size={15} /><span>{t("新建笔记")}</span></button>
                <div className="app-menu-separator" role="separator" />
                <button role="menuitem" onClick={() => { closeMenu(); openDirectory(""); }}><FolderOpen size={15} /><span>{t("在资源管理器中打开")}</span></button>
              </>
            ) : (
              <>
                <button role="menuitem" disabled={session.mutating} onClick={() => { closeMenu(); action({ type: "rename", workspace: id, path: menu.path }); }}><Pencil size={15} /><span>{t("重命名")}</span></button>
                <button role="menuitem" disabled={session.mutating} onClick={() => { closeMenu(); move(menu.path); }}><FolderOpen size={15} /><span>{t("移动到…")}</span></button>
                <button role="menuitem" disabled={session.mutating} onClick={() => { closeMenu(); remove(menu.path); }}><Trash2 size={15} /><span>{t("移入回收站")}</span></button>
                <div className="app-menu-separator" role="separator" />
                <button role="menuitem" onClick={() => { closeMenu(); copyText(fileName(menu.path), t("名称已复制")); }}><FileText size={15} /><span>{t("复制名称")}</span></button>
                <button role="menuitem" onClick={() => { closeMenu(); copyText(menu.path, t("路径已复制")); }}><Link size={15} /><span>{t("复制相对路径")}</span></button>
                <button role="menuitem" onClick={() => { closeMenu(); copyFullPath(menu.path); }}><Copy size={15} /><span>{t("复制完整路径")}</span></button>
                <button role="menuitem" onClick={() => { closeMenu(); void api.revealEntry(id, menu.path).catch((error) => state.setNotice(displayError(error))); }}><MapPin size={15} /><span>{t("在资源管理器中定位")}</span></button>
                <button role="menuitem" onClick={() => { closeMenu(); void api.openLocalFile(id, menu.path).catch((error) => state.setNotice(displayError(error))); }}><FileText size={15} /><span>{t("使用系统程序打开")}</span></button>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
