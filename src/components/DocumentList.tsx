import { t } from "../i18n";
import { useEffect, useState, type RefObject } from "react";
import { Check, ChevronDown, FilePlus2, FileText, FolderOpen, LayoutList, ListOrdered, Search, SquareCheck, Star, X } from "lucide-react";
import * as api from "../api";
import { useApp, type Session } from "../store";
import { visibleNotes } from "./NoteManagement";
import { displayError, fileName, type Dialog } from "../types";
import { useRegistry } from "../plugins/runtime";
import { PluginColumnValue } from "./PluginContributions";
import { noteSortFor, noteSortPatch } from "../settings";
import NoteMenuItems from "./NoteMenuItems";

export default function DocumentList({ session, query, setQuery, searchRef, run, action }: {
  session: Session;
  query: string;
  setQuery(q: string): void;
  searchRef: RefObject<HTMLInputElement>;
  run(id: string): void;
  action(dialog: Dialog): void;
}) {
  const state = useApp();
  const settings = state.settings;
  const [completed, setCompleted] = useState("all");
  const [menu, setMenu] = useState<{ x: number; y: number; path: string }>();
  const [blankMenu, setBlankMenu] = useState<{ x: number; y: number }>();
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number }>();
  const notes = visibleNotes(session, settings).filter((note) => session.view !== "todo" || completed === "all" || note.metadata.completed === (completed === "yes"));
  const cards = (session.query ? session.hits.map((hit) => ({ ...hit, name: fileName(hit.path), metadata: session.catalog?.find((note) => note.path === hit.path)?.metadata, size: 0 })) : notes).filter((note) => settings.showCompletedTodos || !note.metadata?.todo || !note.metadata.completed);
  const columns = useRegistry((value) => value.columns).filter((column) => column.workspace === session.info.id);
  const id = session.info.id;
  const paths = cards.map((note) => note.path);
  const sorting = noteSortFor(settings, id, session.folder, session.view);
  const sortOptions = [["name", t("名称")], ["modified", t("修改时间")], ["created", t("创建时间")], ["size", t("大小")], ["manual", t("手动排序")]] as const;
  const sortLabel = sortOptions.find(([value]) => value === sorting.sort)?.[1] ?? t("名称");
  useEffect(() => {
    if (!menu && !blankMenu && !sortMenu) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!target.closest(".context-menu")) {
        setMenu(undefined);
        setBlankMenu(undefined);
      }
      if (!target.closest(".sort-menu, .sort-trigger")) setSortMenu(undefined);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenu(undefined);
      setBlankMenu(undefined);
      setSortMenu(undefined);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", escape, true);
    };
  }, [menu, blankMenu, sortMenu]);
  const heading = session.query
    ? t("搜索结果")
    : session.view === "all" ? t("全部笔记")
      : session.view === "tag" ? `#${session.tag}`
        : session.view === "todo" ? t("待办笔记")
          : session.view === "pinned" ? t("置顶笔记")
            : fileName(session.folder) || t("根目录");

  function choose(path: string, event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
    if (event.shiftKey) {
      const anchor = paths.indexOf(session.selectionAnchor);
      const current = paths.indexOf(path);
      state.selectFiles(id, anchor < 0 ? [path] : paths.slice(Math.min(anchor, current), Math.max(anchor, current) + 1), session.selectionAnchor || path);
    } else if (event.ctrlKey || event.metaKey) {
      state.selectFiles(id, session.selected.includes(path) ? session.selected.filter((item) => item !== path) : [...session.selected, path], path);
      return;
    } else state.selectFiles(id, [path]);
    void state.openDocument(id, path).catch((error) => state.setNotice(displayError(error)));
  }

  return <section className={`file-list list-${settings.listStyle}`} style={{ width: settings.listWidth, order: settings.layoutOrder.split("-").indexOf("list") * 2 }}>
    <div className="list-heading"><h2>{heading}</h2><span>{cards.length} {t("篇文档")}</span></div>
    <div className="search-box"><Search size={15} /><input ref={searchRef} aria-label={t("搜索当前工作目录")} title={t("title:标题 tag:标签 -body:排除 OR \"短语\"")} placeholder={t("搜索文档…")} value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button aria-label={t("清除搜索")} onClick={() => setQuery("")}><X size={13} /></button>}</div>
    <div className="sort-bar">
      <button
        type="button"
        className="sort-trigger"
        aria-haspopup="menu"
        aria-expanded={!!sortMenu}
        title={t("排序方式")}
        onClick={(event) => {
          if (sortMenu) {
            setSortMenu(undefined);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setSortMenu({ x: Math.min(rect.left, window.innerWidth - 160), y: rect.bottom + 4 });
        }}
      >
        {sortLabel}<ChevronDown size={13} />
      </button>
      <button
        type="button"
        className={sorting.reverseSort ? "active" : ""}
        aria-pressed={sorting.reverseSort}
        title={t("反转排序")}
        onClick={() => state.updateSettings(noteSortPatch(settings, id, session.folder, session.view, { reverseSort: !sorting.reverseSort }))}
      >
        <ListOrdered size={14} /><span>{t("反转")}</span>
      </button>
      <button
        type="button"
        className={settings.listStyle === "details" ? "active" : ""}
        aria-pressed={settings.listStyle === "details"}
        title={t("切换摘要 / 详情")}
        onClick={() => state.updateSettings({ listStyle: settings.listStyle === "cards" ? "details" : "cards" })}
      >
        <LayoutList size={14} /><span>{settings.listStyle === "cards" ? t("详细") : t("摘要")}</span>
      </button>
    </div>
    {sortMenu && (
      <div className="context-menu sort-menu" style={{ left: sortMenu.x, top: sortMenu.y }} role="menu">
        {sortOptions.map(([value, label]) => (
          <button
            key={value}
            role="menuitemradio"
            aria-checked={sorting.sort === value}
            className={sorting.sort === value ? "selected" : ""}
            onClick={() => {
              setSortMenu(undefined);
              state.updateSettings(noteSortPatch(settings, id, session.folder, session.view, { sort: value }));
            }}
          >
            <span>{label}</span>{sorting.sort === value && <Check size={13} />}
          </button>
        ))}
      </div>
    )}
    {session.view === "todo" && <select aria-label={t("完成状态")} value={completed} onChange={(event) => setCompleted(event.target.value)}><option value="all">{t("全部待办")}</option><option value="no">{t("未完成")}</option><option value="yes">{t("已完成")}</option></select>}
    {settings.listStyle === "details" && <div className="detail-head"><span>{t("标题")}</span><span>{t("修改 / 大小")}</span></div>}
    <div
      className="file-list-scroll"
      tabIndex={0}
      role="listbox"
      aria-label={t("文档列表")}
      aria-multiselectable="true"
      onContextMenu={(event) => {
        if ((event.target as Element).closest(".document-card")) return;
        event.preventDefault();
        setBlankMenu({ x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 120) });
      }}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); state.selectFiles(id, paths); return; }
        const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
        if (keys.includes(event.key) && paths.length) {
          event.preventDefault();
          const index = paths.indexOf(session.selectionAnchor || session.file);
          const next = event.key === "Home" ? 0 : event.key === "End" ? paths.length - 1 : Math.max(0, Math.min(paths.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
          choose(paths[next], event);
          event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')[next]?.focus();
        }
        if (event.key === "Enter" && session.selectionAnchor) { event.preventDefault(); void state.openDocument(id, session.selectionAnchor); }
      }}
    >
      {cards.map((entry) => <button
        className={`document-card ${session.selected.includes(entry.path) ? "selected" : ""} ${entry.path === session.file ? "current-document" : ""}`}
        role="option"
        aria-selected={session.selected.includes(entry.path)}
        key={entry.path}
        draggable={!session.mutating}
        onDragStart={(event) => {
          event.dataTransfer.setData("application/x-markfolio-entry", JSON.stringify({ workspace: id, paths: session.selected.includes(entry.path) ? session.selected : [entry.path] }));
          event.dataTransfer.setData("text/markfolio-order", entry.path);
        }}
        onDragOver={(event) => { if (sorting.sort === "manual") event.preventDefault(); }}
        onDrop={(event) => {
          if (sorting.sort !== "manual") return;
          event.preventDefault();
          const from = event.dataTransfer.getData("text/markfolio-order");
          if (!paths.includes(from) || from === entry.path) return;
          const order = paths.filter((path) => path !== from);
          order.splice(order.indexOf(entry.path), 0, from);
          state.updateSettings({ manualOrder: { ...settings.manualOrder, [`${id}:${session.view}:${session.tag || session.folder}`]: order } });
        }}
        onClick={(event) => choose(entry.path, event)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!session.selected.includes(entry.path)) state.selectFiles(id, [entry.path]);
          setMenu({ x: Math.min(event.clientX, window.innerWidth - 230), y: Math.min(event.clientY, window.innerHeight - 340), path: entry.path });
        }}
      >
        <div><FileText size={15} /><strong>{entry.title || entry.name.replace(/\.(md|markdown)$/i, "")}</strong>{entry.metadata?.pinned && <Star size={12} />} {entry.metadata?.todo && <SquareCheck size={12} />} {session.documents[entry.path]?.dirty && <span className="dirty-dot" />}</div>
        <p>{entry.snippet || t("空白文档")}</p>
        <span>{entry.modified ? new Date(entry.modified).toLocaleDateString(settings.locale) : t("刚刚创建")}{settings.listStyle === "details" && ` · ${Math.ceil(entry.size / 1024)} KB`}</span>
        {entry.metadata?.tags.length ? <small className="note-tags">{entry.metadata.tags.map((tag) => `#${tag}`).join(" ")}</small> : null}
        {columns.map((column) => { const note = session.catalog?.find((item) => item.path === entry.path); return note ? <PluginColumnValue key={column.key} column={column} note={note} /> : null; })}
      </button>)}
      {!cards.length && <div className="list-empty"><FileText size={28} /><p>{session.query ? t("没有匹配的文档") : t("此视图还没有笔记")}</p><button onClick={() => run("file.new")}>{t("新建第一篇笔记")}</button></div>}
    </div>
    {menu && <>
      <div className="context-menu document-menu" style={{ left: menu.x, top: menu.y }} role="menu">
        <NoteMenuItems
          workspace={id}
          path={menu.path}
          close={() => setMenu(undefined)}
          onDuplicate={() => run("file.duplicate")}
          onMove={() => run("file.move")}
          onDelete={() => run("file.delete")}
          onProperties={() => action({ type: "properties", workspace: id, path: menu.path })}
          onSelectAll={() => run("files.selectAll")}
        />
      </div>
    </>}
    {blankMenu && <>
      <div className="context-menu" style={{ left: blankMenu.x, top: blankMenu.y }} role="menu">
        <button role="menuitem" onClick={() => { setBlankMenu(undefined); run("file.new"); }}><FilePlus2 size={15} /><span>{t("新建笔记")}</span></button>
        <div className="app-menu-separator" role="separator" />
        <button role="menuitem" onClick={() => { setBlankMenu(undefined); void api.openLocalFile(id, session.folder).catch((error) => state.setNotice(displayError(error))); }}><FolderOpen size={15} /><span>{t("在资源管理器中打开")}</span></button>
      </div>
    </>}
  </section>;
}
