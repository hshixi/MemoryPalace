import fs from "node:fs/promises";
import { isTextExt } from "../index/kinds.ts";
import { redactSecrets } from "../policy/redact.ts";
import { MAX_CHUNKS_PER_FILE, chunkText } from "./chunk.ts";
import { MAX_DOCX_BYTES, extractDocxChunks } from "./docx.ts";
import { MAX_PDF_BYTES, extractPdfChunks } from "./pdf.ts";
import { emptyResult, type ChunkDraft, type ExtractResult } from "./types.ts";

export { MAX_CHUNK_CHARS, MAX_CHUNKS_PER_FILE, CHUNK_OVERLAP_LINES } from "./chunk.ts";
export { chunkText } from "./chunk.ts";
export { emptyResult, locLabel } from "./types.ts";
export type { ChunkDraft, ExtractResult, LocKind } from "./types.ts";

/** 纯文本单文件上限；超过只保留元数据。 */
export const MAX_CONTENT_FILE_BYTES = 1 * 1024 * 1024;
/** 全库最多抽多少块，防止大工作区把重建拖死。 */
export const MAX_TOTAL_CHUNKS = 100_000;

function buildTextResult(buffer: Buffer): ExtractResult {
  if (buffer.subarray(0, 8_192).includes(0)) {
    return emptyResult("binary");
  }
  const decoded = buffer.toString("utf8");
  const redacted = redactSecrets(decoded);
  const all = chunkText(redacted.text);
  const chunks = all.slice(0, MAX_CHUNKS_PER_FILE);
  return {
    chunks,
    redacted: redacted.redacted,
    truncated: all.length > chunks.length,
    reason: null,
  };
}

/**
 * PDF/DOCX 抽出的文本同样是不可信内容：入库前统一脱敏。
 * 脱敏按块进行（文本文件是先整篇脱敏再切块）——这是已知的边界差异，
 * 极少数跨块切断的密钥串可能漏网，后续在输出层还有一道脱敏兜底。
 */
function redactChunks(
  chunks: ChunkDraft[],
  truncated: boolean,
  reason: string | null,
): ExtractResult {
  if (reason && chunks.length === 0) return emptyResult(reason);
  const kept = chunks.slice(0, MAX_CHUNKS_PER_FILE);
  let redacted = false;
  const out = kept.map((chunk) => {
    const result = redactSecrets(chunk.text);
    if (result.redacted) redacted = true;
    return { ...chunk, text: result.text };
  });
  return {
    chunks: out,
    redacted,
    truncated: truncated || chunks.length > kept.length,
    reason,
  };
}

export function canIndexContent(ext: string, sizeBytes: number): boolean {
  if (sizeBytes <= 0) return false;
  if (isTextExt(ext)) return sizeBytes <= MAX_CONTENT_FILE_BYTES;
  if (ext === "pdf") return sizeBytes <= MAX_PDF_BYTES;
  if (ext === "docx") return sizeBytes <= MAX_DOCX_BYTES;
  return false;
}

export function isContentExt(ext: string): boolean {
  return isTextExt(ext) || ext === "pdf" || ext === "docx";
}

export async function extractChunksAsync(
  absPath: string,
  ext: string,
  sizeBytes: number,
): Promise<ExtractResult> {
  if (!isContentExt(ext)) return emptyResult("unsupported_type");
  if (!canIndexContent(ext, sizeBytes)) return emptyResult("too_large");

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(absPath);
  } catch (error) {
    return emptyResult(
      `read_failed:${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (isTextExt(ext)) return buildTextResult(buffer);
  if (ext === "pdf") {
    const result = await extractPdfChunks(buffer);
    return redactChunks(result.chunks, result.truncated, result.reason);
  }
  const result = await extractDocxChunks(buffer);
  return redactChunks(result.chunks, result.truncated, result.reason);
}
