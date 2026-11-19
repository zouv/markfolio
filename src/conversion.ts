import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import DOMPurify from "dompurify";

const service = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
service.use(gfm);
service.addRule("highlight", { filter: ["mark"], replacement: text => `==${text}==` });
service.addRule("subscript", { filter: ["sub"], replacement: text => `~${text}~` });
service.addRule("superscript", { filter: ["sup"], replacement: text => `^${text}^` });
service.addRule("math", { filter: node => node instanceof HTMLElement && node.hasAttribute("data-math-source"), replacement: (_text, node) => `$${(node as HTMLElement).dataset.mathSource}$` });
service.addRule("localImage", { filter: node => node.nodeName === "IMG" && (node as HTMLElement).hasAttribute("data-local-src"), replacement: (_text, node) => `![${(node as HTMLElement).getAttribute("alt") ?? ""}](${(node as HTMLElement).getAttribute("data-local-src")})` });
export function htmlToMarkdown(html: string): string {
  return service.turndown(DOMPurify.sanitize(html, { ADD_ATTR: ["data-local-src", "data-math-source"] }));
}
export async function fileAsBase64(file: Blob): Promise<string> {
  if (file.size > 32 * 1024 * 1024) throw new Error("粘贴附件超过 32 MB");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("无法读取剪贴板图片"));
    reader.readAsDataURL(file);
  });
}
