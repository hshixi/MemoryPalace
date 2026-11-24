import { createHash } from "node:crypto";
import type { Db } from "../store/db.ts";
import { mapFile, type FileRecord } from "../store/files.ts";
import { formatBytes, formatRelativeTime } from "../util/format.ts";
import { kindLabel, type FileKind } from "./kinds.ts";

const TOPIC_EXPR =
  "CASE WHEN instr(rel_path, '/') > 0 THEN substr(rel_path, 1, instr(rel_path, '/') - 1) ELSE '未归类' END";

export interface TopicKind {
  label: string;
  count: number;
  pct: number;
}

export interface TopicFile {
  id: number;
  name: string;
  path: string;
  kind: FileKind;
  ext: string;
  sizeBytes: number;
  sizeLabel: string;
  modifiedAt: number;
  modifiedLabel: string;
}

export interface TopicEdge {
  a: string;
  b: string;
  weight: number;
  reason: string;
}

export interface TopicRelated {
  topicId: string;
  reason: string;
  weight: number;
}

export interface Topic {
  id: string;
  name: string;
  count: number;
  sizeBytes: number;
  lastModifiedAt: number;
  blurb: string;
  kinds: TopicKind[];
  related: TopicRelated[];
  files: TopicFile[];
}

interface TopicAggRow {
  topic: string;
  count: number;
  total: number;
  last: number;
}

interface KindCountRow {
  kind: FileKind;
  count: number;
}

interface ExtCountRow {
  topic: string;
  ext: string;
  count: number;
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

function topicId(name: string): string {
  const hash = createHash("sha1").update(name).digest("hex").slice(0, 10);
  return `t_${hash}`;
}

function toTopicFile(file: FileRecord, now: number): TopicFile {
  return {
    id: file.id,
    name: file.name,
    path: file.relPath,
    kind: file.kind,
    ext: file.ext,
    sizeBytes: file.sizeBytes,
    sizeLabel: formatBytes(file.sizeBytes),
    modifiedAt: file.mtimeMs,
    modifiedLabel: formatRelativeTime(file.mtimeMs, now),
  };
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const value of a.values()) normA += value * value;
  for (const value of b.values()) normB += value * value;
  if (normA === 0 || normB === 0) return 0;
  for (const [key, value] of a) {
    dot += value * (b.get(key) ?? 0);
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface TopicsResult {
  topics: Topic[];
  edges: TopicEdge[];
}

export function buildTopics(db: Db, options: { filesPerTopic?: number; now?: number } = {}): TopicsResult {
  const now = options.now ?? Date.now();
  const filesPerTopic = options.filesPerTopic ?? 6;

  const aggRows = db
    .prepare(
      `SELECT ${TOPIC_EXPR} AS topic,
              count(*) AS count,
              coalesce(sum(size_bytes), 0) AS total,
              max(mtime_ms) AS last
       FROM files
       GROUP BY topic
       ORDER BY count DESC, topic ASC`,
    )
    .all() as unknown as TopicAggRow[];

  const topics: Topic[] = [];
  const extVectors = new Map<string, Map<string, number>>();
  const recentShare = new Map<string, number>();

  for (const agg of aggRows) {
    const id = topicId(agg.topic);

    const kindRows = db
      .prepare(
        `SELECT kind, count(*) AS count
         FROM files
         WHERE (${TOPIC_EXPR}) = ?
         GROUP BY kind
         ORDER BY count DESC`,
      )
      .all(agg.topic) as unknown as KindCountRow[];

    const kinds: TopicKind[] = kindRows.slice(0, 3).map((row) => ({
      label: kindLabel(row.kind),
      count: row.count,
      pct: Math.round((row.count / agg.count) * 100),
    }));

    const fileRows = db
      .prepare(
        `SELECT * FROM files
         WHERE (${TOPIC_EXPR}) = ?
         ORDER BY mtime_ms DESC
         LIMIT ?`,
      )
      .all(agg.topic, filesPerTopic) as unknown as FileRow[];

    const files = fileRows.map((row) => toTopicFile(mapFile(row), now));
    const primary = kinds[0]?.label ?? "其他";

    topics.push({
      id,
      name: agg.topic,
      count: agg.count,
      sizeBytes: agg.total,
      lastModifiedAt: agg.last,
      blurb: `${agg.count.toLocaleString("zh-CN")} 个文件 · 主要是${primary} · 最近修改 ${formatRelativeTime(
        agg.last,
        now,
      )}`,
      kinds,
      related: [],
      files,
    });

    const extRows = db
      .prepare(
        `SELECT ext, count(*) AS count
         FROM files
         WHERE (${TOPIC_EXPR}) = ?
         GROUP BY ext`,
      )
      .all(agg.topic) as unknown as Array<{ ext: string; count: number }>;
    extVectors.set(id, new Map(extRows.map((row) => [row.ext, row.count])));

    const recentRows = db
      .prepare(
        `SELECT count(*) AS count
         FROM files
         WHERE (${TOPIC_EXPR}) = ? AND mtime_ms >= ?`,
      )
      .get(agg.topic, now - 28 * 86_400_000) as { count: number };
    recentShare.set(id, agg.count > 0 ? recentRows.count / agg.count : 0);
  }

  const edges: TopicEdge[] = [];
  for (let i = 0; i < topics.length; i += 1) {
    for (let j = i + 1; j < topics.length; j += 1) {
      const a = topics[i];
      const b = topics[j];
      const sim = cosine(extVectors.get(a.id) ?? new Map(), extVectors.get(b.id) ?? new Map());
      const bothRecent =
        (recentShare.get(a.id) ?? 0) >= 0.2 && (recentShare.get(b.id) ?? 0) >= 0.2;

      let weight = 0;
      let reason = "";
      if (sim >= 0.55) {
        weight = sim;
        reason = "文件类型接近";
      } else if (bothRecent && sim >= 0.25) {
        weight = 0.3 + sim * 0.3;
        reason = "最近都在改";
      }
      if (weight > 0) {
        edges.push({ a: a.id, b: b.id, weight: Number(weight.toFixed(2)), reason });
      }
    }
  }

  // 每个主题最多保留两条最强的边，避免地图变成一团毛线。
  edges.sort((x, y) => y.weight - x.weight);
  const perTopic = new Map<string, number>();
  const kept: TopicEdge[] = [];
  for (const edge of edges) {
    const countA = perTopic.get(edge.a) ?? 0;
    const countB = perTopic.get(edge.b) ?? 0;
    if (countA >= 2 || countB >= 2) continue;
    kept.push(edge);
    perTopic.set(edge.a, countA + 1);
    perTopic.set(edge.b, countB + 1);
  }

  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  for (const edge of kept) {
    byId.get(edge.a)?.related.push({
      topicId: edge.b,
      reason: edge.reason,
      weight: edge.weight,
    });
    byId.get(edge.b)?.related.push({
      topicId: edge.a,
      reason: edge.reason,
      weight: edge.weight,
    });
  }

  return { topics, edges: kept };
}

export function listExtCounts(db: Db): ExtCountRow[] {
  return db
    .prepare(`SELECT ${TOPIC_EXPR} AS topic, ext, count(*) AS count FROM files GROUP BY topic, ext`)
    .all() as unknown as ExtCountRow[];
}
