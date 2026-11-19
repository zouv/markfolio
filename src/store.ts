import { t } from "./i18n";
import { create } from "zustand";
import * as defaultApi from "./api";
import {
  defaultSettings,
  displayError,
  parentPath,
  type Document,
  type FileEntry,
  type PluginBundle,
  type SearchHit,
  type Settings,
  type WorkspaceInfo,
  type NoteSummary,
} from "./types";
import { settingsDraftPatch, mergeWindowSettings } from "./settings";

export type Buffer = Document & {
  savedText: string;
  dirty: boolean;
  saving: boolean;
  error: string;
  errorCode?: string;
  revision: number;
};
export type Session = {
  info: WorkspaceInfo;
  folder: string;
  file: string;
  expanded: string[];
  tree: Record<string, FileEntry[]>;
  documents: Record<string, Buffer>;
  query: string;
  hits: SearchHit[];
  history: string[];
  historyIndex: number;
  indexing: boolean;
  selected: string[];
  selectionAnchor: string;
  mutating: boolean;
  catalog: NoteSummary[];
  view: "folder" | "all" | "tag" | "todo" | "pinned";
  tag: string;
  fragment: string;
};
export type State = {
  ready: boolean;
  version: string;
  settings: Settings;
  sessions: Record<string, Session>;
  order: string[];
  plugins: PluginBundle[];
  notice: string;
  active: string;
  initialize(): Promise<void>;
  openWorkspace(): Promise<void>;
  activate(id: string): void;
  closeWorkspace(id: string): Promise<void>;
  refresh(id: string): Promise<void>;
  expand(id: string, directory: string): Promise<void>;
  setFolder(id: string, path: string): void;
  setView(id: string, view: Session["view"], tag?: string): void;
  openLink(id: string, from: string, target: string, wiki?: boolean): Promise<void>;
  openDocument(id: string, path: string, navigate?: boolean): Promise<void>;
  edit(id: string, path: string, text: string): void;
  save(id: string, path: string): Promise<void>;
  reload(id: string, path: string): Promise<void>;
  updateSettings(patch: Partial<Settings>): void;
  applySettings(base: Settings, draft: Settings): Promise<void>;
  selectFiles(id: string, paths: string[], anchor?: string): void;
  setNotice(message: string): void;
  persistSettings(): Promise<void>;
  receiveSettings(settings: Settings): void;
  search(id: string, query: string): Promise<void>;
  reindex(id: string, notify?: boolean): Promise<void>;
  navigate(id: string, direction: number): Promise<void>;
};
function normalizeDocument(doc: Document): Document {
  return { ...doc, text: doc.text.replace(/\r\n/g, "\n") };
}
function initialSession(info: WorkspaceInfo, settings: Settings): Session {
  const saved = settings.sessions[info.id];
  return {
    info,
    folder: saved?.folder ?? "",
    file: "",
    expanded: saved?.expanded ?? [""],
    tree: {},
    documents: {},
    query: "",
    hits: [],
    history: [],
    historyIndex: -1,
    indexing: false,
    selected: [],
    selectionAnchor: "",
    mutating: false,
    catalog: [], view: "folder", tag: "", fragment: "",
  };
}
export function createAppStore(apiService: typeof defaultApi = defaultApi) {
  const api = apiService;
  let settingsQueue = Promise.resolve();
  let initializing: Promise<void> | undefined;
  const opening = new Map<string, number>();
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  const queues = new Map<string, Promise<void>>();
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let diskSettings: Settings | undefined;
  const mainWindow = () => api.isMainWindow?.() !== false;
  function persistenceSnapshot(state: State, candidate = state.settings): Settings {
    if (!mainWindow()) return {...candidate, activeWorkspace:diskSettings?.activeWorkspace ?? candidate.activeWorkspace, sessions:diskSettings?.sessions ?? candidate.sessions};
    return {...candidate, activeWorkspace:state.active, sessions:{...candidate.sessions,...Object.fromEntries(Object.entries(state.sessions).map(([id,session])=>[id,{folder:session.folder,file:session.file,expanded:session.expanded}]))}};
  }

  const store = create<State>((set, get) => {
    function patchSession(id: string, patch: Partial<Session>): void {
      set((state) => {
        const session = state.sessions[id];
        return session
          ? { sessions: { ...state.sessions, [id]: { ...session, ...patch } } }
          : {};
      });
    }
    function patchBuffer(
      id: string,
      path: string,
      patch: Partial<Buffer>,
    ): void {
      const session = get().sessions[id];
      const buffer = session?.documents[path];
      if (buffer)
        patchSession(id, {
          documents: { ...session.documents, [path]: { ...buffer, ...patch } },
        });
    }
    function persist(): void {
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        void get()
          .persistSettings()
          .catch((error) => get().setNotice(displayError(error)));
      }, 400);
    }
    return {
      ready: false,
      version: "",
      settings: defaultSettings,
      sessions: {},
      order: [],
      active: "",
      plugins: [],
      notice: "",
      async initialize() {
        if (initializing) return initializing;
        initializing = (async () => {
          if (get().ready) return;
          if (!api.isTauriRuntime()) {
            set({ ready: true });
            return;
          }
          try {
            const [snapshot, info, plugins] = await Promise.all([
              api.getSnapshot(),
              api.getAppInfo(),
              api.listPlugins(),
            ]);
            const settings = {
              ...defaultSettings,
              ...(snapshot.settings ?? {}),
              sessions: snapshot.settings?.sessions ?? {},
              plugins: snapshot.settings?.plugins ?? {},
              shortcuts: snapshot.settings?.shortcuts ?? {},
              markdownExtensions:{...defaultSettings.markdownExtensions,...snapshot.settings?.markdownExtensions},
            };
            diskSettings = settings;
            const context=api.windowContext?.();
            const workspaces=!mainWindow()&&context?.workspace?snapshot.workspaces.filter(info=>info.id===context.workspace):snapshot.workspaces;
            const sessions = Object.fromEntries(
              workspaces.map((info) => [
                info.id,
                initialSession(info, settings),
              ]),
            );
            const order = workspaces.map((info) => info.id);
            set({
              ready: true,
              settings,
              sessions,
              order,
              active: order.includes(settings.activeWorkspace)
                ? settings.activeWorkspace
                : (order[0] ?? ""),
              version: info.version,
              plugins,
            });
            for (const info of workspaces) {
              if (!info.available) continue;
              await get().refresh(info.id);
              const previous = !mainWindow()&&context?.note?context.note:settings.sessions[info.id]?.file;
              if (previous)
                await get()
                  .openDocument(info.id, previous)
                  .catch(() => {});
              void get().reindex(info.id);
            }
          } catch (error) {
            set({ ready: true });
            get().setNotice(displayError(error));
          }
        })();
        return initializing;
      },
      async openWorkspace() {
        if(!mainWindow()){get().setNotice(t("请在主窗口打开工作目录"));return;}
        if (!api.isTauriRuntime()) {
          get().setNotice(t("请运行桌面版以选择本地目录；浏览器仅用于界面预览。"));
          return;
        }
        try {
          const info = await api.openWorkspace();
          if (!info) return;
          if (!get().sessions[info.id])
            set((state) => ({
              sessions: {
                ...state.sessions,
                [info.id]: initialSession(info, state.settings),
              },
              order: [...state.order, info.id],
            }));
          patchSession(info.id, { info });
          get().activate(info.id);
          await get().refresh(info.id);
          const previous = get().settings.sessions[info.id]?.file;
          if (previous && !get().sessions[info.id]?.file)
            await get()
              .openDocument(info.id, previous)
              .catch(() => {});
          void get().reindex(info.id);
        } catch (error) {
          get().setNotice(displayError(error));
        }
      },
      activate(id) {
        if (!get().sessions[id]) return;
        set({ active: id });
        persist();
      },
      async closeWorkspace(id) {
        if(!mainWindow())throw new Error(t("请在主窗口关闭工作目录"));
        const session = get().sessions[id];
        if (!session) return;
        if (session.mutating)
          throw new Error(t("正在处理文件，请稍后关闭工作目录"));
        for (const [path, buffer] of Object.entries(session.documents))
          if (buffer.dirty) await get().save(id, path);
        set((state) => ({
          settings: {
            ...state.settings,
            sessions: {
              ...state.settings.sessions,
              [id]: {
                folder: session.folder,
                file: session.file,
                expanded: session.expanded,
              },
            },
          },
        }));
        await api.closeWorkspace(id);
        set((state) => {
          const sessions = { ...state.sessions };
          delete sessions[id];
          const order = state.order.filter((item) => item !== id);
          return {
            sessions,
            order,
            active: state.active === id ? (order[0] ?? "") : state.active,
          };
        });
        persist();
      },
      async refresh(id) {
        const session = get().sessions[id];
        if (!session || !session.info.available) return;
        const paths = [...new Set(["", session.folder, ...session.expanded])];
        const entries = await Promise.all(
          paths.map(async (path) => {
            try {
              return [
                path,
                await api.listDirectory(id, path, get().settings.showHidden),
              ] as const;
            } catch {
              return [path, []] as const;
            }
          }),
        );
        patchSession(id, {
          tree: { ...get().sessions[id]?.tree, ...Object.fromEntries(entries) },
        });
        const documents = get().sessions[id]?.documents ?? {};
        await Promise.all(
          Object.entries(documents).map(async ([path, buffer]) => {
            if (buffer.saving) return;
            try {
              const disk = normalizeDocument(await api.readDocument(id, path));
              const current = get().sessions[id]?.documents[path];
              if (!current || current.saving) return;
              if (disk.version === current.version) {
                if (current.error)
                  patchBuffer(id, path, { error: "", errorCode: "" });
                return;
              }
              if (current.dirty)
                patchBuffer(id, path, {
                  error: t("磁盘文件已变化。你的编辑仍在内存中，请先比较再保存。"),
                  errorCode: "CONFLICT",
                });
              else
                patchBuffer(id, path, {
                  ...disk,
                  savedText: disk.text,
                  error: "",
                  errorCode: "",
                });
            } catch (error) {
              patchBuffer(id, path, {
                error: displayError(error),
                errorCode:
                  typeof error === "object" && error && "code" in error
                    ? String(error.code)
                    : "IO",
              });
            }
          }),
        );
      },
      async expand(id, directory) {
        const session = get().sessions[id];
        if (!session) return;
        const expanded = session.expanded.includes(directory)
          ? session.expanded.filter((path) => path !== directory)
          : [...session.expanded, directory];
        patchSession(id, { expanded });
        if (expanded.includes(directory)) {
          const entries = await api.listDirectory(
            id,
            directory,
            get().settings.showHidden,
          );
          const current = get().sessions[id];
          if (current)
            patchSession(id, {
              tree: { ...current.tree, [directory]: entries },
            });
        }
        persist();
      },
      setFolder(id, path) {
        if (get().sessions[id]?.mutating) return;
        patchSession(id, {
          folder: path,
          query: "",
          hits: [],
          selected: [],
          selectionAnchor: "",
          view: "folder", tag: "",
        });
        void get().refresh(id);
        persist();
      },
      setView(id, view, tag = "") {
        patchSession(id, { view, tag, query: "", hits: [], selected: [], selectionAnchor: "" });
      },
      async openLink(id, from, target, wiki = false) {
        const link = await api.resolveNoteLink(id, from, target, wiki);
        if (!link.path) throw new Error(link.candidates.length ? t("存在同名笔记，请使用完整路径：{0}", link.candidates.join("、")) : t("链接文件不存在"));
        await get().openDocument(id, link.path);
        patchSession(id, { fragment: link.fragment });
      },
      async openDocument(id, path, navigate = true) {
        const session = get().sessions[id];
        if (!session) return;
        if (session.mutating) throw new Error(t("正在处理文件，请稍后打开文档"));
        const request = (opening.get(id) ?? 0) + 1;
        opening.set(id, request);
        if (!session.documents[path]) {
          const doc = normalizeDocument(await api.readDocument(id, path));
          const current = get().sessions[id];
          if (!current) return;
          if (!current.documents[path])
            patchSession(id, {
              documents: {
                ...current.documents,
                [path]: {
                  ...doc,
                  savedText: doc.text,
                  dirty: false,
                  saving: false,
                  error: "",
                  errorCode: "",
                  revision: 0,
                },
              },
            });
        }
        const current = get().sessions[id];
        if (!current) return;
        if (opening.get(id) !== request) return;
        const history =
          navigate && current.history[current.historyIndex] !== path
            ? [...current.history.slice(0, current.historyIndex + 1), path]
            : current.history;
        patchSession(id, {
          file: path,
          fragment: "",
          selected: current.selected.includes(path) ? current.selected : [path],
          selectionAnchor: current.selected.includes(path)
            ? current.selectionAnchor
            : path,
          folder: parentPath(path),
          history,
          historyIndex: navigate ? history.length - 1 : current.historyIndex,
        });
        const latest = get().sessions[id];
        if (latest) {
          const clean = Object.keys(latest.documents).filter(p => p !== path && !latest.documents[p].dirty && !latest.documents[p].saving);
          const remove = clean.slice(0, Math.max(0, Object.keys(latest.documents).length - get().settings.bufferLimit));
          if (remove.length) patchSession(id, { documents: Object.fromEntries(Object.entries(latest.documents).filter(([p]) => !remove.includes(p))) });
        }
        void get().refresh(id);
        persist();
      },
      edit(id, path, text) {
        if (get().sessions[id]?.mutating)
          throw new Error(t("正在处理文件，请稍后编辑"));
        const buffer = get().sessions[id]?.documents[path];
        if (!buffer) return;
        patchBuffer(id, path, {
          text,
          dirty: text !== buffer.savedText,
          revision: buffer.revision + 1,
        });
      },
      async save(id, path) {
        const key = `${id}:${path}`;
        const pending = queues.get(key) ?? Promise.resolve();
        const task = pending
          .catch(() => {})
          .then(async () => {
            const buffer = get().sessions[id]?.documents[path];
            if (!buffer?.dirty) return;
            if (buffer.errorCode === "CONFLICT") throw new Error(buffer.error);
            patchBuffer(id, path, { saving: true });
            try {
              const text =
                buffer.lineEnding === "crlf"
                  ? buffer.text.replace(/\n/g, "\r\n")
                  : buffer.text;
              const saved = normalizeDocument(
                await api.saveDocument(id, { ...buffer, text }),
              );
              const current = get().sessions[id]?.documents[path];
              if (!current) return;
              patchBuffer(id, path, {
                version: saved.version,
                savedText: saved.text,
                dirty: current.text !== saved.text,
                saving: false,
                error: "",
              });
            } catch (error) {
              patchBuffer(id, path, {
                saving: false,
                error: displayError(error),
                errorCode:
                  typeof error === "object" && error && "code" in error
                    ? String(error.code)
                    : "IO",
              });
              throw error;
            }
          });
        queues.set(key, task);
        try {
          await task;
        } finally {
          if (queues.get(key) === task) queues.delete(key);
        }
      },
      async reload(id, path) {
        const doc = normalizeDocument(await api.readDocument(id, path));
        patchBuffer(id, path, {
          ...doc,
          savedText: doc.text,
          dirty: false,
          saving: false,
          error: "",
          revision: 0,
        });
      },
      updateSettings(patch) {
        set((state) => ({ settings: { ...state.settings, ...patch } }));
        if (patch.showHidden !== undefined)
          for (const id of get().order) void get().refresh(id);
        persist();
      },
      selectFiles(id, paths, anchor = paths[paths.length - 1] ?? "") {
        patchSession(id, {
          selected: [...new Set(paths)],
          selectionAnchor: anchor,
        });
      },
      async applySettings(base, draft) {
        const task = settingsQueue
          .catch(() => {})
          .then(async () => {
            const patch = settingsDraftPatch(get().settings, base, draft);
            const candidate = { ...get().settings, ...patch };
            if (api.isTauriRuntime()) {
              const before = get().settings;
              const saved = await api.saveSettings(persistenceSnapshot(get(),candidate),diskSettings);
              if (saved && typeof saved === "object") {
                diskSettings = {...defaultSettings,...saved,markdownExtensions:{...defaultSettings.markdownExtensions,...saved.markdownExtensions}};
                set({settings:mergeWindowSettings(diskSettings,before,get().settings)});
              }
            }
            // Background plugin writes may have arrived during the disk write.
            const latestPatch = settingsDraftPatch(get().settings, base, draft);
            set((state) => ({
              settings: { ...state.settings, ...latestPatch },
            }));
            if (patch.showHidden !== undefined)
              for (const id of get().order) void get().refresh(id);
          });
        settingsQueue = task.then(() => {}, () => {});
        await task;
        persist();
      },
      async persistSettings() {
        clearTimeout(persistTimer);
        if (!api.isTauriRuntime()) return;
        const task = settingsQueue
          .catch(() => {})
          .then(async () => {
            const state = get();
            const sessions = {
              ...state.settings.sessions,
              ...Object.fromEntries(
                Object.entries(state.sessions).map(([id, session]) => [
                  id,
                  {
                    folder: session.folder,
                    file: session.file,
                    expanded: session.expanded,
                  },
                ]),
              ),
            };
            const settings = {
              ...state.settings,
              activeWorkspace: state.active,
              sessions,
            };
            const before = state.settings;
            const saved = await api.saveSettings(mainWindow()?settings:persistenceSnapshot(state),diskSettings);
            if (saved && typeof saved === "object") {
              diskSettings = {...defaultSettings,...saved,markdownExtensions:{...defaultSettings.markdownExtensions,...saved.markdownExtensions}};
              set({settings:mergeWindowSettings(diskSettings,before,get().settings)});
            }
          });
        settingsQueue = task.then(() => {}, () => {});
        await task;
      },
      receiveSettings(settings) {
        const incoming = {...defaultSettings,...settings,markdownExtensions:{...defaultSettings.markdownExtensions,...settings.markdownExtensions}};
        const previous = get().settings;
        const merged = diskSettings ? mergeWindowSettings(incoming,diskSettings,previous) : incoming;
        diskSettings = incoming;
        set({settings:merged});
        if (previous.showHidden !== merged.showHidden) for (const id of get().order) void get().refresh(id);
      },
      setNotice(message) {
        clearTimeout(noticeTimer);
        set({ notice: message });
        noticeTimer = setTimeout(() => set({ notice: "" }), 6000);
      },
      async search(id, query) {
        patchSession(id, { query });
        if (!query.trim()) {
          patchSession(id, { hits: [] });
          return;
        }
        const hits = await api.searchDocuments(id, query);
        if (get().sessions[id]?.query === query) patchSession(id, { hits });
      },
      async reindex(id, notify = false) {
        if (!get().sessions[id] || get().sessions[id].indexing) return;
        patchSession(id, { indexing: true });
        try {
          const count = await api.rebuildIndex(id, notify);
          const catalog = await api.catalogDocuments(id);
          patchSession(id, { indexing: false, catalog });
          const query = get().sessions[id]?.query;
          if (query) await get().search(id, query);
          if (notify) get().setNotice(t("索引已更新 · {0} 篇 Markdown 文档", count));
        } catch (error) {
          patchSession(id, { indexing: false });
          get().setNotice(displayError(error));
        }
      },
      async navigate(id, direction) {
        const session = get().sessions[id];
        if (!session) return;
        const index = session.historyIndex + direction;
        if (index < 0 || index >= session.history.length) return;
        patchSession(id, { historyIndex: index });
        await get().openDocument(id, session.history[index], false);
      },
    };
  });
  return store;
}
export const useApp = createAppStore();

export async function flushDocuments(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const state = useApp.getState();
    if (Object.values(state.sessions).some((session) => session.mutating))
      throw new Error(t("正在处理文件，请稍后关闭"));
    const dirty = Object.entries(state.sessions).flatMap(([id, session]) =>
      Object.entries(session.documents)
        .filter(([, buffer]) => buffer.dirty)
        .map(([path]) => [id, path]),
    );
    if (!dirty.length) {
      await state.persistSettings();
      return;
    }
    for (const [id, path] of dirty) await state.save(id, path);
  }
  throw new Error(t("文档仍在变化，请停止输入后重试关闭"));
}

export async function relocateBuffers(
  id: string,
  from: string,
  to: string,
): Promise<void> {
  const { moveEntry } = await import("./fileOperations");
  await moveEntry(id, from, to);
}
