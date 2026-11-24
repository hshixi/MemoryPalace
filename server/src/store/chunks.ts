import { transaction, type Db } from "./db.ts";

export type LocKind = "line" | "page" | "paragraph";

export interface ChunkInput {
  relPath: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  text: string;
  locKind: LocKind;
}

export function countChunks(db: Db): number {
  const row = db.prepare("SELECT count(*) AS c FROM chunks").get() as { c: number };
  return row.c;
}

export function countContentFiles(db: Db): number {
  const row = db
    .prepare("SELECT count(DISTINCT rel_path) AS c FROM chunks")
    .get() as { c: number };
  return row.c;
}

/**
 * 全量替换用：调用方已经在 files 的事务里，这里不再开事务。
 * 文件记录必须先插入，chunks 才能通过 rel_path 找到 file_id。
 */
export function insertChunks(db: Db, chunks: ChunkInput[]): void {
  if (chunks.length === 0) return;
  const fileIds = new Map<string, number>();
  for (const row of db.prepare("SELECT id, rel_path FROM files").all() as unknown as Array<{
    id: number;
    rel_path: string;
  }>) {
    fileIds.set(row.rel_path, row.id);
  }

  const insert = db.prepare(
    `INSERT INTO chunks
       (file_id, rel_path, chunk_index, start_line, end_line, text, loc_kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  for (const chunk of chunks) {
    const fileId = fileIds.get(chunk.relPath);
    if (fileId === undefined) continue;
    insert.run(
      fileId,
      chunk.relPath,
      chunk.chunkIndex,
      chunk.startLine,
      chunk.endLine,
      chunk.text,
      chunk.locKind,
      now,
    );
  }
}

/** 单文件对账：删旧块，写新块；FTS 由触发器同步。 */
export function replaceChunksForPath(db: Db, relPath: string, chunks: ChunkInput[]): void {
  transaction(db, () => {
    const file = db.prepare("SELECT id FROM files WHERE rel_path = ?").get(relPath) as
      | { id: number }
      | undefined;
    if (!file) {
      db.prepare("DELETE FROM chunks WHERE rel_path = ?").run(relPath);
      return;
    }

    db.prepare("DELETE FROM chunks WHERE file_id = ?").run(file.id);
    if (chunks.length === 0) return;

    const insert = db.prepare(
      `INSERT INTO chunks
         (file_id, rel_path, chunk_index, start_line, end_line, text, loc_kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    for (const chunk of chunks) {
      insert.run(
        file.id,
        relPath,
        chunk.chunkIndex,
        chunk.startLine,
        chunk.endLine,
        chunk.text,
        chunk.locKind,
        now,
      );
    }
  });
}
