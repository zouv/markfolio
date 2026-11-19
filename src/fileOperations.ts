import { t } from "./i18n";
import * as defaultApi from "./api";
import { useApp, type State } from "./store";
import { displayError, fileName, joinPath } from "./types";
import type { StoreApi } from "zustand";

export type BatchResult = {
  completed: { from: string; to?: string }[];
  failed: { path: string; message: string }[];
};
const contains = (root: string, path: string) =>
  path === root || path.startsWith(root + "/");
export function operationRoots(paths: string[]): string[] {
  const unique = [...new Set(paths)].filter(Boolean);
  return unique.filter(
    (path) =>
      !unique.some((parent) => parent !== path && contains(parent, path)),
  );
}
export async function operateFiles(
  workspace: string,
  paths: string[],
  operation: "move" | "delete" | "duplicate",
  directory = "",
  store: StoreApi<State> = useApp,
  api = defaultApi,
): Promise<BatchResult> {
  const initial = store.getState().sessions[workspace];
  if (!initial || initial.mutating)
    throw new Error(t("工作目录不可用或正在处理文件"));
  const roots = operationRoots(paths);
  if (!roots.length) throw new Error(t("请先选择文件"));
  const setSession = (patch: Partial<typeof initial>) =>
    store.setState((state) => {
      const session = state.sessions[workspace];
      return session
        ? {
            sessions: {
              ...state.sessions,
              [workspace]: { ...session, ...patch },
            },
          }
        : {};
    });
  setSession({ mutating: true });
  const result: BatchResult = { completed: [], failed: [] };
  try {
    for (const path of roots) {
      try {
        let session = store.getState().sessions[workspace];
        if (!session) throw new Error(t("工作目录已关闭"));
        const affected = Object.keys(session.documents).filter((item) =>
          contains(path, item),
        );
        if (
          operation === "delete" &&
          affected.some(
            (item) =>
              session.documents[item].dirty || session.documents[item].saving,
          )
        )
          throw new Error(t("包含未保存编辑，请先保存后删除"));
        if (operation !== "delete")
          for (const item of operation === "move" ? Object.keys(session.documents) : affected)
            await store.getState().save(workspace, item);
        let target: string | undefined;
        if (operation === "duplicate")
          target = await api.duplicateEntry(workspace, path);
        else if (operation === "move") {
          target = joinPath(directory, fileName(path));
          if (target === path) throw new Error(t("文件已在目标文件夹中"));
          await api.renameEntry(workspace, path, target);
        } else await api.deleteEntry(workspace, path);
        session = store.getState().sessions[workspace];
        if (!session) throw new Error(t("工作目录已关闭"));
        if (operation !== "duplicate") {
          const translate = (item: string) =>
            contains(path, item)
              ? operation === "delete"
                ? ""
                : target! + item.slice(path.length)
              : item;
          const documents = Object.fromEntries(
            Object.entries(session.documents)
              .filter(
                ([item]) => operation !== "delete" || !contains(path, item),
              )
              .map(([item, buffer]) => [
                translate(item),
                { ...buffer, path: translate(item) },
              ]),
          );
          const history = session.history.map(translate).filter(Boolean);
          const file = translate(session.file);
          setSession({
            documents,
            file,
            folder: translate(session.folder),
            expanded: [...new Set(session.expanded.map(translate))],
            tree: {},
            selected: session.selected.map(translate).filter(Boolean),
            selectionAnchor: translate(session.selectionAnchor),
            history,
            historyIndex: file
              ? history.lastIndexOf(file)
              : Math.min(session.historyIndex, history.length - 1),
          });
        }
        result.completed.push({ from: path, to: target });
      } catch (error) {
        result.failed.push({ path, message: displayError(error) });
      }
    }
  } finally {
    setSession({ mutating: false });
    await store.getState().refresh(workspace);
    void store.getState().reindex(workspace);
  }
  return result;
}
export async function moveEntry(
  workspace: string,
  from: string,
  to: string,
): Promise<void> {
  // Renaming may change the basename; use a direct target, sharing the same mutation safeguards.
  const state = useApp.getState();
  const session = state.sessions[workspace];
  if (!session || session.mutating)
    throw new Error(t("工作目录不可用或正在处理文件"));
  useApp.setState((s) => ({
    sessions: { ...s.sessions, [workspace]: { ...session, mutating: true } },
  }));
  try {
    for (const [path] of Object.entries(session.documents))
      await state.save(workspace, path);
    await defaultApi.renameEntry(workspace, from, to);
    const current = useApp.getState().sessions[workspace];
    const translate = (path: string) =>
      contains(from, path) ? to + path.slice(from.length) : path;
    useApp.setState((s) => ({
      sessions: {
        ...s.sessions,
        [workspace]: {
          ...current,
          documents: Object.fromEntries(
            Object.entries(current.documents).map(([path, buffer]) => [
              translate(path),
              { ...buffer, path: translate(path) },
            ]),
          ),
          folder: translate(current.folder),
          file: translate(current.file),
          expanded: current.expanded.map(translate),
          selected: current.selected.map(translate),
          selectionAnchor: translate(current.selectionAnchor),
          history: current.history.map(translate),
          tree: {},
          mutating: false,
        },
      },
    }));
  } finally {
    useApp.setState((s) => ({
      sessions: {
        ...s.sessions,
        [workspace]: { ...s.sessions[workspace], mutating: false },
      },
    }));
    await useApp.getState().refresh(workspace);
    void useApp.getState().reindex(workspace);
  }
}
export function batchSummary(result: BatchResult): string {
  return t("完成 {0} 项{1}", result.completed.length, result.failed.length ? `，失败 ${result.failed.length} 项：${result.failed.map((item) => `${item.path}：${item.message}`).join("；")}` : "");
}
