import fs from "node:fs";
import path from "node:path";
import type { Db } from "../store/db.ts";
import { replaceChunksForPath, type ChunkInput } from "../store/chunks.ts";
import { deleteFileRow, upsertFile, type IndexedFileInput } from "../store/files.ts";
import { extractChunksAsync } from "../rag/content.ts";
import { embedPendingChunks } from "../rag/vector-index.ts";
import { extOf, kindOfExt } from "./kinds.ts";
import { hasIgnoredSegment, isSensitiveRelPath } from "../policy/sensitive.ts";

/**
 * P1 的单文件对账：写/移之后只改索引里的这一条，不要求用户马上全量重建。
 * 全量重建仍然是最终真相；这里只是让刚改过的文件在搜索里立刻是对的。
 */
export function statToInput(absPath: string, relPath: string): IndexedFileInput {
  const stat = fs.statSync(absPath);
  const name = path.basename(absPath);
  const ext = extOf(name);
  return {
    relPath,
    name,
    ext,
    kind: kindOfExt(ext),
    sizeBytes: stat.size,
    mtimeMs: Math.round(stat.mtimeMs),
    ctimeMs: Number.isFinite(stat.ctimeMs) ? Math.round(stat.ctimeMs) : null,
    parentPath: relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "",
    depth: relPath.split("/").length - 1,
  };
}

export async function reindexPath(db: Db, absPath: string, relPath: string): Promise<void> {
  if (isSensitiveRelPath(relPath) || hasIgnoredSegment(relPath)) {
    deleteFileRow(db, relPath);
    return;
  }

  const input = statToInput(absPath, relPath);
  upsertFile(db, input);

  const extracted = await extractChunksAsync(absPath, input.ext, input.sizeBytes);
  const chunks: ChunkInput[] = extracted.chunks.map((chunk) => ({
    relPath,
    chunkIndex: chunk.chunkIndex,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    text: chunk.text,
    locKind: chunk.locKind,
  }));
  replaceChunksForPath(db, relPath, chunks);
  // 旧块被删时向量随外键级联消失；这里只补新块，失败不影响索引本身。
  await embedPendingChunks(db, { relPath, maxChunks: chunks.length });
}

export function deindexPath(db: Db, relPath: string): void {
  deleteFileRow(db, relPath);
}
