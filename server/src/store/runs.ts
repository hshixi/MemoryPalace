import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";

export type RunStatus = "running" | "done" | "failed";

export interface IndexRun {
  id: string;
  root: string;
  status: RunStatus;
  filesSeen: number;
  filesIndexed: number;
  filesExcluded: number;
  errorsJson: string | null;
  startedAt: number;
  finishedAt: number | null;
}

interface RunRow {
  id: string;
  root: string;
  status: RunStatus;
  files_seen: number;
  files_indexed: number;
  files_excluded: number;
  errors_json: string | null;
  started_at: number;
  finished_at: number | null;
}

function mapRun(row: RunRow): IndexRun {
  return {
    id: row.id,
    root: row.root,
    status: row.status,
    filesSeen: row.files_seen,
    filesIndexed: row.files_indexed,
    filesExcluded: row.files_excluded,
    errorsJson: row.errors_json,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function createRun(db: Db, root: string): IndexRun {
  const id = `run_${randomUUID()}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO index_runs (id, root, status, files_seen, files_indexed, files_excluded, errors_json, started_at)
     VALUES (?, ?, 'running', 0, 0, 0, NULL, ?)`,
  ).run(id, root, now);
  return {
    id,
    root,
    status: "running",
    filesSeen: 0,
    filesIndexed: 0,
    filesExcluded: 0,
    errorsJson: null,
    startedAt: now,
    finishedAt: null,
  };
}

export function updateRunProgress(
  db: Db,
  id: string,
  counts: { filesSeen: number; filesIndexed: number; filesExcluded: number },
): void {
  db.prepare(
    `UPDATE index_runs
     SET files_seen = ?, files_indexed = ?, files_excluded = ?
     WHERE id = ?`,
  ).run(counts.filesSeen, counts.filesIndexed, counts.filesExcluded, id);
}

export function finishRun(
  db: Db,
  id: string,
  counts: { filesSeen: number; filesIndexed: number; filesExcluded: number; errors: string[] },
): void {
  db.prepare(
    `UPDATE index_runs
     SET status = 'done', files_seen = ?, files_indexed = ?, files_excluded = ?,
         errors_json = ?, finished_at = ?
     WHERE id = ?`,
  ).run(
    counts.filesSeen,
    counts.filesIndexed,
    counts.filesExcluded,
    counts.errors.length ? JSON.stringify(counts.errors) : null,
    Date.now(),
    id,
  );
}

export function failRun(db: Db, id: string, message: string): void {
  db.prepare(
    `UPDATE index_runs
     SET status = 'failed', errors_json = ?, finished_at = ?
     WHERE id = ?`,
  ).run(JSON.stringify([message]), Date.now(), id);
}

export function getRun(db: Db, id: string): IndexRun | null {
  const row = db.prepare("SELECT * FROM index_runs WHERE id = ?").get(id) as
    | RunRow
    | undefined;
  return row ? mapRun(row) : null;
}

export function getLastRun(db: Db): IndexRun | null {
  const row = db.prepare(
    "SELECT * FROM index_runs ORDER BY started_at DESC LIMIT 1",
  ).get() as RunRow | undefined;
  return row ? mapRun(row) : null;
}

export function markInterruptedRuns(db: Db): void {
  db.prepare(
    `UPDATE index_runs
     SET status = 'failed', finished_at = ?, errors_json = ?
     WHERE status = 'running'`,
  ).run(Date.now(), JSON.stringify(["服务重启，索引任务已中断"]));
}
