import type { Config } from "../config.ts";
import type { Db } from "../store/db.ts";
import { countFiles } from "../store/files.ts";
import { listRecentQueries } from "../store/queries.ts";
import { getLastRun, type IndexRun } from "../store/runs.ts";
import {
  formatBytes,
  formatMonthDay,
  formatRelativeTime,
  shortenHome,
} from "../util/format.ts";
import { startOfWeek } from "../util/time.ts";
import { kindLabel, type FileKind } from "./kinds.ts";
import type { IndexService } from "./service.ts";
import { buildTopics, type Topic, type TopicEdge } from "./topics.ts";

export interface OverviewActivity {
  label: string;
  value: number;
}

export interface OverviewType {
  label: string;
  value: number;
}

export interface OverviewRecentQuery {
  id: string;
  query: string;
  results: number;
  time: string;
}

export interface OverviewLastRun {
  id: string;
  status: string;
  filesIndexed: number;
  excluded: number;
  durationMs: number | null;
  errorCount: number;
}

export interface Overview {
  workspace: {
    path: string;
    displayName: string;
    fileCount: number;
    totalBytes: number;
    sizeLabel: string;
    topicCount: number;
    lastIndexedAt: number | null;
    lastIndexedLabel: string;
    status: "empty" | "indexing" | "ready";
  };
  index: {
    status: "empty" | "indexing" | "ready";
    runId: string | null;
    filesSeen: number;
    filesIndexed: number;
    filesExcluded: number;
  };
  topics: Topic[];
  edges: TopicEdge[];
  activity: OverviewActivity[];
  types: OverviewType[];
  recentQueries: OverviewRecentQuery[];
  lastRun: OverviewLastRun | null;
}

interface KindCountRow {
  kind: FileKind;
  count: number;
}

interface MtimeRow {
  mtime_ms: number;
}

const DAY = 86_400_000;
const WEEK = 7 * DAY;

function buildActivity(db: Db, now: number): OverviewActivity[] {
  const currentWeek = startOfWeek(now);
  const firstWeek = currentWeek - 7 * WEEK;
  const buckets = new Array<number>(8).fill(0);

  const rows = db
    .prepare("SELECT mtime_ms FROM files WHERE mtime_ms >= ?")
    .all(firstWeek) as unknown as MtimeRow[];

  for (const row of rows) {
    const index = Math.floor((row.mtime_ms - firstWeek) / WEEK);
    if (index >= 0 && index < buckets.length) buckets[index] += 1;
  }

  return buckets.map((value, index) => ({
    label: formatMonthDay(firstWeek + index * WEEK),
    value,
  }));
}

function buildTypes(db: Db): OverviewType[] {
  const rows = db
    .prepare("SELECT kind, count(*) AS count FROM files GROUP BY kind ORDER BY count DESC")
    .all() as unknown as KindCountRow[];
  return rows.map((row) => ({ label: kindLabel(row.kind), value: row.count }));
}

function lastIndexedAt(db: Db, run: IndexRun | null): number | null {
  if (run?.finishedAt) return run.finishedAt;
  const row = db.prepare("SELECT max(mtime_ms) AS last FROM files").get() as {
    last: number | null;
  };
  return row.last ?? null;
}

function mapLastRun(run: IndexRun | null): OverviewLastRun | null {
  if (!run) return null;
  let errorCount = 0;
  if (run.errorsJson) {
    try {
      const errors = JSON.parse(run.errorsJson) as unknown;
      errorCount = Array.isArray(errors) ? errors.length : 0;
    } catch {
      errorCount = 1;
    }
  }
  return {
    id: run.id,
    status: run.status,
    filesIndexed: run.filesIndexed,
    excluded: run.filesExcluded,
    durationMs: run.finishedAt ? run.finishedAt - run.startedAt : null,
    errorCount,
  };
}

export function buildOverview(db: Db, config: Config, indexService: IndexService): Overview {
  const now = Date.now();
  const files = countFiles(db);
  const run = getLastRun(db);
  const status: "empty" | "indexing" | "ready" = indexService.isRunning()
    ? "indexing"
    : files > 0
      ? "ready"
      : "empty";

  const sum = db
    .prepare("SELECT coalesce(sum(size_bytes), 0) AS total FROM files")
    .get() as { total: number };

  const { topics, edges } = buildTopics(db);
  const indexedAt = lastIndexedAt(db, run);

  return {
    workspace: {
      path: shortenHome(config.workspaceRoot),
      displayName: config.workspaceDisplayName,
      fileCount: files,
      totalBytes: sum.total,
      sizeLabel: formatBytes(sum.total),
      topicCount: topics.length,
      lastIndexedAt: indexedAt,
      lastIndexedLabel: indexedAt ? formatRelativeTime(indexedAt, now) : "尚未索引",
      status,
    },
    index: {
      status,
      runId: indexService.currentRunId(),
      filesSeen: run?.filesSeen ?? 0,
      filesIndexed: run?.filesIndexed ?? 0,
      filesExcluded: run?.filesExcluded ?? 0,
    },
    topics,
    edges,
    activity: buildActivity(db, now),
    types: buildTypes(db),
    recentQueries: listRecentQueries(db).map((query) => ({
      id: query.id,
      query: query.query,
      results: query.results,
      time: formatRelativeTime(query.createdAt, now),
    })),
    lastRun: mapLastRun(run),
  };
}
