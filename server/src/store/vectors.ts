import { transaction, type Db } from "./db.ts";

/** 单次查询最多装进内存多少条向量；超过的部分不参与语义检索。 */
export const MAX_VECTORS_IN_MEMORY = 20_000;

export interface UnembeddedChunk {
  id: number;
  relPath: string;
  text: string;
}

export interface VectorInput {
  chunkId: number;
  vector: Float32Array;
}

export function countVectors(db: Db, model: string): number {
  const row = db
    .prepare("SELECT count(*) AS c FROM chunk_vectors WHERE model = ?")
    .get(model) as { c: number };
  return row.c;
}

/**
 * 缓存签名：条数、最近写入时间或最大 chunk_id 变了就重载。
 * 重抽同一文件时 chunk_id 会变，即使条数和毫秒时间碰巧相同也能感知到。
 */
export function vectorSignature(db: Db, model: string): string {
  const row = db
    .prepare(
      `SELECT count(*) AS c, COALESCE(max(created_at), 0) AS t,
              COALESCE(max(chunk_id), 0) AS m
         FROM chunk_vectors WHERE model = ?`,
    )
    .get(model) as { c: number; t: number; m: number };
  return `${row.c}:${row.t}:${row.m}`;
}

/** 找出还没有向量的块；按 chunk_id 升序，便于分批稳定推进。 */
export function listUnembeddedChunks(
  db: Db,
  model: string,
  limit: number,
  relPath?: string,
): UnembeddedChunk[] {
  if (relPath) {
    return db
      .prepare(
        `SELECT c.id, c.rel_path AS relPath, c.text
           FROM chunks c
           LEFT JOIN chunk_vectors v ON v.chunk_id = c.id AND v.model = ?
          WHERE v.chunk_id IS NULL AND c.rel_path = ?
          ORDER BY c.id
          LIMIT ?`,
      )
      .all(model, relPath, Math.max(1, limit)) as unknown as UnembeddedChunk[];
  }
  return db
    .prepare(
      `SELECT c.id, c.rel_path AS relPath, c.text
         FROM chunks c
         LEFT JOIN chunk_vectors v ON v.chunk_id = c.id AND v.model = ?
        WHERE v.chunk_id IS NULL
        ORDER BY c.id
        LIMIT ?`,
    )
    .all(model, Math.max(1, limit)) as unknown as UnembeddedChunk[];
}

export function insertVectors(db: Db, model: string, rows: VectorInput[]): void {
  if (rows.length === 0) return;
  const dim = rows[0].vector.length;
  const insert = db.prepare(
    `INSERT OR REPLACE INTO chunk_vectors (chunk_id, model, dim, vector, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  transaction(db, () => {
    for (const row of rows) {
      insert.run(row.chunkId, model, dim, vectorToBlob(row.vector), now);
    }
  });
}

export interface VectorRow {
  chunkId: number;
  vector: Float32Array;
}

/** 载入内存做暴力点积；MVP 的规模下比引入 ANN 扩展更简单。 */
export function loadVectors(
  db: Db,
  model: string,
  limit = MAX_VECTORS_IN_MEMORY,
): { rows: VectorRow[]; dim: number } {
  const raw = db
    .prepare(
      `SELECT chunk_id AS chunkId, vector FROM chunk_vectors
        WHERE model = ? ORDER BY chunk_id LIMIT ?`,
    )
    .all(model, limit) as unknown as Array<{ chunkId: number; vector: Uint8Array }>;
  const rows: VectorRow[] = [];
  let dim = 0;
  for (const row of raw) {
    const vector = blobToVector(row.vector);
    if (vector.length === 0) continue;
    dim = vector.length;
    rows.push({ chunkId: row.chunkId, vector });
  }
  return { rows, dim };
}

export interface ChunkRowForHit {
  id: number;
  rel_path: string;
  start_line: number;
  end_line: number;
  loc_kind: string;
  text: string;
}

export function getChunksByIds(db: Db, ids: number[]): ChunkRowForHit[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT id, rel_path, start_line, end_line, loc_kind, text
         FROM chunks WHERE id IN (${placeholders})`,
    )
    .all(...ids) as unknown as ChunkRowForHit[];
}

/** 删除后重新嵌入：写/移操作会先删旧块，向量随外键级联消失。 */
export function deleteVectorsForPath(db: Db, relPath: string): void {
  db.prepare(
    `DELETE FROM chunk_vectors
      WHERE chunk_id IN (SELECT id FROM chunks WHERE rel_path = ?)`,
  ).run(relPath);
}

function vectorToBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function blobToVector(blob: Uint8Array): Float32Array {
  // 复制一份，避免对齐问题；SQLite 返回的 Buffer 可能没有 4 字节对齐。
  const copy = new Uint8Array(blob);
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
}
