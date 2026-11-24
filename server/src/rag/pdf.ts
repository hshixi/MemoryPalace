import { MAX_CHUNKS_PER_FILE, chunkText } from "./chunk.ts";
import { normalizeExtractedText } from "./normalize.ts";
import type { ChunkDraft } from "./types.ts";

/** PDF 往往比纯文本大，单独放宽体积上限。 */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
/** 单份 PDF 最多解析多少页，避免病态文件拖死重建。 */
export const MAX_PDF_PAGES = 300;

export interface PdfExtractResult {
  chunks: ChunkDraft[];
  truncated: boolean;
  reason: string | null;
}

interface TextItemLike {
  str?: string;
  hasEOL?: boolean;
}

/**
 * 按页抽文本，再按页切块；startLine/endLine 在这里表示页码。
 * pdfjs 用动态 import：只有工作区里真的出现 PDF 时才加载这份大依赖。
 */
export async function extractPdfChunks(buffer: Buffer): Promise<PdfExtractResult> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loading = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    disableFontFace: true,
  });

  try {
    const pdf = await loading.promise;
    const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const chunks: ChunkDraft[] = [];
    let truncated = pdf.numPages > pageCount;

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      if (chunks.length >= MAX_CHUNKS_PER_FILE) {
        truncated = true;
        break;
      }
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const raw = (content.items as TextItemLike[])
        .map((item) =>
          typeof item.str === "string" ? item.str + (item.hasEOL ? "\n" : "") : "",
        )
        .join("");
      const text = normalizeExtractedText(raw).trim();
      if (!text) continue;

      const pageChunks = chunkText(text, {
        maxChunks: MAX_CHUNKS_PER_FILE - chunks.length,
      });
      for (const chunk of pageChunks) {
        chunks.push({
          chunkIndex: chunks.length,
          startLine: pageNumber,
          endLine: pageNumber,
          text: chunk.text,
          locKind: "page",
        });
      }
    }

    return { chunks, truncated, reason: null };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : String(error);
    if (name === "PasswordException" || /password/i.test(message)) {
      return { chunks: [], truncated: false, reason: "pdf_encrypted" };
    }
    return { chunks: [], truncated: false, reason: `pdf_failed:${message}` };
  } finally {
    try {
      await loading.destroy();
    } catch {
      // 解析已失败时销毁也可能失败，忽略。
    }
  }
}
