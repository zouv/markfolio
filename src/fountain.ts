import { Fountain } from "fountain-js";

export function renderFountain(source: string): string {
  const parsed = new Fountain().parse(source);
  return `<div class="fountain-script"><div class="title-page">${parsed.html.title_page}</div><div class="script">${parsed.html.script}</div></div>`;
}
