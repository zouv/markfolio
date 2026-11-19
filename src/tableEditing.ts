import { markdownLanguage } from "@codemirror/lang-markdown";
import { t } from "./i18n";

export type TableAction = "tableAddRow" | "tableDeleteRow" | "tableAddColumn" | "tableDeleteColumn";
function cells(line: string) {
  const result: { text: string; from: number; to: number }[] = [];
  let start = 0, fence = 0;
  for (let index = 0; index <= line.length; index++) {
    if (line[index] === "\\") { index++; continue; }
    if (line[index] === "`") { const run = /^`+/.exec(line.slice(index))![0].length; fence = fence === run ? 0 : fence || run; index += run - 1; continue; }
    if (index === line.length || line[index] === "|" && !fence) { result.push({ text: line.slice(start, index).trim(), from: start, to: index }); start = index + 1; }
  }
  if (line.trimStart().startsWith("|")) result.shift();
  if (line.trimEnd().endsWith("|")) result.pop();
  return result;
}

/** Edit only the standard table containing the cursor; unrelated source stays byte-for-byte. */
export function editTable(text: string, position: number, action: TableAction) {
  const tree = markdownLanguage.parser.parse(text); let table = tree.resolveInner(Math.max(0, Math.min(position, text.length)), 1);
  while (table.name !== "Table" && table.parent) table = table.parent;
  if (table.name !== "Table") throw new Error(t("请将光标放在 Markdown 表格内"));
  const source = text.slice(table.from, table.to), lines = source.split("\n"), rows = lines.map(cells);
  const width = rows[0]?.length ?? 0;
  if (!width || rows.length < 2 || rows.some(row => row.length > width) || !rows[1].every(cell => /^:?-+:?$/.test(cell.text))) throw new Error(t("此表格使用扩展语法，请在源码中编辑"));
  for (const row of rows) while (row.length < width) row.push({ text: "", from: 0, to: 0 });
  const row = Math.min(text.slice(table.from, position).split("\n").length - 1, rows.length - 1);
  const lineStart = lines.slice(0, row).reduce((count, line) => count + line.length + 1, 0);
  const within = position - table.from - lineStart;
  const found = rows[row].findIndex(cell => within <= cell.to);
  const index = found < 0 ? width - 1 : found;
  if (action === "tableAddRow") rows.splice(Math.max(2, row + 1), 0, Array.from({ length: width }, () => ({ text: "", from: 0, to: 0 })));
  if (action === "tableDeleteRow") { if (row < 2) throw new Error(t("表头和分隔行不能删除")); rows.splice(row, 1); }
  if (action === "tableAddColumn") rows.forEach((cells, number) => cells.splice(index + 1, 0, { text: number === 1 ? "---" : "", from: 0, to: 0 }));
  if (action === "tableDeleteColumn") { if (width < 2) throw new Error(t("表格至少需要一列")); rows.forEach(cells => cells.splice(index, 1)); }
  return { from: table.from, to: table.to, insert: rows.map(row => `| ${row.map(cell => cell.text).join(" | ")} |`).join("\n") };
}
