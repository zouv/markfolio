import type { Settings } from "./types";
export function mergeWindowSettings(current: Settings, base: Settings, next: Settings): Settings {
  function merge(current: unknown, base: unknown, next: unknown): unknown {
    if (JSON.stringify(base) === JSON.stringify(next)) return current;
    if (base && next && typeof base === "object" && typeof next === "object" && !Array.isArray(base) && !Array.isArray(next)) {
      const before = base as Record<string,unknown>, proposed = next as Record<string,unknown>;
      const entries = new Map(Object.entries(current && typeof current === "object" ? current : {}));
      for (const key of new Set([...Object.keys(before), ...Object.keys(proposed)])) {
        if (!(key in proposed)) entries.delete(key);
        else if (JSON.stringify(before[key]) !== JSON.stringify(proposed[key])) entries.set(key, merge(entries.get(key),before[key],proposed[key]));
      }
      return Object.fromEntries(entries);
    }
    return next;
  }
  return merge(current,base,next) as Settings;
}
const editableKeys = [
  "showNoteCounts", "uncompletedTodosOnTop", "showCompletedTodos", "tabMovesFocus", "layoutCycle",
  "perFolderSort","folderSorts","folderSort","folderSortReverse",
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
  "diagrams", "markdownExtensions",
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
    if (changed(base[key], draft[key])) patch[key] = ["shortcuts","manualOrder","markdownExtensions","folderSorts"].includes(key) ? mergeWindowSettings(current,base,{...base,[key]:draft[key]})[key] : draft[key];
  let plugins = current.plugins;
  for (const [workspace, configurations] of Object.entries(draft.plugins)) {
    for (const [id, configuration] of Object.entries(configurations)) {
      const before = base.plugins[workspace]?.[id];
      if(before&&!current.plugins[workspace]?.[id])continue;
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
  ["appearance","perFolderSort","按目录独立记住排序","笔记 排序"],
  ["appearance","folderSort","文件夹排序","名称 修改时间"],
  ["appearance","showNoteCounts","显示笔记数量","目录 标签"],
  ["appearance","uncompletedTodosOnTop","未完成待办置顶","待办 排序"],
  ["appearance","showCompletedTodos","显示已完成待办","待办 筛选"],
  ["editor","tabMovesFocus","Tab 键移动焦点","缩进 无障碍"],
  ["editor","layoutCycle","布局切换顺序","编辑 预览 并排"],
  ["general","locale","界面语言","中文 English"],
  ["general","updateLinks","移动时更新链接","重命名 内部链接"],
  ["general","trashMode","删除文件去向","垃圾箱 恢复 系统回收站"],
  ["appearance","zoom","界面缩放","放大 缩小"],
  ["appearance","layoutOrder","面板位置","自由调整布局"],
  ["appearance","listStyle","列表样式","摘要 详细列"],
  ["editor","editorMode","编辑器类型","Markdown 富文本"],
  ["editor","keyMode","编辑键位","Vim Emacs"],
  ["editor","spellcheck","拼写检查","系统字典"],
  ["editor","htmlPaste","HTML 粘贴转换","粘贴 图片"],
  ["editor","inlineWidgets","就地预览","图片 公式"],
  ["editor","previewFontSize","预览字号","字体大小"],
  ["editor","previewFontFamily","预览字体","阅读"],
  ["editor","previewWidth","预览宽度","最大宽度"],
  ["markdown","rawHtml","原始 HTML","过滤 脚本"],
  ["markdown","remoteImages","远程图片","手动加载"],
  ["plugins","safeMode","安全模式","停止插件"],
  ["desktop","tray","托盘图标","系统托盘"],
  ["desktop","minimizeToTray","关闭窗口时最小化到托盘","隐藏窗口"],
  ["desktop","globalShortcut","全局快捷键","唤起"],
  ["desktop","updateUrl","更新服务","版本检查"],
  ["advanced","indexMaxMb","搜索缓存上限","大目录 索引"],
  ["advanced","bufferLimit","文档缓存数量","内存"],
  ["advanced","customCss","自定义 CSS","样式"],
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
  ["markdown", "markdownExtensions", "Markdown 扩展", "脚注 高亮 上标 下标 定义列表 缩写 插入 多行表格 自动目录 ABC 乐谱 Fountain 剧本"],
  ["keymap", "shortcuts", "键盘快捷键", "自定义 按键 冲突 重置"],
  ["plugins", "plugins", "插件", "安装 启用 配置"],
] as const;

export function nextEditorLayout(mode: Settings["mode"], sequence: Settings["layoutCycle"]): Settings["mode"] {
  const layouts = sequence.split("-") as Settings["mode"][];
  return layouts[(layouts.indexOf(mode) + 1) % layouts.length];
}
export function noteSortFor(settings:Settings,workspace:string,folder:string,view="folder") {
  return settings.perFolderSort&&view==="folder"?settings.folderSorts[workspace]?.[folder]??{sort:settings.sort,reverseSort:settings.reverseSort}:{sort:settings.sort,reverseSort:settings.reverseSort};
}
export function noteSortPatch(settings:Settings,workspace:string,folder:string,view:string,patch:Partial<Pick<Settings,"sort"|"reverseSort">>):Partial<Settings> {
  if(!settings.perFolderSort||view!=="folder")return patch;
  return {folderSorts:{...settings.folderSorts,[workspace]:{...settings.folderSorts[workspace],[folder]:{...noteSortFor(settings,workspace,folder,view),...patch}}}};
}
