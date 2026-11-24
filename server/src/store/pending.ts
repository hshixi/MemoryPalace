import type { Db } from "./db.ts";

export type PendingStatus = "pending" | "allowed" | "denied" | "expired" | "aborted";

export interface PendingRecord {
  id: string;
  sessionId: string | null;
  toolCallId: string | null;
  tool: string | null;
  argsJson: string | null;
  previewJson: string | null;
  status: PendingStatus;
  createdAt: number;
  expiresAt: number | null;
  resolvedAt: number | null;
}

interface PendingRow {
  id: string;
  session_id: string | null;
  tool_call_id: string | null;
  tool: string | null;
  args_json: string | null;
  preview_json: string | null;
  status: string;
  created_at: number;
  expires_at: number | null;
  resolved_at: number | null;
}

function mapPending(row: PendingRow): PendingRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    toolCallId: row.tool_call_id,
    tool: row.tool,
    argsJson: row.args_json,
    previewJson: row.preview_json,
    status: row.status as PendingStatus,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
  };
}

export function createPending(
  db: Db,
  input: {
    id: string;
    sessionId: string;
    toolCallId: string;
    tool: string;
    args: unknown;
    preview: unknown;
    expiresAt: number;
  },
): void {
  db.prepare(
    `INSERT INTO pending_actions
       (id, session_id, tool_call_id, tool, args_json, preview_json, status, created_at, expires_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)`,
  ).run(
    input.id,
    input.sessionId,
    input.toolCallId,
    input.tool,
    JSON.stringify(input.args),
    JSON.stringify(input.preview),
    Date.now(),
    input.expiresAt,
  );
}

export function getPending(db: Db, id: string): PendingRecord | null {
  const row = db.prepare("SELECT * FROM pending_actions WHERE id = ?").get(id) as
    | PendingRow
    | undefined;
  return row ? mapPending(row) : null;
}

export function resolvePending(db: Db, id: string, status: PendingStatus): void {
  db.prepare(
    "UPDATE pending_actions SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'",
  ).run(status, Date.now(), id);
}
