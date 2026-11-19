import { t } from "../i18n";
import { useState } from "react";
import { Search, X } from "lucide-react";
import { useApp } from "../store";
import type { Settings } from "../types";
import { displayError } from "../types";
import { settingsCatalog, settingsDraftPatch } from "../settings";
import { validateShortcuts } from "../shortcuts";
import { useRegistry } from "../plugins/runtime";
import SettingsContent from "./SettingsContent";

const tabs = [
  ["general", t("常规")],
  ["appearance", t("外观")],
  ["editor", t("编辑器")],
  ["markdown", "Markdown"],
  ["keymap", t("键盘快捷键")],
  ["plugins", t("插件")],
  ["desktop", t("桌面")],
  ["advanced", t("高级")],
  ["about", t("关于")],
];
export default function SettingsDialog({
  initialTab,
  close,
}: {
  initialTab: string;
  close(): void;
}) {
  const state = useApp();
  const registry = useRegistry();
  const [base, setBase] = useState(() => structuredClone(state.settings));
  const [draft, setDraft] = useState(() => structuredClone(state.settings));
  const [tab, setTab] = useState(initialTab);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const update = (patch: Partial<Settings>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError("");
  };
  const commands = registry.commands.filter(
    (command) => !command.workspace || command.workspace === state.active,
  );
  const keymapError = validateShortcuts(draft.shortcuts, commands);
  const dirty =
    Object.keys(settingsDraftPatch(state.settings, base, draft)).length > 0;
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = settingsCatalog.filter((item) =>
    tokens.every((token) => item.map(part=>t(part)).join(" ").toLowerCase().includes(token)),
  );
  async function apply(leave: boolean) {
    if (busy) return;
    if (![ [draft.zoom,50,200], [draft.indexMaxMb,64,4096], [draft.bufferLimit,4,128], [draft.previewFontSize,10,48], [draft.previewWidth,0,3000] ].every(([value,min,max]) => Number.isFinite(value) && value >= min && value <= max)) {setError(t("字号、缩放、预览宽度或缓存上限超出允许范围"));return;}
    if (keymapError) {
      setError(keymapError);
      return;
    }
    setBusy(true);
    try {
      await useApp.getState().applySettings(base, draft);
      const saved = structuredClone(useApp.getState().settings);
      setBase(saved);
      setDraft(saved);
      if (leave) close();
    } catch (error) {
      setError(displayError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="modal settings-modal"
      role="dialog"
      aria-modal="true"
      aria-label={t("设置")}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          if (!busy) close();
        }
      }}
    >
      <button
        className="modal-close"
        aria-label={t("取消设置")}
        disabled={busy}
        onClick={close}
      >
        <X size={18} />
      </button>
      <aside className="settings-sidebar">
        <h2>{t("设置")}</h2>
        <label className="settings-search">
          <Search size={14} />
          <input
            aria-label={t("搜索设置")}
            placeholder={t("搜索设置…")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {tabs
          .filter(
            ([id]) => !tokens.length || results.some((item) => item[0] === id),
          )
          .map(([id, label]) => (
            <button
              key={id}
              className={tab === id && !tokens.length ? "selected" : ""}
              onClick={() => {
                setTab(id);
                setQuery("");
              }}
            >
              {t(label)}
            </button>
          ))}
      </aside>
      <div className="settings-body">
        <div className="settings-content">
          {tokens.length ? (
            <>
              <h2>{t("搜索结果")}</h2>
              {results.length ? (
                results.map(([section, key, label, description]) => (
                  <button
                    className="settings-result"
                    key={key}
                    onClick={() => {
                      setTab(section);
                      setQuery("");
                      requestAnimationFrame(() =>
                        document
                          .querySelector(`[data-setting="${key}"]`)
                          ?.scrollIntoView({ block: "center" }),
                      );
                    }}
                  >
                    <strong>{t(label)}</strong>
                    <span>{t(description)}</span>
                  </button>
                ))
              ) : (
                <p>{t("没有匹配的设置")}</p>
              )}
            </>
          ) : (
            <fieldset disabled={busy} className="settings-fields">
              <SettingsContent tab={tab} settings={draft} update={update} />
            </fieldset>
          )}
        </div>
        <div className="settings-bottom">
          <div>
            <span>{dirty ? t("有未应用的修改") : t("设置已保存")}</span>
            {(error || keymapError) && (
              <p className="form-error" role="alert">
                {error || keymapError}
              </p>
            )}
          </div>
          <div className="settings-actions">
            <button className="secondary" disabled={busy} onClick={close}>
              {t("取消")}</button>
            <button
              className="secondary"
              disabled={busy || !dirty || !!keymapError}
              onClick={() => void apply(false)}
            >
              {t("应用")}</button>
            <button
              className="primary"
              disabled={busy || !!keymapError}
              onClick={() => void apply(true)}
            >
              {busy ? t("保存中…") : t("确定")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
