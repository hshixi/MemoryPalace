import type { FileKind } from "../index/kinds.ts";
import { insertChunks, type ChunkInput } from "./chunks.ts";
import { transaction, type Db } from "./db.ts";

export interface IndexedFileInput {
  relPath: string;
  name: string;
  ext: string;
  kind: FileKind;
  sizeBytes: number;
  mtimeMs: number;
  ctimeMs: number | null;
  parentPath: string;
  depth: number;
}

export interface FileRecord {
  id: number;
  relPath: string;
  name: string;
  ext: string;
  kind: FileKind;
  sizeBytes: number;
  mtimeMs: number;
  ctimeMs: number | null;
  parentPath: string;
  depth: number;
  indexedAt: number;
}

interface FileRow {
  id: number;
  rel_path: string;
  name: string;
  ext: string;
  kind: FileKind;
  size_bytes: number;
  mtime_ms: number;
  ctime_ms: number | null;
  parent_path: string;
  depth: number;
  indexed_at: number;
}

export function mapFile(row: FileRow): FileRecord {
  return {
    id: row.id,
    relPath: row.rel_path,
    name: row.name,
    ext: row.ext,
    kind: row.kind,
    sizeBytes: row.size_bytes,
    mtimeMs: row.mtime_ms,
    ctimeMs: row.ctime_ms,
    parentPath: row.parent_path,
    depth: row.depth,
    indexedAt: row.indexed_at,
  };
}

export function replaceFiles(
  db: Db,
  files: IndexedFileInput[],
  chunks: ChunkInput[] = [],
): void {
  transaction(db, () => {
    // 外键级联删除 chunks，chunks 的触发器同步删 FTS。
    db.exec("DELETE FROM files");
    db.exec("INSERT INTO files_fts(files_fts) VALUES('delete-all')");

    const insert = db.prepare(
      `INSERT INTO files
         (rel_path, name, ext, kind, size_bytes, mtime_ms, ctime_ms, parent_path, depth, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    for (const file of files) {
      insert.run(
        file.relPath,
        file.name,
        file.ext,
        file.kind,
        file.sizeBytes,
        file.mtimeMs,
        file.ctimeMs,
        file.parentPath,
        file.depth,
        now,
      );
    }
    db.exec("INSERT INTO files_fts(files_fts) VALUES('rebuild')");
    insertChunks(db, chunks);
  });
}

/** 单条写入：新建或覆盖后，把这条记录同步进索引（含 FTS）。 */
export function upsertFile(db: Db, file: IndexedFileInput): void {
  transaction(db, () => {
    db.prepare(
      `INSERT INTO files
         (rel_path, name, ext, kind, size_bytes, mtime_ms, ctime_ms, parent_path, depth, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(rel_path) DO UPDATE SET
         name = excluded.name,
         ext = excluded.ext,
         kind = excluded.kind,
         size_bytes = excluded.size_bytes,
         mtime_ms = excluded.mtime_ms,
         ctime_ms = excluded.ctime_ms,
         parent_path = excluded.parent_path,
         depth = excluded.depth,
         indexed_at = excluded.indexed_at`,
    ).run(
      file.relPath,
      file.name,
      file.ext,
      file.kind,
      file.sizeBytes,
      file.mtimeMs,
      file.ctimeMs,
      file.parentPath,
      file.depth,
      Date.now(),
    );
    db.exec("INSERT INTO files_fts(files_fts) VALUES('rebuild')");
  });
}

/** 单条删除：文件被移走或删掉后，从索引里移除。返回是否真的删掉了记录。 */
export function deleteFileRow(db: Db, relPath: string): boolean {
  return transaction(db, () => {
    const result = db.prepare("DELETE FROM files WHERE rel_path = ?").run(relPath);
    const changed = Number(result.changes) > 0;
    if (changed) db.exec("INSERT INTO files_fts(files_fts) VALUES('rebuild')");
    return changed;
  });
}

export function countFiles(db: Db): number {
  const row = db.prepare("SELECT count(*) AS c FROM files").get() as { c: number };
  return row.c;
}

export function getFileByRelPath(db: Db, relPath: string): FileRecord | null {
  const row = db.prepare("SELECT * FROM files WHERE rel_path = ?").get(relPath) as
    | FileRow
    | undefined;
  return row ? mapFile(row) : null;
}

export function listFiles(
  db: Db,
  options: { parentPath?: string; kind?: string; limit?: number } = {},
): FileRecord[] {
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (options.parentPath !== undefined) {
    where.push("parent_path = ?");
    params.push(options.parentPath);
  }
  if (options.kind) {
    where.push("kind = ?");
    params.push(options.kind);
  }

  const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
  const sql = `SELECT * FROM files ${
    where.length ? `WHERE ${where.join(" AND ")}` : ""
  } ORDER BY rel_path ASC LIMIT ?`;
  const rows = db.prepare(sql).all(...params, limit) as unknown as FileRow[];
  return rows.map(mapFile);
}

export interface BrowseFolder {
  name: string;
  path: string;
  count: number;
}

export interface BrowseResult {
  path: string;
  folders: BrowseFolder[];
  files: FileRecord[];
  totalFiles: number;
  offset: number;
  limit: number;
}

/**
 * 列出某个目录下的直接子文件夹和直接文件。
 * 只认索引里的文件：被排除的敏感文件和忽略目录不会出现在结果里。
 */
export function browseFolder(
  db: Db,
  relPath: string,
  options: { offset?: number; limit?: number } = {},
): BrowseResult {
  const folder = relPath.replace(/^\/+|\/+$/g, "");
  const prefix = folder ? `${folder}/` : "";
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));

  const folderRows = db
    .prepare(
      `SELECT substr(rest, 1, instr(rest, '/') - 1) AS name, count(*) AS count
       FROM (
         SELECT substr(rel_path, ?) AS rest
         FROM files
         WHERE substr(rel_path, 1, ?) = ? AND length(rel_path) > ?
       )
       WHERE instr(rest, '/') > 0
       GROUP BY name
       ORDER BY count DESC, name ASC`,
    )
    .all(
      prefix.length + 1,
      prefix.length,
      prefix,
      prefix.length,
    ) as unknown as Array<{ name: string; count: number }>;

  const files = db
    .prepare(
      `SELECT * FROM files
       WHERE parent_path = ?
       ORDER BY mtime_ms DESC, rel_path ASC
       LIMIT ? OFFSET ?`,
    )
    .all(folder, limit, offset) as unknown as FileRow[];

  const total = db
    .prepare("SELECT count(*) AS count FROM files WHERE parent_path = ?")
    .get(folder) as { count: number };

  return {
    path: folder,
    folders: folderRows.map((row) => ({
      name: row.name,
      path: prefix + row.name,
      count: row.count,
    })),
    files: files.map(mapFile),
    totalFiles: total.count,
    offset,
    limit,
  };
}

export function allFiles(db: Db): FileRecord[] {
  const rows = db.prepare("SELECT * FROM files ORDER BY rel_path ASC").all() as unknown as FileRow[];
  return rows.map(mapFile);
}
