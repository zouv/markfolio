import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { t } from "../i18n";
import * as api from "../api";
import { useApp } from "../store";
import { displayError, type FileEntry } from "../types";

/** Folder-only picker used by move dialogs; directories load on expand. */
export default function DirectoryPicker({
  workspace,
  value,
  onChange,
  disabledPaths = [],
  rootName,
}: {
  workspace: string;
  value: string;
  onChange(path: string): void;
  disabledPaths?: string[];
  rootName?: string;
}) {
  const showHidden = useApp((state) => state.settings.showHidden);
  const session = useApp((state) => state.sessions[workspace]);
  const [entries, setEntries] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const loaded = useRef(new Set<string>());
  const pending = useRef(new Set<string>());
  const generation = useRef(0);
  const root = rootName ?? session?.info.name ?? t("工作目录根目录");

  async function load(path: string) {
    if (loaded.current.has(path) || pending.current.has(path)) return;
    pending.current.add(path);
    const currentGeneration = generation.current;
    setLoading((current) => new Set(current).add(path));
    try {
      const list = await api.listDirectory(workspace, path, showHidden);
      if (generation.current !== currentGeneration) return;
      loaded.current.add(path);
      setEntries((current) => ({ ...current, [path]: list }));
      setError("");
    } catch (cause) {
      if (generation.current === currentGeneration) setError(displayError(cause));
    } finally {
      pending.current.delete(path);
      if (generation.current === currentGeneration)
        setLoading((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
    }
  }

  useEffect(() => {
    generation.current += 1;
    loaded.current.clear();
    pending.current.clear();
    setEntries({});
    setExpanded(new Set());
    setLoading(new Set());
    setError("");
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, showHidden]);

  useEffect(() => {
    const parts = value.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      void load(current);
      setExpanded((previous) => (previous.has(current) ? previous : new Set(previous).add(current)));
      current = current ? `${current}/${part}` : part;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, workspace, showHidden]);

  const disabled = (path: string) => path !== "" && disabledPaths.some((item) => path === item || path.startsWith(`${item}/`));

  function toggle(path: string) {
    if (expanded.has(path)) {
      setExpanded((previous) => {
        const next = new Set(previous);
        next.delete(path);
        return next;
      });
    } else {
      setExpanded((previous) => new Set(previous).add(path));
      void load(path);
    }
  }

  function render(directory: string, depth: number): React.ReactNode {
    const items = (entries[directory] ?? [])
      .filter((entry) => entry.isDirectory)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return items.map((entry) => {
      const open = expanded.has(entry.path);
      const unavailable = disabled(entry.path);
      return (
        <div key={entry.path}>
          <div
            role="treeitem"
            aria-selected={value === entry.path}
            aria-expanded={open}
            aria-disabled={unavailable}
            tabIndex={unavailable ? -1 : 0}
            className={`directory-row ${value === entry.path ? "selected" : ""} ${unavailable ? "disabled" : ""}`}
            style={{ paddingLeft: 6 + depth * 16 }}
            onClick={() => { if (!unavailable) onChange(entry.path); }}
            onKeyDown={(event) => {
              if ((event.key === "Enter" || event.key === " ") && !unavailable) {
                event.preventDefault();
                onChange(entry.path);
              }
            }}
          >
            <button
              type="button"
              className="directory-chevron"
              aria-label={open ? t("折叠") : t("展开")}
              disabled={unavailable}
              onClick={(event) => { event.stopPropagation(); toggle(entry.path); }}
            >
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            {open ? <FolderOpen size={14} /> : <Folder size={14} />}
            <span>{entry.name}</span>
          </div>
          {open && render(entry.path, depth + 1)}
        </div>
      );
    });
  }

  return (
    <div className="directory-picker">
      <div className="directory-tree" role="tree" aria-label={t("选择目标文件夹")}>
        <div
          role="treeitem"
          aria-selected={value === ""}
          tabIndex={0}
          className={`directory-row root ${value === "" ? "selected" : ""}`}
          onClick={() => onChange("")}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onChange("");
            }
          }}
        >
          <FolderOpen size={14} />
          <strong>{root}</strong>
        </div>
        {render("", 0)}
        {loading.has("") && <p className="directory-loading">{t("加载中…")}</p>}
      </div>
      {error && <p className="form-error">{error}</p>}
      <p className="directory-picker-status">{t("当前选择：{0}", value || root)}</p>
    </div>
  );
}
