import { splitFrontMatter } from "./metadata";

export function documentStatistics(text: string) {
  const body = splitFrontMatter(text).body;
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
  return {
    characters: Array.from(body).length,
    words: [...segmenter.segment(body)].filter(part => part.isWordLike).length,
    lines: body ? body.split(/\r?\n/).length : 0,
    bytes: new TextEncoder().encode(text).length,
  };
}
