import { parseSearchQuery } from "../index/search.ts";
import { scanInjection, type InjectionScan } from "../policy/injection.ts";
import type { Db } from "../store/db.ts";
import { locKindOf, type LocKind } from "./types.ts";
import { searchVectorCandidates, type VectorCandidate } from "./vector.ts";

export type SearchMode = "keyword" | "vector" | "hybrid";
export type HitVia = "keyword" | "vector" | "both";

export interface ContentHit {
  path: string;
  name: string;
  locKind: LocKind;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
  keywords: string[];
  /** 这条结果来自关键词、向量，还是两边都命中。 */
  via: HitVia;
  injection: InjectionScan;
}

export interface ContentSearchResult {
  query: string;
  mode: SearchMode;
  interpreted: { keywords: string[] };
  hits: ContentHit[];
}

export interface ContentSearchOptions {
  k?: number;
  now?: number;
  /** 默认 hybrid；测试和排查可以强制走关键词。 */
  mode?: SearchMode;
}

interface Candidate {
  chunkId: number;
  hit: ContentHit;
}

interface ChunkRow {
  id: number;
  rel_path: string;
  start_line: number;
  end_line: number;
  text: string;
  loc_kind: string;
}

/** 和元数据搜索同一套切词，避免「元数据搜得到、正文搜不到」这种割裂。 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function isFtsSafe(keyword: string): boolean {
  return keyword.length >= 3 && /^[\p{L}\p{N}]+$/u.test(keyword);
}

/**
 * 中文没有空格，用户常把几个词连成一串（“订阅收入增长”）。
 * 整串不是文件里的原文时，按 2 字一组退化成子词再匹配；
 * 3 字以内的词保持整串，避免“毛利率”被拆坏。
 */
function partsOf(keyword: string): string[] {
  if (keyword.length < 4 || !/^[㐀-鿿]+$/.test(keyword)) return [keyword];
  const parts: string[] = [];
  for (let index = 0; index + 2 <= keyword.length; index += 2) {
    parts.push(keyword.slice(index, index + 2));
  }
  if (keyword.length % 2 === 1) parts.push(keyword.slice(-2));
  return [...new Set(parts)];
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    count += 1;
    from = at + needle.length;
  }
  return count;
}

/** 把块级行号收窄到真正命中的行，引用更准确。 */
function locateLines(
  text: string,
  chunkStart: number,
  keywords: string[],
): { start: number; end: number } {
  const lower = text.toLowerCase();
  let first = -1;
  let lastEnd = -1;
  for (const keyword of keywords) {
    let at = lower.indexOf(keyword);
    while (at >= 0) {
      if (first < 0 || at < first) first = at;
      lastEnd = Math.max(lastEnd, at + keyword.length);
      at = lower.indexOf(keyword, at + keyword.length);
    }
  }
  if (first < 0) return { start: chunkStart, end: chunkStart };

  const newlinesBefore = (offset: number): number => {
    let count = 0;
    for (let index = 0; index < offset; index += 1) {
      if (text.charCodeAt(index) === 10) count += 1;
    }
    return count;
  };

  return {
    start: chunkStart + newlinesBefore(first),
    end: chunkStart + newlinesBefore(lastEnd),
  };
}

/** 以第一个命中的关键词为中心截一小段，保留前后文。 */
function makeSnippet(text: string, keywords: string[]): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const keyword of keywords) {
    const found = lower.indexOf(keyword);
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }

  // 窗口边缘尽量落在句读/空白处，避免从半个词开始。
  const BOUNDARY = /[\n。！？；，,.!?;、\s]/;
  let start = Math.max(0, at - 60);
  if (start > 0) {
    const lead = text.slice(start, Math.min(text.length, start + 30));
    const boundary = lead.search(BOUNDARY);
    if (boundary >= 0) start += boundary + 1;
  }

  let end = Math.min(text.length, Math.max(at, 0) + 140);
  if (end < text.length) {
    const tail = text.slice(Math.max(start, end - 30), end);
    let cut = -1;
    for (let index = 0; index < tail.length; index += 1) {
      if (BOUNDARY.test(tail[index])) cut = index;
    }
    if (cut >= 0) end = Math.max(start, end - 30) + cut + 1;
  }

  const slice = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${slice}${end < text.length ? "…" : ""}`;
}

function nameOf(relPath: string): string {
  const at = relPath.lastIndexOf("/");
  return at < 0 ? relPath : relPath.slice(at + 1);
}

const RRF_K = 60;
/** 关键词有字面证据，融合时略高于语义分。 */
const KEYWORD_WEIGHT = 1.5;

/**
 * 关键词候选：FTS5 trigram 负责 3 字以上的词，LIKE 兜 2 字中文和子串。
 * 打分 = 关键词覆盖率 * 0.8 + 出现次数（封顶 5 次）/ 5 * 0.2。
 */
function keywordCandidates(
  db: Db,
  keywords: string[],
  limit: number,
): Candidate[] {
  const groups = keywords.map((keyword) => ({ keyword, parts: partsOf(keyword) }));
  const searchParts = [...new Set(groups.flatMap((group) => group.parts))];

  const candidateIds = new Set<number>();
  for (const keyword of searchParts) {
    if (isFtsSafe(keyword)) {
      try {
        const rows = db
          .prepare(
            `SELECT rowid AS id FROM chunks_fts
             WHERE chunks_fts MATCH ?
             LIMIT 300`,
          )
          .all(`"${keyword.replace(/"/g, '""')}"`) as unknown as Array<{ id: number }>;
        for (const row of rows) candidateIds.add(row.id);
      } catch {
        // FTS 失败不阻塞 LIKE 兜底。
      }
    }

    const rows = db
      .prepare("SELECT id FROM chunks WHERE text LIKE ? ESCAPE '\\' LIMIT 400")
      .all(`%${escapeLike(keyword)}%`) as unknown as Array<{ id: number }>;
    for (const row of rows) candidateIds.add(row.id);
  }

  if (candidateIds.size === 0) return [];

  const ids = [...candidateIds];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, rel_path, start_line, end_line, text, loc_kind FROM chunks WHERE id IN (${placeholders})`,
    )
    .all(...ids) as unknown as ChunkRow[];

  const candidates: Candidate[] = [];
  for (const row of rows) {
    const lower = row.text.toLowerCase();
    const matched: string[] = [];
    const needles: string[] = [];
    const groupScores: number[] = [];
    let occurrences = 0;
    let strongGroup = false;

    for (const group of groups) {
      let partHits = 0;
      for (const part of group.parts) {
        const count = countOccurrences(lower, part);
        if (count > 0) {
          partHits += 1;
          occurrences += count;
          needles.push(part);
        }
      }
      groupScores.push(partHits / group.parts.length);
      if (partHits > 0) matched.push(group.keyword);
      // 可拆分的词至少要中两个子词（不足两个时中一个即可）。
      // 「市场投放」只命中「市场」不算，否则「海外市场」会被当成市场投放。
      if (partHits >= Math.min(2, group.parts.length)) strongGroup = true;
    }

    if (!strongGroup) continue;

    const coverage =
      groupScores.reduce((sum, score) => sum + score, 0) / groupScores.length;
    const score = coverage * 0.8 + Math.min(1, occurrences / 5) * 0.2;
    const snippet = makeSnippet(row.text, needles);
    const locKind = locKindOf(row.loc_kind);
    // 只有文本块能按命中位置收窄到具体行；页/段引用保持整页/整段。
    const lines =
      locKind === "line"
        ? locateLines(row.text, row.start_line, needles)
        : { start: row.start_line, end: row.end_line };

    candidates.push({
      chunkId: row.id,
      hit: {
        path: row.rel_path,
        name: nameOf(row.rel_path),
        locKind,
        startLine: lines.start,
        endLine: lines.end,
        snippet,
        score: Number(score.toFixed(3)),
        keywords: matched,
        via: "keyword",
        injection: scanInjection(snippet),
      },
    });
  }

  candidates.sort(
    (a, b) =>
      b.hit.score - a.hit.score ||
      a.hit.path.localeCompare(b.hit.path, "zh-CN") ||
      a.hit.startLine - b.hit.startLine,
  );
  return candidates.slice(0, limit);
}

export interface FusionOptions {
  /**
   * 关键词已命中至少这么多块时，不再追加纯语义结果。
   * 本地小模型的余弦分数很挤，纯语义候选容易把只沾边的文件带进来；
   * 只要有字面证据托底，就宁可少返回，也不要看起来相关的噪声。
   * 默认 1：关键词完全没命中时才让语义兜底。
   */
  minKeywordHitsToSkipVectorOnly?: number;
}

/**
 * RRF 融合：按名次而不是原始分数相加，关键词分和余弦分不可比也没关系。
 * 同一条块两边都命中时保留关键词的窄行号，`via` 标成 both。
 */
export function fuseCandidates(
  keyword: Candidate[],
  vector: VectorCandidate[],
  options: FusionOptions = {},
): Candidate[] {
  const skipVectorOnly =
    keyword.length >= (options.minKeywordHitsToSkipVectorOnly ?? 1);
  const keywordIds = new Set(keyword.map((candidate) => candidate.chunkId));
  const merged = new Map<number, { candidate: Candidate; raw: number; via: HitVia }>();

  const add = (candidate: Candidate, rank: number, via: HitVia): void => {
    const gain = (via === "keyword" ? KEYWORD_WEIGHT : 1) / (RRF_K + rank + 1);
    const existing = merged.get(candidate.chunkId);
    if (!existing) {
      merged.set(candidate.chunkId, { candidate, raw: gain, via });
      return;
    }
    existing.raw += gain;
    existing.via = existing.via === via ? via : "both";
    if (via === "keyword") existing.candidate = candidate;
  };

  keyword.forEach((candidate, rank) => add(candidate, rank, "keyword"));
  vector.forEach((candidate, rank) => {
    if (skipVectorOnly && !keywordIds.has(candidate.chunkId)) return;
    add(candidate, rank, "vector");
  });

  const items = [...merged.values()];
  const maxRaw = Math.max(...items.map((item) => item.raw), 1e-9);
  return items
    .map(({ candidate, raw, via }) => ({
      chunkId: candidate.chunkId,
      hit: {
        ...candidate.hit,
        score: Number((raw / maxRaw).toFixed(3)),
        via,
      },
    }))
    .sort(
      (a, b) =>
        b.hit.score - a.hit.score ||
        a.hit.path.localeCompare(b.hit.path, "zh-CN") ||
        a.hit.startLine - b.hit.startLine,
    );
}

/**
 * 正文检索入口。默认 hybrid：关键词 + 本地向量，RRF 融合。
 * 向量模型不可用时自动退回关键词，不阻塞对话。
 */
export async function searchContent(
  db: Db,
  query: string,
  options: ContentSearchOptions = {},
): Promise<ContentSearchResult> {
  const mode = options.mode ?? "hybrid";
  const now = options.now ?? Date.now();
  const parsed = parseSearchQuery(query, now);
  const k = Math.max(1, Math.min(options.k ?? 5, 10));

  if (parsed.keywords.length === 0) {
    return { query, mode, interpreted: { keywords: [] }, hits: [] };
  }

  const keywords = parsed.keywords.map((keyword) => keyword.toLowerCase());
  const keyword = keywordCandidates(db, keywords, Math.max(k, 20));

  if (mode === "keyword") {
    return {
      query,
      mode,
      interpreted: { keywords: parsed.keywords },
      hits: keyword.slice(0, k).map((candidate) => candidate.hit),
    };
  }

  const vector = await searchVectorCandidates(db, parsed.keywords.join(" "), Math.max(k, 20));

  if (mode === "vector") {
    return {
      query,
      mode,
      interpreted: { keywords: parsed.keywords },
      hits: vector.slice(0, k).map((candidate) => candidate.hit),
    };
  }

  // 向量模型不可用时 vector 为空，融合结果就是纯关键词。
  const fused = fuseCandidates(keyword, vector);
  return {
    query,
    mode,
    interpreted: { keywords: parsed.keywords },
    hits: fused.slice(0, k).map((candidate) => candidate.hit),
  };
}
