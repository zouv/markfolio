import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { t } from "../i18n";
import { useApp } from "../store";

export default function AboutDialog({
  close,
  openNotices,
}: {
  close(): void;
  openNotices(): void;
}) {
  const version = useApp((state) => state.version);
  const ready = useApp((state) => state.ready);
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  const trapFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || !dialog.current) return;
    const items = [
      ...dialog.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="modal-backdrop about-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        ref={dialog}
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        aria-describedby="about-description about-tech"
        onKeyDown={trapFocus}
      >
        <header className="about-header">
          <h3 id="about-title">{t("关于 MarkFolio")}</h3>
          <button
            className="about-close"
            aria-label={t("关闭")}
            title={t("关闭 (Esc)")}
            onClick={close}
          >
            <X size={17} />
          </button>
        </header>
        <div className="about-body">
          <div className="about-identity">
            <img className="about-app-icon" src="/markfolio-icon.png" alt="" draggable={false} />
            <div className="about-info">
              <h4>MarkFolio</h4>
              <p className="about-meta">
                {t("版本")}{" "}<span aria-live="polite">{version || (ready ? t("不可用") : t("加载中…"))}</span>
                <span className="about-meta-separator">·</span>
                {t("作者")} @zouv
              </p>
              <p id="about-description" className="about-description">
                {t("本地 Markdown 文档管理工具，直接编辑工作目录中的原文件。")}
              </p>
              <p id="about-tech" className="about-tech">
                {t("基于 Tauri 2、Rust 与 React 构建。")}
              </p>
              <button className="about-link" onClick={openNotices}>
                {t("第三方许可证与资源")}
              </button>
            </div>
          </div>
        </div>
        <footer className="about-footer">
          <button ref={closeButton} className="primary" onClick={close}>
            {t("关闭")}
          </button>
        </footer>
      </section>
    </div>
  );
}
