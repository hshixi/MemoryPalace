import type { ChunkDraft } from "./types.ts";

/** 单块字符上限。 */
export const MAX_CHUNK_CHARS = 800;
/** 单文件最多保留多少块。 */
export const MAX_CHUNKS_PER_FILE = 200;
/** 块之间重叠几行，避免一句话两边都缺上下文。 */
export const CHUNK_OVERLAP_LINES = 1;

export interface ChunkOptions {
  maxChars?: number;
  overlapLines?: number;
  maxChunks?: number;
}

/**
 * 按行打包：每块约 800 字，块间重叠 1 行；超长单行按 800 字切片。
 * 行号 1-based，endLine 包含。
 */
export function chunkText(input: string, options: ChunkOptions = {}): ChunkDraft[] {
  const maxChars = Math.max(1, options.maxChars ?? MAX_CHUNK_CHARS);
  const overlapLines = Math.max(0, options.overlapLines ?? CHUNK_OVERLAP_LINES);
  const maxChunks = Math.max(1, options.maxChunks ?? MAX_CHUNKS_PER_FILE);
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const chunks: ChunkDraft[] = [];

  let index = 0;
  while (index < lines.length && chunks.length < maxChunks) {
    const line = lines[index];

    // 超长单行：切成多个同行的块，避免整行被丢掉。
    if (line.length > maxChars) {
      for (let offset = 0; offset < line.length && chunks.length < maxChunks; offset += maxChars) {
        const text = line.slice(offset, offset + maxChars).trim();
        if (!text) continue;
        chunks.push({
          chunkIndex: chunks.length,
          startLine: index + 1,
          endLine: index + 1,
          text,
          locKind: "line",
        });
      }
      index += 1;
      continue;
    }

    let end = index;
    let size = 0;
    while (end < lines.length) {
      const addition = lines[end].length + (end === index ? 0 : 1);
      if (size + addition > maxChars) break;
      size += addition;
      end += 1;
    }
    if (end === index) end = index + 1;

    // 去掉首尾空行，让 startLine/endLine 正好对应 text 的第一行和最后一行；
    // 检索时再按命中位置把行号收窄到具体那一行。
    let first = index;
    let last = end - 1;
    while (first <= last && lines[first].trim() === "") first += 1;
    while (last >= first && lines[last].trim() === "") last -= 1;

    if (first <= last) {
      chunks.push({
        chunkIndex: chunks.length,
        startLine: first + 1,
        endLine: last + 1,
        text: lines.slice(first, last + 1).join("\n").trimEnd(),
        locKind: "line",
      });
    }

    if (end >= lines.length) break;
    index = Math.max(end - overlapLines, index + 1);
  }

  return chunks;
}
