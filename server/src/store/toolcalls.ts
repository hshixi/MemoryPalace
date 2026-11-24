import type { Db } from "./db.ts";

export interface ToolCallRecord {
  id: string;
  sessionId: string;
  turn: number;
  name: string;
  args: unknown;
  result: unknown;
  ok: boolean;
  errorCode: string | null;
  durationMs: number;
  createdAt: number;
}

interface ToolCallRow {
  id: string;
  session_id: string;
  turn: number;
  name: string;
  args_json: string;
  result_json: string | null;
  ok: number | null;
  error_code: string | null;
  duration_ms: number | null;
  created_at: number;
}

export function recordToolCall(
  db: Db,
  input: {
    id: string;
    sessionId: string;
    turn: number;
    name: string;
    args: unknown;
    result: unknown;
    ok: boolean;
    errorCode?: string | null;
    durationMs: number;
  },
): void {
  db.prepare(
    `INSERT OR REPLACE INTO tool_calls
       (id, session_id, turn, name, args_json, result_json, ok, error_code, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.sessionId,
    input.turn,
    input.name,
    JSON.stringify(input.args ?? null),
    JSON.stringify(input.result ?? null),
    input.ok ? 1 : 0,
    input.errorCode ?? null,
    input.durationMs,
    Date.now(),
  );
}

export function listToolCalls(db: Db, sessionId: string): ToolCallRecord[] {
  const rows = db
    .prepare("SELECT * FROM tool_calls WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as unknown as ToolCallRow[];
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    turn: row.turn,
    name: row.name,
    args: row.args_json ? (JSON.parse(row.args_json) as unknown) : null,
    result: row.result_json ? (JSON.parse(row.result_json) as unknown) : null,
    ok: row.ok === 1,
    errorCode: row.error_code,
    durationMs: row.duration_ms ?? 0,
    createdAt: row.created_at,
  }));
}
