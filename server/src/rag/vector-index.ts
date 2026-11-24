import type { Db } from "../store/db.ts";
import { insertVectors, listUnembeddedChunks } from "../store/vectors.ts";
import { getEmbedder } from "./embed.ts";

/** 全量重建时最多给多少块建向量；超出的先只做关键词，避免首次索引久等。 */
export const MAX_EMBED_CHUNKS = 10_000;
const EMBED_BATCH = 64;

export interface EmbedStats {
  embedded: number;
  skipped: boolean;
  reason: string | null;
}

/**
 * 给还没有向量的块补向量。写 / 移操作会删掉旧块，向量随外键级联消失，
 * 所以同一个函数也用于单文件重抽。
 */
export async function embedPendingChunks(
  db: Db,
  options: { maxChunks?: number; relPath?: string } = {},
): Promise<EmbedStats> {
  const embedder = await getEmbedder();
  if (!embedder) return { embedded: 0, skipped: true, reason: "disabled" };

  let remaining = Math.max(1, options.maxChunks ?? MAX_EMBED_CHUNKS);
  let embedded = 0;

  try {
    while (remaining > 0) {
      const rows = listUnembeddedChunks(
        db,
        embedder.model,
        Math.min(EMBED_BATCH, remaining),
        options.relPath,
      );
      if (rows.length === 0) break;
      const vectors = await embedder.embedDocuments(rows.map((row) => row.text));
      insertVectors(
        db,
        embedder.model,
        rows.map((row, index) => ({ chunkId: row.id, vector: vectors[index] })),
      );
      embedded += rows.length;
      remaining -= rows.length;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { embedded, skipped: false, reason: `embed_failed:${message}` };
  }

  return { embedded, skipped: false, reason: null };
}
