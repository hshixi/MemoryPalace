import { scanInjection } from "../policy/injection.ts";
import type { Db } from "../store/db.ts";
import { getChunksByIds, loadVectors, vectorSignature } from "../store/vectors.ts";
import { getEmbedder } from "./embed.ts";
import type { ContentHit } from "./search.ts";
import { locKindOf } from "./types.ts";

/** 低于这个余弦相似度的向量候选直接丢掉，避免语义检索永远有结果。 */
export const MIN_VECTOR_SCORE = 0.3;

export interface VectorCandidate {
  chunkId: number;
  hit: ContentHit;
}

interface CachedIndex {
  signature: string;
  ids: Int32Array;
  matrix: Float32Array;
  dim: number;
}

/** 缓存按签名失效，所以不需要显式清理钩子。 */
const cache = new WeakMap<Db, CachedIndex>();

function loadIndex(db: Db, model: string): CachedIndex | null {
  const signature = vectorSignature(db, model);
  const cached = cache.get(db);
  if (cached && cached.signature === signature) return cached;

  const { rows, dim } = loadVectors(db, model);
  if (rows.length === 0 || dim === 0) {
    const empty: CachedIndex = {
      signature,
      ids: new Int32Array(0),
      matrix: new Float32Array(0),
      dim: 0,
    };
    cache.set(db, empty);
    return empty;
  }

  const ids = new Int32Array(rows.length);
  const matrix = new Float32Array(rows.length * dim);
  rows.forEach((row, index) => {
    ids[index] = row.chunkId;
    matrix.set(row.vector.subarray(0, dim), index * dim);
  });
  const index: CachedIndex = { signature, ids, matrix, dim };
  cache.set(db, index);
  return index;
}

/** 归一化向量下余弦相似度就是点积；暴力扫一遍，MVP 规模够用。 */
export function rankVectors(
  ids: Int32Array,
  matrix: Float32Array,
  dim: number,
  query: Float32Array,
  limit: number,
): Array<{ chunkId: number; score: number }> {
  const scored: Array<{ chunkId: number; score: number }> = [];
  for (let row = 0; row < ids.length; row += 1) {
    const offset = row * dim;
    let score = 0;
    for (let index = 0; index < dim; index += 1) {
      score += matrix[offset + index] * query[index];
    }
    if (score >= MIN_VECTOR_SCORE) scored.push({ chunkId: ids[row], score });
  }
  scored.sort((a, b) => b.score - a.score || a.chunkId - b.chunkId);
  return scored.slice(0, limit);
}

function headSnippet(text: string, maxChars = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= maxChars ? flat : `${flat.slice(0, maxChars)}…`;
}

export async function searchVectorCandidates(
  db: Db,
  queryText: string,
  limit: number,
): Promise<VectorCandidate[]> {
  const embedder = await getEmbedder();
  if (!embedder) return [];
  const index = loadIndex(db, embedder.model);
  if (!index || index.ids.length === 0) return [];

  const query = await embedder.embedQuery(queryText);
  const ranked = rankVectors(index.ids, index.matrix, index.dim, query, limit * 3);
  if (ranked.length === 0) return [];

  const rows = getChunksByIds(
    db,
    ranked.map((row) => row.chunkId),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));

  const out: VectorCandidate[] = [];
  for (const { chunkId, score } of ranked.slice(0, limit)) {
    const row = byId.get(chunkId);
    if (!row) continue;
    const snippet = headSnippet(row.text);
    const at = row.rel_path.lastIndexOf("/");
    out.push({
      chunkId,
      hit: {
        path: row.rel_path,
        name: at < 0 ? row.rel_path : row.rel_path.slice(at + 1),
        locKind: locKindOf(row.loc_kind),
        startLine: row.start_line,
        endLine: row.end_line,
        snippet,
        score: Number(score.toFixed(3)),
        keywords: [],
        via: "vector",
        injection: scanInjection(snippet),
      },
    });
  }
  return out;
}
