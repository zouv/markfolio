import { t } from "./i18n";
import { parseDocument, isMap } from "yaml";

export type NoteMetadata = {
  title: string; tags: string[]; aliases: string[]; todo: boolean;
  completed: boolean; pinned: boolean; due: string; source: string;
};
export function splitFrontMatter(text: string) {
  const match = /^(---\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.)(?:\r?\n|$))/.exec(text);
  return match ? { header: match[0], yaml: match[2], body: text.slice(match[0].length) }
    : { header: "", yaml: "", body: text };
}
export function stringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\s]+/) : [];
  return [...new Set(values.filter((v): v is string => typeof v === "string").map(v => v.trim().replace(/^#/, "")).filter(Boolean))];
}
export function readMetadata(text: string): NoteMetadata {
  const front = splitFrontMatter(text);
  const document = parseDocument(front.yaml);
  let data: Record<string, unknown> = {};
  try { if (!document.errors.length && isMap(document.contents)) data = document.toJS({ maxAliasCount: 50 }); } catch { /* malformed aliases stay editable as source */ }
  return {
    title: typeof data.title === "string" ? data.title : "",
    tags: stringList(data.tags ?? data.tag), aliases: stringList(data.aliases),
    todo: data.type === "todo" || data.todo === true,
    completed: data.completed === true, pinned: data.pinned === true,
    due: typeof data.due === "string" ? data.due : "",
    source: typeof data.source === "string" ? data.source : "",
  };
}
// The YAML document retains unknown fields, comments, key order and scalar styles.
export function updateMetadata(text: string, patch: Record<string, unknown>): string {
  if (!Object.keys(patch).length) return text;
  const front = splitFrontMatter(text);
  const doc = parseDocument(front.yaml || "{}");
  if (doc.errors.length || !isMap(doc.contents)) throw new Error(t("文档属性不是有效 YAML，请先在 Markdown 编辑器中修正"));
  for (const [key, value] of Object.entries(patch)) {
    if (!/^[\p{L}\p{N}_-]{1,80}$/u.test(key) || ["__proto__", "constructor", "prototype"].includes(key)) throw new Error(t("属性名无效"));
    if (value === undefined || value === null || value === "") doc.delete(key);
    else doc.set(key, value);
  }
  const ending = text.includes("\r\n") ? "\r\n" : "\n";
  const yaml = doc.toString({ lineWidth: 0 }).trimEnd().replace(/\r?\n/g, ending);
  return `---${ending}${yaml}${ending}---${ending}${front.body}`;
}

export function metadataPatch(baseline: NoteMetadata, next: NoteMetadata): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of ["title", "tags", "aliases", "completed", "pinned", "due", "source"] as const) {
    if (JSON.stringify(baseline[key]) !== JSON.stringify(next[key])) patch[key] = next[key];
  }
  if (baseline.todo !== next.todo) { patch.type = next.todo ? "todo" : "note"; patch.todo = next.todo; }
  return patch;
}

export function sortSelectedLines(text: string, from: number, to: number, reverse = false) {
  const start = text.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const endAt = to > from && text[to - 1] === "\n" ? to - 1 : to;
  const newline = text.indexOf("\n", endAt);
  const end = newline < 0 ? text.length : newline;
  const lines = text.slice(start, end).split("\n").sort((a,b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  if (reverse) lines.reverse();
  return { from: start, to: end, insert: lines.join("\n") };
}
