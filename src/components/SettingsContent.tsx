import { Plus, BookOpen } from "lucide-react";
import * as api from "../api";
import { useApp } from "../store";
import { displayError, type Settings } from "../types";
import { coreCommands } from "../commands";
import PluginManager from "./PluginManager";
import { effectiveShortcut, shortcutFromEvent } from "../shortcuts";
import {
  useRegistry,
  definitions,
  builtinPlugins,
  importPlugin,
} from "../plugins/runtime";
export default function SettingsContent({
  tab,
  settings,
  update,
}: {
  tab: string;
  settings: Settings;
  update(patch: Partial<Settings>): void;
}) {
  const state = useApp();
  const registry = useRegistry();
  const toggle = (key: keyof Settings, label: string, description: string) => (
    <label className="setting-row" data-setting={key}>
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <input
        className="toggle"
        type="checkbox"
        checked={Boolean(settings[key])}
        onChange={(event) => update({ [key]: event.target.checked })}
      />
    </label>
  );
  const select = (
    key: keyof Settings,
    label: string,
    options: [string, string][],
  ) => (
    <label className="setting-row" data-setting={key}>
      <strong>{label}</strong>
      <select
        value={String(settings[key])}
        onChange={(event) => update({ [key]: event.target.value })}
      >
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  const number = (
    key: keyof Settings,
    label: string,
    min: number,
    max: number,
    step: number,
  ) => (
    <label className="setting-row" data-setting={key}>
      <strong>{label}</strong>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(settings[key])}
        onChange={(event) =>
          update({
            [key]: Math.max(min, Math.min(max, Number(event.target.value))),
          })
        }
      />
    </label>
  );
  async function install() {
    try {
      const bundle = await api.installPlugin();
      if (!bundle) return;
      await importPlugin(bundle);
      useApp.setState((s) => ({
        plugins: [
          ...s.plugins.filter(
            (plugin) => plugin.manifest.id !== bundle.manifest.id,
          ),
          bundle,
        ],
      }));
      state.setNotice("插件已安装，请在当前工作目录启用");
    } catch (error) {
      state.setNotice(displayError(error));
    }
  }
  return (
    <>
      {tab==="plugins"&&<PluginManager settings={settings} update={update}/>}
      <h2>
        {
          (
            {
              general: "常规",
              appearance: "外观",
              editor: "编辑器",
              markdown: "Markdown",
              keymap: "键盘快捷键",
              plugins: "插件",
              about: "关于 MarkFolio",
            } as Record<string, string>
          )[tab]
        }
      </h2>
      {tab === "general" && (
        <>
          <p className="settings-intro">
            修改先保留在此窗口，点击“应用”或“确定”后保存。
          </p>
          {toggle(
            "autoSave",
            "自动保存",
            "停止输入后保存；外部修改冲突时暂停保存。",
          )}
          {number("autoSaveDelay", "自动保存延迟（毫秒）", 500, 10000, 100)}
          {toggle(
            "showHidden",
            "显示隐藏文件",
            "在文件树中显示点号开头的文件与目录。",
          )}
          <label className="setting-row">
            <div>
              <strong>重建搜索索引</strong>
              <p>重新扫描当前工作目录中的 Markdown 文档。</p>
            </div>
            <button
              className="secondary"
              disabled={!state.active}
              onClick={() => void state.reindex(state.active, true)}
            >
              重建
            </button>
          </label>
        </>
      )}
      {tab === "appearance" && (
        <>
          {select("theme", "主题", [
            ["light", "浅色"],
            ["dark", "深色"],
            ["system", "跟随系统"],
          ])}
          {toggle("showSidebar", "显示文件树", "左侧目录与文件导航。")}
          {toggle("showList", "显示文档列表", "当前目录列表和搜索结果。")}
          <button
            className="secondary"
            onClick={() =>
              update({
                sidebarWidth: 246,
                listWidth: 276,
                showSidebar: true,
                showList: true,
                mode: "split",
              })
            }
          >
            重置布局
          </button>
        </>
      )}
      {tab === "editor" && (
        <>
          {number("fontSize", "字体大小", 11, 30, 1)}
          {number("lineHeight", "行高", 1.2, 2.5, 0.05)}
          <label className="setting-row" data-setting="fontFamily">
            <strong>编辑器字体</strong>
            <input
              value={settings.fontFamily}
              onChange={(event) => update({ fontFamily: event.target.value })}
            />
          </label>
          {toggle(
            "wordWrap",
            "自动换行",
            "长行按编辑器宽度显示，不修改原始文件。",
          )}
          {toggle("lineNumbers", "显示行号", "在编辑区域显示行号。")}
          {select("mode", "编辑布局", [
            ["split", "编辑与预览"],
            ["editor", "仅编辑"],
            ["preview", "仅预览"],
          ])}
        </>
      )}
      {tab === "markdown" && (
        <>
          {toggle(
            "math",
            "数学公式",
            "使用 KaTeX 渲染 $ 行内公式和 $$ 公式块。",
          )}
          {toggle(
            "diagrams",
            "Mermaid 图表",
            "渲染 mermaid 代码块，资源随应用提供。",
          )}
          <p className="settings-intro">
            支持表格、任务列表、代码高亮、脚注与内部链接。原始 Markdown
            是文档来源。
          </p>
        </>
      )}
      {tab === "keymap" && (
        <>
          <p className="settings-intro">
            点击输入框后按组合键，或手动填写如
            Ctrl+Shift+K。清空可取消绑定。Ctrl+Tab 切换工作目录。
          </p>
          <div className="keymap" data-setting="shortcuts">
            {[
              ...coreCommands.map(([id, name, shortcut]) => ({
                id,
                name,
                shortcut,
              })),
              ...registry.commands.filter(
                (command) =>
                  command.plugin && command.workspace === state.active,
              ),
            ].map((command) => (
              <div key={command.id}>
                <span>{command.name}</span>
                <input
                  aria-label={`${command.name}快捷键`}
                  placeholder="未绑定"
                  value={effectiveShortcut(command, settings.shortcuts)}
                  onChange={(event) =>
                    update({
                      shortcuts: {
                        ...settings.shortcuts,
                        [command.id]: event.target.value,
                      },
                    })
                  }
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Backspace" || event.key === "Delete") {
                      event.preventDefault();
                      update({
                        shortcuts: { ...settings.shortcuts, [command.id]: "" },
                      });
                      return;
                    }
                    const shortcut = shortcutFromEvent(event);
                    if (shortcut) {
                      event.preventDefault();
                      update({
                        shortcuts: {
                          ...settings.shortcuts,
                          [command.id]: shortcut,
                        },
                      });
                    }
                  }}
                />
                <button
                  className="secondary"
                  onClick={() => {
                    const shortcuts = { ...settings.shortcuts };
                    delete shortcuts[command.id];
                    update({ shortcuts });
                  }}
                >
                  重置
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === "plugins" && (
        <>
          <div className="plugin-intro">
            <p className="settings-intro">
              插件按工作目录启用。仅安装你审查过源码的可信插件。
              安装立即执行；启停与配置修改需要应用后生效。
            </p>
            <button
              className="secondary"
              disabled={!api.isTauriRuntime()}
              onClick={() => void install()}
            >
              <Plus size={15} />
              安装本地插件
            </button>
          </div>
          {!state.active && <p>先打开工作目录，再配置插件。</p>}
          {definitions().map((definition) => {
            const id = definition.manifest.id;
            const configured = settings.plugins[state.active]?.[id];
            const enabled =
              configured?.enabled ?? builtinPlugins.includes(definition);
            const fields = registry.fields[`${state.active}:${id}`] ?? [];
            const configure = (patch: { enabled?: boolean; data?: unknown }) =>
              update({
                plugins: {
                  ...settings.plugins,
                  [state.active]: {
                    ...settings.plugins[state.active],
                    [id]: { enabled, data: configured?.data ?? {}, ...patch },
                  },
                },
              });
            return (
              <section className="plugin-card" key={id}>
                <label>
                  <div>
                    <strong>{definition.manifest.name}</strong>
                    <span>v{definition.manifest.version}</span>
                    <p>{definition.manifest.description}</p>
                  </div>
                  <input
                    className="toggle"
                    type="checkbox"
                    disabled={!state.active}
                    checked={enabled}
                    onChange={(event) =>
                      configure({ enabled: event.target.checked })
                    }
                  />
                </label>
                {registry.errors[`${state.active}:${id}`] && (
                  <p className="form-error">
                    {registry.errors[`${state.active}:${id}`]}
                  </p>
                )}
                {enabled &&
                  fields.map((field) => {
                    const data = (configured?.data ?? {}) as Record<
                      string,
                      unknown
                    >;
                    return (
                      <label className="plugin-setting" key={field.key}>
                        <span>{field.label}</span>
                        <input
                          type={
                            field.type === "toggle" ? "checkbox" : field.type
                          }
                          value={
                            field.type === "toggle"
                              ? undefined
                              : String(
                                  data[field.key] ?? field.defaultValue ?? "",
                                )
                          }
                          checked={
                            field.type === "toggle"
                              ? Boolean(data[field.key] ?? field.defaultValue)
                              : undefined
                          }
                          onChange={(event) =>
                            configure({
                              data: {
                                ...data,
                                [field.key]:
                                  field.type === "toggle"
                                    ? event.target.checked
                                    : field.type === "number"
                                      ? Number(event.target.value)
                                      : event.target.value,
                              },
                            })
                          }
                        />
                      </label>
                    );
                  })}
              </section>
            );
          })}
        </>
      )}
      {tab === "about" && (
        <>
          <div className="about-icon">
            <BookOpen size={34} />
          </div>
          <h3>MarkFolio {state.version}</h3>
          <p>以本地 Markdown 文件为中心的文档工作台。</p>
          <p className="muted">
            Tauri + Rust + React
            <br />
            工作目录页签 · 实际文件结构 · 插件扩展
          </p>
          <p className="muted">
            界面交互参考 Joplin，文件与插件概念参考
            Obsidian。独立实现，未捆绑两者应用源码。
          </p>
        </>
      )}
    </>
  );
}
