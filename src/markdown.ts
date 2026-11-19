import { t } from "./i18n";
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import footnotes from "markdown-it-footnote";
import texmath from "markdown-it-texmath";
import katex from "katex";
import hljs from "highlight.js";
import mark from "markdown-it-mark";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";
import deflist from "markdown-it-deflist";
import abbr from "markdown-it-abbr";
import ins from "markdown-it-ins";
import multimd from "markdown-it-multimd-table";
import { splitFrontMatter } from "./metadata";
import type { MarkdownExtensions } from "./types";

export function prepareMarkdown(text: string): string {
  const front=splitFrontMatter(text);const source=front.header?"\n".repeat(front.header.split("\n").length-1)+front.body:text;
  const starts=[0];for(let i=0;i<source.length;i++)if(source[i]==="\n")starts.push(i+1);
  const protectedRanges=new MarkdownIt({html:true}).parse(source,{}).filter(token=>["fence","code_block"].includes(token.type)&&token.map).map(token=>({from:starts[token.map![0]]??source.length,to:starts[token.map![1]]??source.length}));
  function rewrite(value:string){return value.replace(/(`+)([\s\S]*?)\1(?!`)|(?<!\\)\[\[([^\]\n]+)\]\]/g, (all,_ticks,_code,value:string|undefined) => {
      if(value===undefined)return all;
      const [target, label] = value.split("|");
      if (target.toLowerCase() === "toc") return "[toc]";
      return `[${label ?? target}](markfolio-wiki:${encodeURIComponent(target)})`;
    });}
  let cursor=0,result="";for(const range of protectedRanges){result+=rewrite(source.slice(cursor,range.from))+source.slice(range.from,range.to);cursor=range.to;}return result+rewrite(source.slice(cursor));
}
export function headingSlug(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s+/g, "-") || "section"
  );
}
export function createRenderer(math = false, options: { rawHtml?: boolean; extended?: boolean; extensions?:Partial<MarkdownExtensions> } = {}) {
  const enabled=(key:keyof MarkdownExtensions)=>options.extensions?.[key]!==false;
  const md = new MarkdownIt({
    html: options.rawHtml ?? false,
    linkify: true,
    breaks: false,
    highlight(code, language) {
      return language && hljs.getLanguage(language)
        ? hljs.highlight(code, { language }).value
        : "";
    },
  }).use(taskLists, { enabled: true });
  if(enabled("footnotes"))md.use(footnotes);
  if (options.extended !== false) {
    Object.assign(md.utils, { assign: Object.assign });
    if(enabled("mark"))md.use(mark);if(enabled("sub"))md.use(sub);if(enabled("sup"))md.use(sup);if(enabled("deflist"))md.use(deflist);if(enabled("abbr"))md.use(abbr);if(enabled("ins"))md.use(ins);if(enabled("multiTable"))md.use(multimd, { multiline: true, rowspan: true, headerless: true });
  }
  if (math)
    md.use(texmath, {
      engine: katex,
      delimiters: "dollars",
      katexOptions: { throwOnError: false, trust: false },
    });
  md.core.ruler.push("markfolio-attributes", (state) => {
    const ids = new Map<string, number>();
    state.tokens.forEach((token, index) => {
      if (token.type === "heading_open") {
        const inline = state.tokens[index + 1];
        const title = (inline.children ?? [])
          .filter((child) => ["text", "code_inline"].includes(child.type))
          .map((child) => child.content)
          .join("");
        const base = headingSlug(title);
        const count = ids.get(base) ?? 0;
        ids.set(base, count + 1);
        token.attrSet("id", count ? `${base}-${count}` : base);
      }
      if (token.type === "inline" && token.map)
        for (const child of token.children ?? []) {
          if (
            child.type === "html_inline" &&
            child.content.includes("task-list-item-checkbox")
          )
            child.content = child.content.replace(
              "<input ",
              `<input data-task-line="${token.map[0]}" `,
            );
        }
    });
    const toc = state.tokens.flatMap((token,index) => token.type === "heading_open" ? [`<li style="margin-left:${(Number(token.tag.slice(1))-1)*16}px"><a href="#${token.attrGet("id")}">${md.utils.escapeHtml(state.tokens[index+1].content)}</a></li>`] : []).join("");
    for (const token of state.tokens) if(enabled("toc")&&token.type === "inline" && /^\[toc\]$/i.test(token.content.trim())) {
      const child = new state.Token("html_inline", "", 0); child.content = t("<nav class=\"automatic-toc\" aria-label=\"文档目录\"><ul>{0}</ul></nav>", toc); token.children = [child];
    }
  });
  // Keep every image inert until the Rust file service resolves a local attachment.
  md.renderer.rules.image = (tokens, index, options, _env, renderer) => {
    const token = tokens[index];
    token.attrSet("data-local-src", token.attrGet("src") ?? "");
    const src = token.attrIndex("src");
    if (src >= 0) token.attrs?.splice(src, 1);
    token.attrSet(
      "alt",
      renderer.renderInlineAsText(token.children ?? [], options, {}),
    );
    return renderer.renderToken(tokens, index, options);
  };
  return md;
}
export function createTOC(text: string): string {
  const tokens = createRenderer().parse(prepareMarkdown(text), {});
  return tokens
    .flatMap((token, index) =>
      token.type === "heading_open"
        ? [
            `${"  ".repeat(Number(token.tag.slice(1)) - 1)}- [${tokens[index + 1].content}](#${token.attrGet("id")})`,
          ]
        : [],
    )
    .join("\n");
}
export function toggleTask(
  text: string,
  line: number,
  checked: boolean,
): string {
  const lines = text.split("\n");
  if (!Number.isInteger(line) || line < 0 || line >= lines.length) return text;
  lines[line] = lines[line].replace(
    /^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+)\[[ xX]\]/,
    `$1[${checked ? "x" : " "}]`,
  );
  return lines.join("\n");
}
