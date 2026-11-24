import { MAX_CHUNK_CHARS, MAX_CHUNKS_PER_FILE } from "./chunk.ts";
import { normalizeExtractedText } from "./normalize.ts";
import type { ChunkDraft } from "./types.ts";

/** DOCX 是压缩包，体积上限放宽；解压后的正文仍受块数上限约束。 */
export const MAX_DOCX_BYTES = 20 * 1024 * 1024;

export interface DocxExtractResult {
  chunks: ChunkDraft[];
  truncated: boolean;
  reason: string | null;
}

/**
 * DOCX 没有稳定的「行」概念，引用用段落号。
 * mammoth 把每个段落以空行分隔输出，这里按段落打包成 ~800 字的块。
 */
export async function extractDocxChunks(buffer: Buffer): Promise<DocxExtractResult> {
  try {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer });
    const paragraphs = normalizeExtractedText(value)
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
      .filter((paragraph) => paragraph.length > 0);

    const { chunks, truncated } = packParagraphs(paragraphs);
    return { chunks, truncated, reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { chunks: [], truncated: false, reason: `docx_failed:${message}` };
  }
}

/** 段落打包：块内尽量多放整段；超长单段按 800 字切开，段号相同。 */
function packParagraphs(paragraphs: string[]): {
  chunks: ChunkDraft[];
  truncated: boolean;
} {
  const chunks: ChunkDraft[] = [];
  let bufferText: string[] = [];
  let bufferStart = 0;
  let bufferEnd = 0;
  let size = 0;

  const flush = (): void => {
    if (bufferText.length === 0) return;
    chunks.push({
      chunkIndex: chunks.length,
      startLine: bufferStart,
      endLine: bufferEnd,
      text: bufferText.join("\n\n"),
      locKind: "paragraph",
    });
    bufferText = [];
    size = 0;
  };

  for (let index = 0; index < paragraphs.length; index += 1) {
    if (chunks.length >= MAX_CHUNKS_PER_FILE) return { chunks, truncated: true };
    const paragraph = paragraphs[index];
    const number = index + 1;

    if (paragraph.length > MAX_CHUNK_CHARS) {
      flush();
      for (let offset = 0; offset < paragraph.length; offset += MAX_CHUNK_CHARS) {
        if (chunks.length >= MAX_CHUNKS_PER_FILE) return { chunks, truncated: true };
        const text = paragraph.slice(offset, offset + MAX_CHUNK_CHARS).trim();
        if (!text) continue;
        chunks.push({
          chunkIndex: chunks.length,
          startLine: number,
          endLine: number,
          text,
          locKind: "paragraph",
        });
      }
      continue;
    }

    const addition = paragraph.length + (bufferText.length > 0 ? 2 : 0);
    if (bufferText.length > 0 && size + addition > MAX_CHUNK_CHARS) flush();
    if (bufferText.length === 0) bufferStart = number;
    bufferText.push(paragraph);
    bufferEnd = number;
    size += addition;
  }

  flush();
  return { chunks, truncated: false };
}
