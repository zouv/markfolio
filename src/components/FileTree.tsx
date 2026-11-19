import { t } from "../i18n";
import { useState } from "react";
import {
  FolderPlus,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
} from "lucide-react";
import * as api from "../api";
import { useApp, type Session } from "../store";
import { displayError, type Dialog } from "../types";
import { IconButton, IconForFile, markdownFile } from "./Controls";
import { operateFiles, batchSummary } from "../fileOperations";
export default function FileTree({
  session,
  action,
}: {
  session: Session;
  action(dialog: Dialog): void;
}) {
  const state = useApp();
  const [menu, setMenu] = useState<{
    path: string;
    directory: boolean;
    x: number;
    y: number;
  }>();
  function render(directory: string, depth: number): React.ReactNode {
    return [...(session.tree[directory] ?? [])].sort((a,b)=>Number(b.isDirectory)-Number(a.isDirectory)||(a.isDirectory&&b.isDirectory?((state.settings.folderSort==="modified"?b.modified-a.modified:a.name.localeCompare(b.name,state.settings.locale,{numeric:true}))*(state.settings.folderSortReverse?-1:1)):a.name.localeCompare(b.name,state.settings.locale,{numeric:true}))).map((entry) => (
      <div key={entry.path}>
        <div
          role="treeitem"
          aria-selected={session.selected.includes(entry.path)}
          aria-expanded={
            entry.isDirectory
              ? session.expanded.includes(entry.path)
              : undefined
          }
          className={`tree-row ${session.selected.includes(entry.path) ? "selected" : ""}`}
          tabIndex={0}
          onKeyDown={event=>{
            const items=[...event.currentTarget.closest(".tree-scroll")!.querySelectorAll<HTMLElement>('[role="treeitem"]')];const index=items.indexOf(event.currentTarget);
            if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();items[Math.max(0,Math.min(items.length-1,index+(event.key==="ArrowDown"?1:-1)))]?.focus();}
            else if(event.key==="ArrowRight"&&entry.isDirectory&&!session.expanded.includes(entry.path)){event.preventDefault();void state.expand(session.info.id,entry.path);}
            else if(event.key==="ArrowLeft"&&entry.isDirectory&&session.expanded.includes(entry.path)){event.preventDefault();void state.expand(session.info.id,entry.path);}
            else if(event.key==="Enter"||event.key===" "){event.preventDefault();event.currentTarget.click();}
          }}
          style={{ paddingLeft: 12 + depth * 16 }}
          draggable={!session.mutating}
          onDragStart={(event) => {
            event.dataTransfer.setData(
              "application/x-markfolio-entry",
              JSON.stringify({
                workspace: session.info.id,
                paths: session.selected.includes(entry.path)
                  ? session.selected
                  : [entry.path],
              }),
            );
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(event) => {
            if (
              entry.isDirectory &&
              event.dataTransfer.types.includes("application/x-markfolio-entry")
            )
              event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            try {
              const item = JSON.parse(
                event.dataTransfer.getData("application/x-markfolio-entry"),
              ) as { workspace: string; paths: string[] };
              if (item.workspace !== session.info.id)
                throw new Error(t("请在同一工作目录中移动文件"));
              void operateFiles(item.workspace, item.paths, "move", entry.path)
                .then((result) => state.setNotice(batchSummary(result)))
                .catch((error) => state.setNotice(displayError(error)));
            } catch (error) {
              state.setNotice(displayError(error));
            }
          }}
          onClick={(event) => {
            if (event.ctrlKey || event.metaKey) {
              state.selectFiles(
                session.info.id,
                session.selected.includes(entry.path)
                  ? session.selected.filter((path) => path !== entry.path)
                  : [...session.selected, entry.path],
                entry.path,
              );
              return;
            }
            if (entry.isDirectory) state.setFolder(session.info.id, entry.path);
            state.selectFiles(session.info.id, [entry.path]);
            if (entry.isDirectory) return;
            else if (entry.path.endsWith(".mflock")) {window.dispatchEvent(new CustomEvent("markfolio-unlock",{detail:{workspace:session.info.id,path:entry.path}}));return;}
            else if (markdownFile(entry.path))
              void state
                .openDocument(session.info.id, entry.path)
                .catch((error) => state.setNotice(displayError(error)));
            else
              void api
                .openLocalFile(session.info.id, entry.path)
                .catch((error) => state.setNotice(displayError(error)));
          }}
          onDoubleClick={() => {
            if (entry.isDirectory)
              void state.expand(session.info.id, entry.path);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            if (!session.selected.includes(entry.path))
              state.selectFiles(session.info.id, [entry.path]);
            setMenu({
              path: entry.path,
              directory: entry.isDirectory,
              x: Math.min(event.clientX, window.innerWidth - 205),
              y: Math.min(event.clientY, window.innerHeight - 220),
            });
          }}
        >
          {entry.isDirectory ? (
            <button
              className="tree-chevron"
              aria-label={t("展开 {0}", entry.name)}
              onClick={(event) => {
                event.stopPropagation();
                void state.expand(session.info.id, entry.path);
              }}
            >
              {session.expanded.includes(entry.path) ? (
                <ChevronDown size={13} />
              ) : (
                <ChevronRight size={13} />
              )}
            </button>
          ) : (
            <span className="tree-spacer" />
          )}
          {entry.isDirectory ? (
            <Folder size={15} className="folder-icon" />
          ) : (
            <IconForFile path={entry.path} />
          )}
          <span>{entry.name}</span>
          {entry.isDirectory&&state.settings.showNoteCounts&&<small className="tree-note-count">{session.catalog.filter(n=>n.path.startsWith(entry.path+"/")).length}</small>}
          {!!session.documents[entry.path]?.dirty && (
            <span className="dirty-dot" />
          )}
        </div>
        {entry.isDirectory &&
          session.expanded.includes(entry.path) &&
          render(entry.path, depth + 1)}
      </div>
    ));
  }
  return (
    <>
      <div className="sidebar-heading">
        <span>{t("文件")}</span>
        <div>
          <IconButton
            label={t("新建文件夹")}
            onClick={() =>
              action({
                type: "new-folder",
                workspace: session.info.id,
                path: session.folder,
              })
            }
          >
            <FolderPlus size={15} />
          </IconButton>
          <IconButton
            label={t("刷新文件树")}
            onClick={() => void state.refresh(session.info.id)}
          >
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
      >
        <button
          className={`tree-root ${session.folder === "" ? "root-selected" : ""}`}
          onClick={() => state.setFolder(session.info.id, "")}
          onDragOver={(event) => {
            if (
              event.dataTransfer.types.includes("application/x-markfolio-entry")
            )
              event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            try {
              const item = JSON.parse(
                event.dataTransfer.getData("application/x-markfolio-entry"),
              );
              if (item.workspace !== session.info.id)
                throw new Error(t("请在同一工作目录中移动文件"));
              void operateFiles(item.workspace, item.paths, "move", "")
                .then((result) => state.setNotice(batchSummary(result)))
                .catch((error) => state.setNotice(displayError(error)));
            } catch (error) {
              state.setNotice(displayError(error));
            }
          }}
        >
          <ChevronDown size={14} />
          <FolderOpen size={16} />
          <strong>{session.info.name}</strong>
        </button>
        {render("", 0)}
        {!session.tree[""]?.length && (
          <p className="tree-empty">
            {t("文件夹是空的")}<br />
            {t("点击新建笔记开始记录")}</p>
        )}
      </div>
      {menu && (
        <>
          <div
            className="context-backdrop"
            onClick={() => setMenu(undefined)}
          />
          <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
            {session.selected.length > 1
              ? [
                  ["batch-move", t("移动选中项…")],
                  ["batch-delete", t("选中项移入回收站")],
                ].map(([type, label]) => (
                  <button
                    key={type}
                    disabled={session.mutating}
                    onClick={() => {
                      action({
                        type: type as Dialog["type"],
                        workspace: session.info.id,
                        paths: [...session.selected],
                      });
                      setMenu(undefined);
                    }}
                  >
                    {label}
                  </button>
                ))
              : [
                  ["rename", t("重命名")],
                  ["move", t("移动到…")],
                  ["delete", t("移入回收站")],
                ].map(([type, label]) => (
                  <button
                    key={type}
                    disabled={session.mutating}
                    onClick={() => {
                      action({
                        type: type as Dialog["type"],
                        workspace: session.info.id,
                        path: menu.path,
                      });
                      setMenu(undefined);
                    }}
                  >
                    {label}
                  </button>
                ))}
            {!menu.directory && (
              <button
                disabled={session.mutating}
                onClick={() => {
                  void operateFiles(
                    session.info.id,
                    session.selected.filter(markdownFile),
                    "duplicate",
                  )
                    .then((result) => state.setNotice(batchSummary(result)))
                    .catch((error) => state.setNotice(displayError(error)));
                  setMenu(undefined);
                }}
              >
                {t("复制笔记")}</button>
            )}
            <button
              onClick={() => {
                void api.openLocalFile(session.info.id, menu.path);
                setMenu(undefined);
              }}
            >
              {t("使用系统程序打开")}</button>
          </div>
        </>
      )}
    </>
  );
}
