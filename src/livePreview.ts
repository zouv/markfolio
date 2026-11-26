import { t } from "./i18n";
import DOMPurify from "dompurify";
import katex from "katex";
import hljs from "highlight.js";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { createRenderer, prepareMarkdown } from "./markdown";
import { splitFrontMatter } from "./metadata";
import { resolveLink, type Settings } from "./types";
import { readAsset, resolveNoteLink } from "./api";

export type LivePreviewOptions = {
  workspace: string;
  path: string;
  mode: "markdown" | "rich";
  math: boolean;
  rawHtml: boolean;
  extensions: Settings["markdownExtensions"];
  inlineWidgets: boolean;
  readOnly: boolean;
};

type MathRange = { from: number; to: number; source: string };
type RangeState = { from: number; to: number } | null;

const revealBlockEffect = StateEffect.define<RangeState>();
const revealBlock = StateField.define<RangeState>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(revealBlockEffect)) value = effect.value;
    if (!value) return value;
    if (transaction.docChanged) return null;
    if (transaction.selection && !transaction.newSelection.ranges.some((range) => range.from <= value!.to && range.to >= value!.from)) return null;
    return value;
  },
});

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) if (text[index] === "\n") starts.push(index + 1);
  return starts;
}

/** Display math is not a CodeMirror markdown node, so find `$$` blocks outside code fences ourselves. */
export function mathRanges(text: string): MathRange[] {
  if (!text.includes("$$")) return [];
  const lines = text.split("\n");
  const starts = lineStarts(text);
  const front = splitFrontMatter(text);
  const frontEnd = front.header.length;
  const code: { from: number; to: number }[] = [];
  const tree = markdownLanguage.parser.parse(text);
  tree.iterate({
    enter(node) {
      if (["FencedCode", "CodeBlock", "Table", "HTMLBlock"].includes(node.name)) {
        code.push({ from: node.from, to: node.to });
        return false;
      }
      return undefined;
    },
  });
  const skip = (from: number, to: number) => from < frontEnd || code.some((range) => from < range.to && to > range.from);
  const ranges: MathRange[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed.startsWith("$$")) continue;
    const from = starts[index];
    if (skip(from, from + line.length)) continue;
    const single = /^\$\$([\s\S]+?)\$\$\s*$/.exec(trimmed);
    if (single) {
      ranges.push({ from, to: from + line.length, source: single[1] });
      continue;
    }
    if (!/^\$\$\s*$/.test(trimmed)) continue;
    let end = index + 1;
    while (end < lines.length && lines[end].trim() !== "$$") end++;
    if (end >= lines.length) continue;
    const to = starts[end] + lines[end].length;
    if (skip(from, to)) continue;
    ranges.push({ from, to, source: lines.slice(index + 1, end).join("\n") });
    index = end;
  }
  return ranges;
}

function intersects(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

export function imageRanges(text: string): { from: number; to: number; source: string; alt: string }[] {
  if (!text.includes("![")) return [];
  const front = splitFrontMatter(text);
  const frontEnd = front.header.length;
  const code: { from: number; to: number }[] = [];
  const tree = markdownLanguage.parser.parse(text);
  const ranges: { from: number; to: number; source: string; alt: string }[] = [];
  tree.iterate({
    enter(node) {
      if (["FencedCode", "CodeBlock", "Table", "HTMLBlock"].includes(node.name)) {
        code.push({ from: node.from, to: node.to });
        return false;
      }
      if (node.name !== "Image" || node.from < frontEnd) return undefined;
      if (code.some((range) => node.from >= range.from && node.to <= range.to)) return false;
      const source = text.slice(node.from, node.to);
      const match = /^!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)$/.exec(source);
      if (match) ranges.push({ from: node.from, to: node.to, source: match[2] ?? match[3] ?? "", alt: match[1] ?? "" });
      return false;
    },
  });
  return ranges;
}

/** GFM 会把表格后没有空行的普通段落并入 Table 节点；只替换真正的表格行。 */
function tableRange(state: EditorState, from: number, to: number) {
  const doc = state.doc;
  let end = doc.lineAt(from).to;
  for (let number = doc.lineAt(from).number + 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    if (line.from >= to) break;
    const text = line.text.trim();
    if (!text || !text.includes("|")) break;
    end = line.to;
  }
  return { from, to: end };
}

function revealSource(view: EditorView, from: number, to: number) {
  view.dispatch({
    selection: { anchor: from },
    effects: revealBlockEffect.of({ from, to }),
    scrollIntoView: true,
  });
  view.focus();
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest("input,button,a,select,textarea");
}

abstract class RevealWidget extends WidgetType {
  constructor(readonly from: number, readonly to: number) {
    super();
  }
  protected click(view: EditorView, element: HTMLElement) {
    element.addEventListener("mousedown", (event) => {
      if (isInteractiveTarget(event.target)) return;
      event.preventDefault();
      revealSource(view, this.from, this.to);
    });
  }
  ignoreEvent() {
    return true;
  }
}

class ImageWidget extends RevealWidget {
  private cancelled = false;
  constructor(
    private workspace: string,
    private path: string,
    private source: string,
    private alt: string,
    from: number,
    to: number,
  ) {
    super(from, to);
  }
  eq(other: ImageWidget) {
    return (
      other.workspace === this.workspace &&
      other.path === this.path &&
      other.source === this.source &&
      other.alt === this.alt &&
      other.from === this.from &&
      other.to === this.to
    );
  }
  toDOM(view: EditorView) {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-live-image";
    const image = document.createElement("img");
    image.alt = this.alt || t("本地图片");
    wrapper.append(image);
    void (async () => {
      let resolved = resolveLink(this.path, this.source);
      if (!resolved && this.source.startsWith("markfolio-wiki:")) {
        const link = await resolveNoteLink(this.workspace, this.path, decodeURIComponent(this.source.slice(15)), true);
        resolved = link.path;
      }
      if (!resolved) {
        image.alt = /^https?:/.test(this.source) ? t("远程图片未加载") : t("无法解析图片路径");
        return;
      }
      const url = await readAsset(this.workspace, resolved);
      if (!this.cancelled) {
        image.src = url;
        image.onload = () => view.requestMeasure();
      }
    })().catch(() => {
      image.alt = t("图片文件不存在");
    });
    this.click(view, wrapper);
    return wrapper;
  }
  destroy() {
    this.cancelled = true;
  }
}

class MathWidget extends RevealWidget {
  constructor(private source: string, from: number, to: number) {
    super(from, to);
  }
  eq(other: MathWidget) {
    return other.source === this.source && other.from === this.from && other.to === this.to;
  }
  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-live-math";
    wrapper.innerHTML = DOMPurify.sanitize(katex.renderToString(this.source, { throwOnError: false, trust: false, displayMode: true }));
    this.click(view, wrapper);
    return wrapper;
  }
}

class ListMarkerWidget extends WidgetType {
  constructor(private marker: string) {
    super();
  }
  eq(other: ListMarkerWidget) {
    return other.marker === this.marker;
  }
  toDOM() {
    const element = document.createElement("span");
    element.className = "cm-live-list-marker";
    element.textContent = this.marker;
    return element;
  }
  ignoreEvent() {
    return true;
  }
}

class TaskWidget extends WidgetType {
  constructor(
    private checked: boolean,
    private from: number,
    private to: number,
    private readOnly: boolean,
  ) {
    super();
  }
  eq(other: TaskWidget) {
    return other.checked === this.checked && other.from === this.from && other.to === this.to && other.readOnly === this.readOnly;
  }
  toDOM(view: EditorView) {
    const label = document.createElement("label");
    label.className = "cm-live-task";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.disabled = this.readOnly;
    input.setAttribute("aria-label", t("待办事项"));
    input.addEventListener("change", () => {
      if (this.readOnly) return;
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: input.checked ? "[x]" : "[ ]" },
        userEvent: "input",
      });
    });
    label.append(input);
    return label;
  }
  ignoreEvent() {
    return true;
  }
}

class RuleWidget extends RevealWidget {
  constructor(from: number, to: number) {
    super(from, to);
  }
  eq(other: RuleWidget) {
    return other.from === this.from && other.to === this.to;
  }
  toDOM(view: EditorView) {
    const element = document.createElement("hr");
    element.className = "cm-live-rule";
    this.click(view, element);
    return element;
  }
}

class CodeBlockWidget extends RevealWidget {
  constructor(
    private code: string,
    private language: string,
    private indented: boolean,
    from: number,
    to: number,
  ) {
    super(from, to);
  }
  eq(other: CodeBlockWidget) {
    return (
      other.code === this.code &&
      other.language === this.language &&
      other.indented === this.indented &&
      other.from === this.from &&
      other.to === this.to
    );
  }
  toDOM(view: EditorView) {
    const pre = document.createElement("pre");
    pre.className = "cm-live-codeblock";
    const code = document.createElement("code");
    if (this.language && hljs.getLanguage(this.language)) code.innerHTML = hljs.highlight(this.code, { language: this.language }).value;
    else code.textContent = this.code;
    pre.append(code);
    this.click(view, pre);
    return pre;
  }
}

class TableWidget extends RevealWidget {
  constructor(
    private source: string,
    private options: LivePreviewOptions,
    from: number,
    to: number,
  ) {
    super(from, to);
  }
  eq(other: TableWidget) {
    return other.source === this.source && other.from === this.from && other.to === this.to;
  }
  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-live-table";
    wrapper.innerHTML = tableHtml(this.source, this.options);
    this.click(view, wrapper);
    return wrapper;
  }
}

class FrontMatterWidget extends RevealWidget {
  constructor(
    private yaml: string,
    from: number,
    to: number,
  ) {
    super(from, to);
  }
  eq(other: FrontMatterWidget) {
    return other.yaml === this.yaml && other.from === this.from && other.to === this.to;
  }
  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-live-frontmatter";
    const title = document.createElement("div");
    title.className = "cm-live-frontmatter-title";
    title.textContent = t("文档属性");
    const pre = document.createElement("pre");
    pre.textContent = this.yaml;
    wrapper.append(title, pre);
    this.click(view, wrapper);
    return wrapper;
  }
}

class HtmlBlockWidget extends RevealWidget {
  constructor(
    private html: string,
    from: number,
    to: number,
  ) {
    super(from, to);
  }
  eq(other: HtmlBlockWidget) {
    return other.html === this.html && other.from === this.from && other.to === this.to;
  }
  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-live-html";
    wrapper.innerHTML = this.html;
    this.click(view, wrapper);
    return wrapper;
  }
}

function renderer(options: LivePreviewOptions) {
  return createRenderer(false, { rawHtml: options.rawHtml, extensions: options.extensions });
}

function tableHtml(source: string, options: LivePreviewOptions): string {
  return DOMPurify.sanitize(renderer(options).render(prepareMarkdown(source)), {
    FORBID_TAGS: ["style", "iframe", "object", "embed", "form"],
    ADD_URI_SAFE_ATTR: ["data-local-src"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|markfolio-wiki):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  });
}

function hideMarker(ranges: Range<Decoration>[], atomic: Range<Decoration>[], from: number, to: number, visible: boolean) {
  if (from >= to) return;
  if (visible) ranges.push(Decoration.mark({ class: "cm-live-marker" }).range(from, to));
  else {
    ranges.push(Decoration.replace({}).range(from, to));
    atomic.push(Decoration.replace({}).range(from, to));
  }
}

type Built = { decorations: DecorationSet; atomic: DecorationSet };

function buildDecorations(state: EditorState, options: LivePreviewOptions, math: MathRange[], front: ReturnType<typeof splitFrontMatter>): Built {
  const doc = state.doc;
  const ranges: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const activeLines = new Set<number>();
  if (options.mode === "markdown")
    for (const range of state.selection.ranges) {
      const first = doc.lineAt(range.from).number;
      const last = doc.lineAt(range.to).number;
      for (let line = first; line <= last; line++) activeLines.add(line);
    }
  const revealed = state.field(revealBlock, false);
  const isRevealed = (from: number, to: number) => !!revealed && from >= revealed.from && to <= revealed.to;
  const frontRange = front.header ? { from: 0, to: front.header.length } : null;
  const inSpecial = (from: number, to: number) =>
    (!!frontRange && from >= frontRange.from && to <= frontRange.to) || math.some((range) => from >= range.from && to <= range.to);
  const styleLines = (from: number, to: number, cls: string) => {
    const first = doc.lineAt(Math.max(0, Math.min(from, doc.length))).number;
    const last = doc.lineAt(Math.max(0, Math.min(Math.max(from, to - 1), doc.length))).number;
    for (let line = first; line <= last; line++) ranges.push(Decoration.line({ class: cls }).range(doc.line(line).from));
  };

  if (frontRange) {
    if (intersects(state, frontRange.from, frontRange.to) || isRevealed(frontRange.from, frontRange.to)) styleLines(frontRange.from, frontRange.to, "cm-live-frontmatter-source");
    else {
      ranges.push(Decoration.replace({ widget: new FrontMatterWidget(front.yaml, frontRange.from, frontRange.to), block: true }).range(frontRange.from, frontRange.to));
      atomic.push(Decoration.replace({}).range(frontRange.from, frontRange.to));
    }
  }

  if (options.math)
    for (const range of math) {
      if (intersects(state, range.from, range.to) || isRevealed(range.from, range.to)) styleLines(range.from, range.to, "cm-live-math-source");
      else {
        ranges.push(Decoration.replace({ widget: new MathWidget(range.source, range.from, range.to), block: true }).range(range.from, range.to));
        atomic.push(Decoration.replace({}).range(range.from, range.to));
      }
    }

  const tree = syntaxTree(state);
  const revealedBlocks: { from: number; to: number }[] = [];
  const tableRanges: { from: number; to: number }[] = [];
  tree.iterate({
    enter(node) {
      if (node.from > doc.length || node.to > doc.length) return;
      if (inSpecial(node.from, node.to)) return;
      if (tableRanges.some((range) => node.from >= range.from && node.to <= range.to)) return;
      const line = doc.lineAt(node.from).number;
      const active = activeLines.has(line);
      const blockReveal = intersects(state, node.from, node.to) || isRevealed(node.from, node.to);
      const reveal = active || isRevealed(node.from, node.to) || revealedBlocks.some((range) => node.from >= range.from && node.to <= range.to);
      const name = node.name;
      switch (name) {
          case "ATXHeading1":
          case "SetextHeading1":
            ranges.push(Decoration.line({ class: "cm-live-h1" }).range(doc.line(line).from));
            break;
          case "ATXHeading2":
          case "SetextHeading2":
            ranges.push(Decoration.line({ class: "cm-live-h2" }).range(doc.line(line).from));
            break;
          case "ATXHeading3":
            ranges.push(Decoration.line({ class: "cm-live-h3" }).range(doc.line(line).from));
            break;
          case "ATXHeading4":
            ranges.push(Decoration.line({ class: "cm-live-h4" }).range(doc.line(line).from));
            break;
          case "ATXHeading5":
            ranges.push(Decoration.line({ class: "cm-live-h5" }).range(doc.line(line).from));
            break;
          case "ATXHeading6":
            ranges.push(Decoration.line({ class: "cm-live-h6" }).range(doc.line(line).from));
            break;
          case "StrongEmphasis":
            ranges.push(Decoration.mark({ class: "cm-live-strong" }).range(node.from, node.to));
            break;
          case "Emphasis":
            ranges.push(Decoration.mark({ class: "cm-live-em" }).range(node.from, node.to));
            break;
          case "Strikethrough":
            ranges.push(Decoration.mark({ class: "cm-live-strike" }).range(node.from, node.to));
            break;
          case "InlineCode":
            ranges.push(Decoration.mark({ class: "cm-live-code" }).range(node.from, node.to));
            break;
          case "Link":
          case "Autolink":
            ranges.push(Decoration.mark({ class: "cm-live-link" }).range(node.from, node.to));
            break;
          case "Blockquote":
            styleLines(node.from, node.to, "cm-live-quote");
            break;
          case "ListItem":
            styleLines(node.from, node.to, "cm-live-li");
            break;
          case "HeaderMark": {
            hideMarker(ranges, atomic, node.from, node.to, reveal);
            if (!reveal) {
              let end = node.to;
              while (end < doc.length && /[ \t]/.test(doc.sliceString(end, end + 1))) end++;
              if (end > node.to) hideMarker(ranges, atomic, node.to, end, false);
            }
            break;
          }
          case "EmphasisMark":
          case "StrikethroughMark":
          case "CodeMark":
          case "SetextHeadingMark":
          case "Escape":
          case "LinkMark":
          case "LinkTitle":
          case "URL":
          case "Comment":
            hideMarker(ranges, atomic, node.from, node.to, reveal);
            break;
          case "QuoteMark":
            hideMarker(ranges, atomic, node.from, node.to, reveal);
            break;
          case "ListMark": {
            const marker = doc.sliceString(node.from, node.to);
            const rest = doc.sliceString(node.to, doc.lineAt(node.to).to);
            const task = /^\s+\[[ xX]\]/.test(rest);
            if (task) {
              hideMarker(ranges, atomic, node.from, node.to, reveal);
              break;
            }
            if (reveal) ranges.push(Decoration.mark({ class: "cm-live-marker" }).range(node.from, node.to));
            else {
              ranges.push(Decoration.replace({ widget: new ListMarkerWidget(/^\d/.test(marker) ? marker : "•") }).range(node.from, node.to));
              atomic.push(Decoration.replace({}).range(node.from, node.to));
            }
            break;
          }
          case "TaskMarker":
            ranges.push(
              Decoration.replace({
                widget: new TaskWidget(/\[[xX]\]/.test(doc.sliceString(node.from, node.to)), node.from, node.to, options.readOnly),
              }).range(node.from, node.to),
            );
            atomic.push(Decoration.replace({}).range(node.from, node.to));
            break;
          case "Image": {
            if (!options.inlineWidgets || blockReveal) {
              ranges.push(Decoration.mark({ class: "cm-live-image-source" }).range(node.from, node.to));
              break;
            }
            const source = doc.sliceString(node.from, node.to);
            const match = /^!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)$/.exec(source);
            ranges.push(
              Decoration.replace({
                widget: new ImageWidget(options.workspace, options.path, match?.[2] ?? match?.[3] ?? "", match?.[1] ?? "", node.from, node.to),
              }).range(node.from, node.to),
            );
            atomic.push(Decoration.replace({}).range(node.from, node.to));
            return false;
          }
          case "HorizontalRule": {
            if (blockReveal) ranges.push(Decoration.mark({ class: "cm-live-marker" }).range(node.from, node.to));
            else {
              const first = doc.lineAt(node.from);
              const last = doc.lineAt(node.to);
              ranges.push(Decoration.replace({ widget: new RuleWidget(first.from, last.to), block: true }).range(first.from, last.to));
              atomic.push(Decoration.replace({}).range(first.from, last.to));
            }
            break;
          }
          case "FencedCode":
          case "CodeBlock": {
            if (blockReveal) {
              styleLines(node.from, node.to, "cm-live-codeblock-source");
              revealedBlocks.push({ from: node.from, to: node.to });
              break;
            }
            const raw = doc.sliceString(node.from, node.to);
            const lines = raw.split("\n");
            const indented = name === "CodeBlock";
            const first = lines[0];
            const language = indented ? "" : /^`{3,}\s*(\S*)/.exec(first)?.[1] ?? "";
            const fenceIndent = /^[ \t]*/.exec(first)?.[0] ?? "";
            const code = indented
              ? raw.replace(/^ {4}/gm, "")
              : lines.slice(1, lines.length - 1).map((line) => (line.startsWith(fenceIndent) ? line.slice(fenceIndent.length) : line)).join("\n");
            ranges.push(
              Decoration.replace({ widget: new CodeBlockWidget(code, language, indented, node.from, node.to), block: true }).range(node.from, node.to),
            );
            atomic.push(Decoration.replace({}).range(node.from, node.to));
            return false;
          }
          case "Table": {
            const range = tableRange(state, node.from, node.to);
            if (intersects(state, range.from, range.to) || isRevealed(range.from, range.to)) {
              styleLines(range.from, range.to, "cm-live-table-source");
              revealedBlocks.push(range);
              break;
            }
            ranges.push(
              Decoration.replace({ widget: new TableWidget(doc.sliceString(range.from, range.to), options, range.from, range.to), block: true }).range(range.from, range.to),
            );
            atomic.push(Decoration.replace({}).range(range.from, range.to));
            tableRanges.push(range);
            return undefined;
          }
          case "HTMLBlock": {
            if (!options.rawHtml || blockReveal) break;
            const html = DOMPurify.sanitize(doc.sliceString(node.from, node.to), { FORBID_TAGS: ["style", "iframe", "object", "embed", "form"] });
            ranges.push(Decoration.replace({ widget: new HtmlBlockWidget(html, node.from, node.to), block: true }).range(node.from, node.to));
            atomic.push(Decoration.replace({}).range(node.from, node.to));
            return false;
          }
          default:
            break;
        }
        return undefined;
    },
  });
  return { decorations: Decoration.set(ranges, true), atomic: Decoration.set(atomic, true) };
}

type LiveFieldValue = Built & {
  text: string;
  math: MathRange[];
  front: ReturnType<typeof splitFrontMatter>;
  selection: string;
};

function selectionKey(state: EditorState) {
  return state.selection.ranges.map((range) => `${state.doc.lineAt(range.from).number}-${state.doc.lineAt(range.to).number}`).join(",");
}

export function livePreview(options: LivePreviewOptions): Extension {
  const field = StateField.define<LiveFieldValue>({
    create(state) {
      const text = state.doc.toString();
      const math = options.math ? mathRanges(text) : [];
      const front = splitFrontMatter(text);
      const built = buildDecorations(state, options, math, front);
      return { ...built, text, math, front, selection: selectionKey(state) };
    },
    update(value, transaction) {
      const previousReveal = transaction.startState.field(revealBlock, false);
      const nextReveal = transaction.state.field(revealBlock, false);
      const revealChanged = previousReveal?.from !== nextReveal?.from || previousReveal?.to !== nextReveal?.to;
      if (transaction.docChanged) {
        const text = transaction.state.doc.toString();
        const math = options.math ? mathRanges(text) : [];
        const front = splitFrontMatter(text);
        const built = buildDecorations(transaction.state, options, math, front);
        return { ...built, text, math, front, selection: selectionKey(transaction.state) };
      }
      const selection = selectionKey(transaction.state);
      if (selection === value.selection && !revealChanged) return value;
      const built = buildDecorations(transaction.state, options, value.math, value.front);
      return { ...value, ...built, selection };
    },
    provide(value) {
      return [
        EditorView.decorations.from(value, (state) => state.decorations),
        EditorView.atomicRanges.of((view) => view.state.field(value, false)?.atomic ?? Decoration.none),
      ];
    },
  });
  return [revealBlock, field];
}
