import type { Settings } from "./types";
const editableKeys = [
  "theme",
  "fontSize",
  "fontFamily",
  "lineHeight",
  "autoSave",
  "autoSaveDelay",
  "showHidden",
  "showSidebar",
  "showList",
  "mode",
  "wordWrap",
  "lineNumbers",
  "sidebarWidth",
  "listWidth",
  "sort",
  "reverseSort",
  "math",
  "diagrams",
  "manualOrder", "listStyle", "editorMode", "keyMode", "spellcheck", "inlineWidgets", "htmlPaste",
  "previewFontSize", "previewFontFamily", "previewWidth", "customCss", "rawHtml", "remoteImages",
  "zoom", "layoutOrder", "menuVisible", "locale", "indexMaxMb", "bufferLimit", "updateLinks", "trashMode",
  "safeMode", "tray", "minimizeToTray", "globalShortcut", "updateUrl", "pluginRepositories",
  "shortcuts",
] as const;
const changed = (a: unknown, b: unknown) =>
  JSON.stringify(a) !== JSON.stringify(b);

// Apply only fields actually edited in the dialog, preserving concurrent workspace/plugin changes.
export function settingsDraftPatch(
  current: Settings,
  base: Settings,
  draft: Settings,
): Partial<Settings> {
  const patch: Record<string, unknown> = {};
  for (const key of editableKeys)
    if (changed(base[key], draft[key])) patch[key] = draft[key];
  let plugins = current.plugins;
  for (const [workspace, configurations] of Object.entries(draft.plugins)) {
    for (const [id, configuration] of Object.entries(configurations)) {
      const before = base.plugins[workspace]?.[id];
      if (!changed(before, configuration)) continue;
      const latest = plugins[workspace]?.[id] ?? {
        enabled: configuration.enabled,
        data: {},
      };
      let data = latest.data;
      if (changed(before?.data, configuration.data)) {
        if (
          typeof configuration.data !== "object" ||
          configuration.data === null ||
          Array.isArray(configuration.data)
        ) {
          data = configuration.data;
        } else {
          const initial = (before?.data ?? {}) as Record<string, unknown>;
          const proposed = (configuration.data ?? {}) as Record<
            string,
            unknown
          >;
          const combined = { ...(latest.data as Record<string, unknown>) };
          for (const key of new Set([
            ...Object.keys(initial),
            ...Object.keys(proposed),
          ])) {
            if (!changed(initial[key], proposed[key])) continue;
            if (key in proposed) combined[key] = proposed[key];
            else delete combined[key];
          }
          data = combined;
        }
      }
      plugins = {
        ...plugins,
        [workspace]: {
          ...plugins[workspace],
          [id]: {
            ...latest,
            ...(changed(before?.permissions, configuration.permissions) ? { permissions: configuration.permissions } : {}),
            enabled: changed(before?.enabled, configuration.enabled)
              ? configuration.enabled
              : latest.enabled,
            data,
          },
        },
      };
    }
  }
  if (plugins !== current.plugins) patch.plugins = plugins;
  return patch as Partial<Settings>;
}
export const settingsCatalog = [
  ["general", "autoSave", "自动保存", "停止输入后保存文档"],
  ["general", "autoSaveDelay", "自动保存延迟", "保存间隔 毫秒"],
  ["general", "showHidden", "显示隐藏文件", "点号目录 文件树"],
  ["appearance", "theme", "主题", "浅色 深色 跟随系统"],
  ["appearance", "showSidebar", "显示文件树", "侧栏 布局"],
  ["appearance", "showList", "显示文档列表", "列表 布局"],
  ["editor", "fontSize", "字体大小", "字号"],
  ["editor", "lineHeight", "行高", "行间距"],
  ["editor", "fontFamily", "编辑器字体", "字体名称"],
  ["editor", "wordWrap", "自动换行", "长行"],
  ["editor", "lineNumbers", "显示行号", "编辑器"],
  ["editor", "mode", "编辑布局", "编辑 并排 预览"],
  ["markdown", "math", "数学公式", "KaTeX 公式"],
  ["markdown", "diagrams", "Mermaid 图表", "流程图"],
  ["keymap", "shortcuts", "键盘快捷键", "自定义 按键 冲突 重置"],
  ["plugins", "plugins", "插件", "安装 启用 配置"],
] as const;
