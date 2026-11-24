import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";

export interface RecentQuery {
  id: string;
  query: string;
  results: number;
  createdAt: number;
}

interface QueryRow {
  id: string;
  session_id: string | null;
  text: string;
  result_count: number | null;
  created_at: number;
}

export function recordQuery(
  db: Db,
  input: { text: string; sessionId?: string; resultCount?: number },
): string {
  const id = `q_${randomUUID()}`;
  db.prepare(
    `INSERT INTO queries (id, session_id, text, result_count, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.sessionId ?? null, input.text, input.resultCount ?? 0, Date.now());
  return id;
}

export function updateQueryResultCount(db: Db, id: string, count: number): void {
  db.prepare("UPDATE queries SET result_count = ? WHERE id = ?").run(count, id);
}

export function listRecentQueries(db: Db, limit = 4): RecentQuery[] {
  const rows = db
    .prepare("SELECT * FROM queries ORDER BY created_at DESC LIMIT ?")
    .all(limit) as unknown as QueryRow[];
  return rows.map((row) => ({
    id: row.id,
    query: row.text,
    results: row.result_count ?? 0,
    createdAt: row.created_at,
  }));
}
