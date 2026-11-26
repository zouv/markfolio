import { t } from "./i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRenderer, prepareMarkdown, toggleTask } from "./markdown";
import DOMPurify from "dompurify";
import { readAsset, openLocalFile, openExternalLink, loadRemoteImage } from "./api";
import { resolveLink, displayError } from "./types";
import { useApp } from "./store";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";
import "./fountain.css";
import { processPluginBlocks } from "./plugins/runtime";

export default function Preview({
  workspace,
  path,
  text,
  math,
  diagrams,
}: {
  workspace: string;
  path: string;
  text: string;
  math: boolean;
  diagrams: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [external, setExternal] = useState<URL>();
  const [linkError, setLinkError] = useState("");
  const [remoteAllowed,setRemoteAllowed] = useState(false);
  useEffect(()=>setRemoteAllowed(false),[workspace,path]);
  const settings = useApp(state => state.settings);
  async function allowLink() {
    if (!external) return;
    try {
      const state = useApp.getState();
      state.updateSettings({
        externalLinkHosts: [
          ...new Set([...state.settings.externalLinkHosts, external.hostname]),
        ],
      });
      await state.persistSettings();
      await openExternalLink(external.href);
      setExternal(undefined);
    } catch (error) {
      setLinkError(displayError(error));
    }
  }
  const renderer = useMemo(() => {
    return createRenderer(math, { rawHtml: settings.rawHtml,extensions:settings.markdownExtensions });
  }, [math, settings.rawHtml,settings.markdownExtensions]);
  const html = useMemo(() => {
    const content = prepareMarkdown(text);
    const sanitized = DOMPurify.sanitize(renderer.render(content), { FORBID_TAGS: ["style", "iframe", "object", "embed", "form"], ADD_URI_SAFE_ATTR: ["data-local-src"], ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|markfolio-wiki):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i });
    const template = document.createElement("template"); template.innerHTML = sanitized;
    for(const image of template.content.querySelectorAll("img")) { if(image.hasAttribute("src")) image.dataset.localSrc = image.getAttribute("src") ?? ""; image.removeAttribute("src"); image.removeAttribute("srcset"); }
    return template.innerHTML;
  }, [renderer, text]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let cancelled = false;
    const dispose: (() => void)[] = [];
    for (const image of element.querySelectorAll("img")) {
      const original = image.getAttribute("data-local-src") ?? "";
      const resolved = resolveLink(path, original);
      if (original.startsWith("markfolio-wiki:")) {
        void import("./api").then(api => api.resolveNoteLink(workspace,path,decodeURIComponent(original.slice(15)),true)).then(link => readAsset(workspace,link.path)).then(url => { if(!cancelled)image.src=url; }).catch(()=>{image.alt=t("附件不存在");});
      } else if (resolved)
        void readAsset(workspace, resolved)
          .then((url) => {
            if (!cancelled) image.src = url;
          })
          .catch(() => {
            image.alt = t("无法预览：{0}", original);
          });
      else if(remoteAllowed && original.startsWith("https://")) {
        void loadRemoteImage(original).then(url=>{if(!cancelled)image.src=url;}).catch(e=>{if(!cancelled)image.alt=displayError(e);});
      } else
        image.alt = /^https?:/.test(original)
          ? t("远程图片未加载")
          : t("无法解析图片路径");
    }
    if (diagrams)
      for (const code of element.querySelectorAll<HTMLElement>(
        "code.language-mermaid",
      )) {
        void import("mermaid")
          .then(async ({ default: mermaid }) => {
            mermaid.initialize({
              startOnLoad: false,
              securityLevel: "strict",
              htmlLabels: false,
              theme:
                useApp.getState().settings.theme === "dark"
                  ? "dark"
                  : "default",
            });
            const { svg } = await mermaid.render(
              `diagram-${crypto.randomUUID()}`,
              code.textContent ?? "",
            );
            if (!cancelled && code.parentElement)
              code.parentElement.innerHTML = DOMPurify.sanitize(svg, {
                USE_PROFILES: { svg: true, svgFilters: true },
              });
          })
          .catch(() => {
            if (!cancelled) code.dataset.error = t("图表语法无效");
          });
      }
    void processPluginBlocks(workspace, element, path).then((items) => {
      if (cancelled) items.forEach((dispose) => dispose());
      else dispose.push(...items);
    });
    for(const code of settings.markdownExtensions.abc?element.querySelectorAll<HTMLElement>("code.language-abc"):[]) void import("abcjs").then(({default:abc})=>{if(cancelled||!code.parentElement)return;abc.renderAbc(code.parentElement,code.textContent??"");}).catch(()=>{code.dataset.error=t("乐谱语法无效");});
    for(const code of settings.markdownExtensions.fountain?element.querySelectorAll<HTMLElement>("code.language-fountain"):[]) void import("./fountain").then(({renderFountain})=>{if(!cancelled&&code.parentElement)code.parentElement.innerHTML=DOMPurify.sanitize(renderFountain(code.textContent??""));}).catch(()=>{if(!cancelled)code.dataset.error=t("剧本语法无效");});
    return () => {
      cancelled = true;
      dispose.forEach((dispose) => dispose());
    };
  }, [html, workspace, path, diagrams,remoteAllowed,settings.markdownExtensions]);
  const fragment=useApp(state=>state.sessions[workspace]?.fragment);
  useEffect(()=>{if(!fragment)return;requestAnimationFrame(()=>{const target=container.current?.querySelector(`[id="${CSS.escape(fragment)}"]`);target?.scrollIntoView({block:"start"});});},[fragment,html]);
  return (
    <>
      {settings.remoteImages&&!remoteAllowed&&/data-local-src="https:/.test(html)&&<button className="secondary remote-images-button" onClick={()=>{if(window.confirm(t("远程图片会联系图片所在网站。本次允许加载？")))setRemoteAllowed(true);}}>{t("加载远程图片")}</button>}
      <div
        className="markdown-preview"
        tabIndex={0}
        style={{ fontSize: settings.previewFontSize, fontFamily: settings.previewFontFamily, maxWidth: settings.mode === "preview" ? undefined : settings.previewWidth || undefined }}
        ref={container}
        onClick={(event) => {
          const task = (event.target as HTMLElement).closest<HTMLInputElement>(
            "input[data-task-line]",
          );
          if (task) {
            if (useApp.getState().sessions[workspace]?.mutating) {
              task.checked = !task.checked;
              return;
            }
            const buffer =
              useApp.getState().sessions[workspace]?.documents[path];
            if (buffer)
              useApp
                .getState()
                .edit(
                  workspace,
                  path,
                  toggleTask(
                    buffer.text,
                    Number(task.dataset.taskLine),
                    task.checked,
                  ),
                );
            return;
          }
          const link = (event.target as HTMLElement).closest("a");
          if (!link) return;
          event.preventDefault();
          const href = link.getAttribute("href") ?? "";
          if(href.startsWith("markfolio-wiki:")) { void useApp.getState().openLink(workspace,path,decodeURIComponent(href.slice(15)),true).catch(e=>useApp.getState().setNotice(displayError(e)));return; }
          if (href.startsWith("#")) {
            const target = container.current?.querySelector(
              `[id="${CSS.escape(href.slice(1))}"]`,
            );
            target?.scrollIntoView();
            return;
          }
          const resolved = resolveLink(path, href);
          if(resolved&&/\.(pdf|png|jpe?g|gif|webp|svg|mp3|wav|ogg|m4a|mp4|webm)$/i.test(resolved)){window.dispatchEvent(new CustomEvent("markfolio-media",{detail:{workspace,path:resolved}}));return;}
          if (resolved)
            void (
              /\.(md|markdown|txt)$/i.test(resolved)
                ? useApp.getState().openLink(workspace, path, href)
                : openLocalFile(workspace, resolved)
            ).catch((error) =>
              useApp
                .getState()
                .setNotice(String(error?.message ?? t("链接文件不存在"))),
            );
          else {
            try {
              const url = new URL(href);
              if (url.protocol !== "https:" || url.username || url.password)
                throw new Error(t("外部链接需要使用 HTTPS"));
              if (
                useApp
                  .getState()
                  .settings.externalLinkHosts.includes(url.hostname)
              )
                void openExternalLink(url.href).catch((error) =>
                  useApp.getState().setNotice(displayError(error)),
                );
              else {
                setExternal(url);
                setLinkError("");
              }
            } catch (error) {
              useApp.getState().setNotice(displayError(error));
            }
          }
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {external && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={t("打开外部链接")}
          >
            <h2>{t("打开外部链接")}</h2>
            <p>
              {t("在默认浏览器打开")}<strong>{external.hostname}</strong>
              {t("？允许后，今后将直接打开这个网站的链接。")}</p>
            <p className="muted" style={{ overflowWrap: "anywhere" }}>
              {external.href}
            </p>
            {linkError && <p className="form-error">{linkError}</p>}
            <div className="modal-actions">
              <button
                className="secondary"
                onClick={() => setExternal(undefined)}
              >
                {t("取消")}</button>
              <button className="primary" onClick={() => void allowLink()}>
                {t("允许并打开")}</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
