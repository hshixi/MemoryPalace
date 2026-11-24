import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";

export interface MemorySnapshotEntry {
  id: string;
  kind: string;
  fact: string;
}

export interface SessionRecord {
  id: string;
  workspaceRoot: string;
  title: string | null;
  status: string;
  staticPrefixHash: string | null;
  /** 会话开始时的记忆快照；新写入的记忆靠工具结果进历史，不改 system。 */
  memorySnapshot: MemorySnapshotEntry[] | null;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
}

interface SessionRow {
  id: string;
  workspace_root: string;
  title: string | null;
  status: string;
  static_prefix_hash: string | null;
  memory_snapshot_json: string | null;
  created_at: number;
  updated_at: number;
  message_count?: number;
}

function parseSnapshot(text: string | null): MemorySnapshotEntry[] | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter(
        (entry): entry is MemorySnapshotEntry =>
          Boolean(entry) &&
          typeof entry === "object" &&
          typeof (entry as MemorySnapshotEntry).id === "string" &&
          typeof (entry as MemorySnapshotEntry).fact === "string",
      )
      .map((entry) => ({
        id: entry.id,
        kind: typeof entry.kind === "string" ? entry.kind : "context",
        fact: entry.fact,
      }));
  } catch {
    return null;
  }
}

function mapSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    workspaceRoot: row.workspace_root,
    title: row.title,
    status: row.status,
    staticPrefixHash: row.static_prefix_hash,
    memorySnapshot: parseSnapshot(row.memory_snapshot_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.message_count === undefined ? {} : { messageCount: row.message_count }),
  };
}

export function createSession(
  db: Db,
  input: {
    workspaceRoot: string;
    title?: string | null;
    memorySnapshot?: MemorySnapshotEntry[];
  },
): SessionRecord {
  const id = `sess_${randomUUID()}`;
  const now = Date.now();
  const title = input.title?.trim().slice(0, 60) || null;
  const snapshot = input.memorySnapshot ?? null;
  db.prepare(
    `INSERT INTO sessions (id, workspace_root, title, status, static_prefix_hash, memory_snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, 'active', NULL, ?, ?, ?)`,
  ).run(id, input.workspaceRoot, title, snapshot ? JSON.stringify(snapshot) : null, now, now);
  return {
    id,
    workspaceRoot: input.workspaceRoot,
    title,
    status: "active",
    staticPrefixHash: null,
    memorySnapshot: snapshot,
    createdAt: now,
    updatedAt: now,
  };
}

export function setSessionMemorySnapshot(
  db: Db,
  id: string,
  snapshot: MemorySnapshotEntry[],
): void {
  db.prepare("UPDATE sessions SET memory_snapshot_json = ? WHERE id = ?").run(
    JSON.stringify(snapshot),
    id,
  );
}

export function getSession(db: Db, id: string): SessionRecord | null {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
    | SessionRow
    | undefined;
  return row ? mapSession(row) : null;
}

export function listSessions(db: Db, limit = 50): SessionRecord[] {
  const rows = db
    .prepare(
      `SELECT s.*, (SELECT count(*) FROM messages m WHERE m.session_id = s.id) AS message_count
       FROM sessions s
       ORDER BY s.updated_at DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as SessionRow[];
  return rows.map(mapSession);
}

export function touchSession(db: Db, id: string, title?: string): void {
  if (title) {
    db.prepare("UPDATE sessions SET updated_at = ?, title = coalesce(title, ?) WHERE id = ?").run(
      Date.now(),
      title.trim().slice(0, 60),
      id,
    );
  } else {
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(Date.now(), id);
  }
}

export function setSessionPrefixHash(db: Db, id: string, hash: string): void {
  db.prepare("UPDATE sessions SET static_prefix_hash = ? WHERE id = ?").run(hash, id);
}
