import path from "node:path";
import type { ScannedFile } from "../index/scan.ts";
import type { ChunkInput } from "../store/chunks.ts";
import {
  MAX_TOTAL_CHUNKS,
  canIndexContent,
  extractChunksAsync,
} from "./content.ts";

export interface ContentIndexResult {
  chunks: ChunkInput[];
  contentFiles: number;
  truncatedFiles: number;
  errors: string[];
}

/**
 * 全量重建时抽取正文。读取失败只记错误，不影响元数据索引。
 * 并发 8 个文件，避免大工作区把文件描述符打满。
 */
export async function extractWorkspaceChunks(
  root: string,
  files: ScannedFile[],
  options: { concurrency?: number; maxTotalChunks?: number } = {},
): Promise<ContentIndexResult> {
  const concurrency = Math.max(1, options.concurrency ?? 8);
  const maxTotalChunks = Math.max(1, options.maxTotalChunks ?? MAX_TOTAL_CHUNKS);
  const queue = files.filter((file) => canIndexContent(file.ext, file.sizeBytes));
  const chunks: ChunkInput[] = [];
  const errors: string[] = [];
  let contentFiles = 0;
  let truncatedFiles = 0;
  let next = 0;
  let total = 0;

  const worker = async (): Promise<void> => {
    while (next < queue.length) {
      if (total >= maxTotalChunks) return;
      const file = queue[next];
      next += 1;

      const result = await extractChunksAsync(
        path.join(root, file.relPath),
        file.ext,
        file.sizeBytes,
      );
      if (result.chunks.length === 0 && result.reason && result.reason !== "binary") {
        if (errors.length < 50) {
          errors.push(`${file.relPath}: ${result.reason}`);
        }
        continue;
      }
      if (result.chunks.length === 0) continue;
      if (result.truncated) truncatedFiles += 1;

      const remaining = maxTotalChunks - total;
      const selected = result.chunks.slice(0, remaining);
      for (const chunk of selected) {
        chunks.push({
          relPath: file.relPath,
          chunkIndex: chunk.chunkIndex,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          text: chunk.text,
          locKind: chunk.locKind,
        });
      }
      total += selected.length;
      contentFiles += 1;
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()),
  );

  chunks.sort(
    (a, b) => a.relPath.localeCompare(b.relPath, "zh-CN") || a.chunkIndex - b.chunkIndex,
  );
  return { chunks, contentFiles, truncatedFiles, errors };
}
