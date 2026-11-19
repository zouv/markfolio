import { markdownLanguage } from "@codemirror/lang-markdown";
import type { MarkdownExtensions } from "./types";

type Span = { from: number; to: number; value?: string };
const hidden = new Set(["EmphasisMark", "StrikethroughMark", "CodeMark", "HeaderMark", "QuoteMark", "ListMark", "TaskMarker", "TableDelimiter", "LinkMark", "LinkLabel", "LinkTitle", "SetextHeadingMark"]);

/** Match rendered characters to source positions, keeping repeated text distinct. */
export function renderedSourceSpans(source: string, visible: string, extensions: Partial<MarkdownExtensions> = {}): Span[] {
  const excluded: Span[] = [], entities: Span[] = [], protectedRanges: Span[] = [];
  const cursor = markdownLanguage.parser.parse(source).cursor();
  do {
    if (hidden.has(cursor.name) || cursor.name === "Image" || cursor.name === "URL" && cursor.node.parent?.name !== "Autolink") excluded.push({ from: cursor.from, to: cursor.to });
    if (cursor.name === "SubscriptMark" && extensions.sub !== false || cursor.name === "SuperscriptMark" && extensions.sup !== false) excluded.push({ from: cursor.from, to: cursor.to });
    if (["InlineCode", "FencedCode", "CodeBlock"].includes(cursor.name)) protectedRanges.push({ from: cursor.from, to: cursor.to });
    if (cursor.name === "Escape") excluded.push({ from: cursor.from, to: cursor.from + 1 });
    if (cursor.name === "Entity") {
      const decoder = document.createElement("textarea"); decoder.innerHTML = source.slice(cursor.from, cursor.to);
      entities.push({ from: cursor.from, to: cursor.to, value: decoder.value });
    }
  } while (cursor.next());
  // Extensions outside the CommonMark parser have delimiter pairs of their own.
  for (const match of source.matchAll(/(==|\+\+)(?=\S)([^\n]+?)\1/g)) {
    const from = match.index!, to = from + match[0].length;
    if (extensions[match[1] === "==" ? "mark" : "ins"] === false || protectedRanges.some(range => from < range.to && to > range.from)) continue;
    const slashes = source.slice(0, from).match(/\\+$/)?.[0].length ?? 0;
    if (slashes % 2 || /\s$/.test(match[2]) || source[from - 1] === match[1][0] || source[to] === match[1][0]) continue;
    excluded.push({ from, to: from + match[1].length }, { from: to - match[1].length, to });
  }
  excluded.sort((a, b) => a.from - b.from);
  const units: Span[] = []; let position = 0, exclusion = 0, entity = 0;
  while (position < source.length) {
    while (exclusion < excluded.length && excluded[exclusion].to <= position) exclusion++;
    const omitted = excluded[exclusion];
    if (omitted && omitted.from <= position) { position = omitted.to; continue; }
    while (entity < entities.length && entities[entity].to <= position) entity++;
    const decoded = entities[entity];
    if (decoded?.from === position) {
      for (const value of (decoded.value ?? "").split("")) units.push({ from: decoded.from, to: decoded.to, value });
      position = decoded.to; continue;
    }
    units.push({ from: position, to: position + 1, value: source[position] }); position++;
  }
  const spans: Span[] = []; let unit = 0;
  for (let index = 0; index < visible.length; index++) {
    const value = visible[index];
    // Renderer indentation/newlines are DOM text too, but may be generated.
    if (/\s/.test(value) && !/\s/.test(units[unit]?.value ?? "")) {
      const at = spans.at(-1)?.to ?? 0; spans.push({ from: at, to: at }); continue;
    }
    while (unit < units.length && units[unit].value !== value) unit++;
    if (unit < units.length) spans.push(units[unit++]);
    else { const at = spans.at(-1)?.to ?? source.length; spans.push({ from: at, to: at }); }
  }
  return spans;
}

export function sourceBoundary(source: string, element: HTMLElement, node: Node, offset: number, end = false, extensions: Partial<MarkdownExtensions> = {}): number {
  const prefix = document.createRange(); prefix.selectNodeContents(element); prefix.setEnd(node, offset);
  const index = prefix.toString().length;
  const spans = renderedSourceSpans(source, element.textContent ?? "", extensions);
  if (end && index > 0) return spans[index - 1]?.to ?? source.length;
  return spans[index]?.from ?? spans.at(-1)?.to ?? 0;
}
