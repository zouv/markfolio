import DOMPurify from "dompurify";
import katexCss from "katex/dist/katex.min.css?raw";
import highlightCss from "highlight.js/styles/github.css?raw";
import fountainCss from "./fountain.css?raw";
import * as api from "./api";
import { createRenderer, prepareMarkdown } from "./markdown";
import { resolveLink, relativeLink, type Settings } from "./types";

type ExportFiles = Pick<typeof api, "readAsset" | "resolveNoteLink">;
let fonts: Promise<string> | undefined;

async function embeddedMathStyles(): Promise<string> {
  if (!fonts) fonts = (async () => {
    let result = katexCss;
    for (const match of [...katexCss.matchAll(/src:(url\(fonts\/([^()]+\.woff2)\)[^;}]*)(?=[;}])/g)]) {
      const response = await fetch(`/export-fonts/katex/${encodeURIComponent(match[2])}`);
      if (!response.ok) throw new Error("无法读取公式字体");
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      result = result.replace(match[0], `src:url(data:font/woff2;base64,${btoa(binary)}) format("woff2")`);
    }
    return result;
  })().catch(error => { fonts = undefined; throw error; });
  return fonts;
}

/** A standalone local export, with no scripts or remote resource downloads. */
export async function exportHtml(workspace: string, path: string, text: string, exported: string[] = [], format: "html" | "pdf" = "html", files: ExportFiles = api, settings?:Pick<Settings,"math"|"rawHtml"|"markdownExtensions"|"diagrams">): Promise<string> {
  const template = document.createElement("template");
  template.innerHTML = DOMPurify.sanitize(createRenderer(settings?.math??true, { rawHtml: settings?.rawHtml??true,extensions:settings?.markdownExtensions }).render(prepareMarkdown(text)), {
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "base"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|markfolio-wiki):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  });
  async function target(href: string) {
    if (href.startsWith("markfolio-wiki:")) {
      try { return await files.resolveNoteLink(workspace, path, decodeURIComponent(href.slice(15)), true); } catch { return undefined; }
    }
    const resolved = resolveLink(path, href);
    return resolved ? { path: resolved, fragment: href.includes("#") ? href.slice(href.indexOf("#") + 1) : "" } : undefined;
  }
  for (const media of template.content.querySelectorAll<HTMLElement>("img,audio,video,source")) {
    const original = media.getAttribute("data-local-src") ?? media.getAttribute("src") ?? "";
    media.removeAttribute("src"); media.removeAttribute("srcset");
    if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(original)) { media.setAttribute("src", original); continue; }
    const asset = await target(original);
    if (asset) {
      try { media.setAttribute("src", await files.readAsset(workspace, asset.path)); } catch { media.setAttribute("alt", `附件未找到：${original}`); }
    }
  }
  for (const link of template.content.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href") ?? "", resolved = await target(href);
    if (!resolved) { if (href.startsWith("markfolio-wiki:")) link.removeAttribute("href"); continue; }
    if (exported.includes(resolved.path)) {
      const extension = format === "pdf" ? ".pdf" : ".html";
      link.setAttribute("href", relativeLink(path.replace(/\.[^.]+$/, extension), resolved.path.replace(/\.[^.]+$/, extension)) + (resolved.fragment ? "#" + resolved.fragment : ""));
    } else {
      if(/\.(md|markdown|mflock)$/i.test(resolved.path)){link.removeAttribute("href");link.setAttribute("title",`未导出：${resolved.path}`);continue;}
      try { const asset = await files.readAsset(workspace, resolved.path); link.setAttribute("href", asset); link.setAttribute("download", resolved.path.split("/").pop() ?? "attachment"); }
      catch { link.removeAttribute("href"); link.setAttribute("title", `未导出：${resolved.path}`); }
    }
  }
  for (const input of template.content.querySelectorAll("input")) input.setAttribute("disabled", "");
  for (const code of settings?.diagrams===false?[]:template.content.querySelectorAll<HTMLElement>("code.language-mermaid")) {
    try {
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default", htmlLabels: false });
      const { svg } = await mermaid.render(`export-${crypto.randomUUID()}`, code.textContent ?? "");
      if (code.parentElement) code.parentElement.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
    } catch { /* Keep invalid diagrams as source. */ }
  }
  for (const code of settings?.markdownExtensions.abc===false?[]:template.content.querySelectorAll<HTMLElement>("code.language-abc")) {
    try { const { default: abc } = await import("abcjs"); const node = document.createElement("div"); abc.renderAbc(node, code.textContent ?? ""); if (code.parentElement) code.parentElement.innerHTML = DOMPurify.sanitize(node.innerHTML, { USE_PROFILES: { svg: true, svgFilters: true } }); }
    catch { /* Keep invalid music notation as source. */ }
  }
  for (const code of settings?.markdownExtensions.fountain===false?[]:template.content.querySelectorAll<HTMLElement>("code.language-fountain")) {
    try { const {renderFountain}=await import("./fountain");if(code.parentElement)code.parentElement.innerHTML=DOMPurify.sanitize(renderFountain(code.textContent??"")); }
    catch { /* Keep invalid scripts as source. */ }
  }
  const mathStyles = template.content.querySelector(".katex") ? await embeddedMathStyles() : "";
  const title = path.replace(/[<>&"]/g, "");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:"><title>${title}</title><style>${mathStyles}${highlightCss}${fountainCss}body{font:16px/1.7 sans-serif;max-width:900px;margin:40px auto;padding:20px;color:#222}pre{white-space:pre-wrap;background:#f5f5f5;padding:16px}img,svg,video{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px 12px}blockquote{border-left:3px solid #ccc;padding-left:16px}@media print{body{margin:0;max-width:none}pre,table,img{break-inside:avoid}a{color:inherit}}</style></head><body>${template.innerHTML}</body></html>`;
}
