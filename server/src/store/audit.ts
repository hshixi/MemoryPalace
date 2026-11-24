import type { Db } from "./db.ts";
import { redactObject } from "../policy/redact.ts";

export interface AuditEntry {
  sessionId?: string;
  turn?: number;
  tool: string;
  args?: unknown;
  decision: "allow" | "deny" | "confirm";
  result: string;
  durationMs?: number;
}

export interface AuditRecord {
  id: number;
  ts: number;
  sessionId: string | null;
  turn: number | null;
  tool: string;
  args: unknown;
  decision: string;
  result: string | null;
  durationMs: number | null;
}

interface AuditRow {
  id: number;
  ts: number;
  session_id: string | null;
  turn: number | null;
  tool: string;
  args_json: string | null;
  decision: string;
  result: string | null;
  duration_ms: number | null;
}

export function recordAudit(db: Db, entry: AuditEntry): void {
  const args = entry.args === undefined ? null : JSON.stringify(redactObject(entry.args));
  db.prepare(
    `INSERT INTO audit_log (ts, session_id, turn, tool, args_json, decision, result, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    Date.now(),
    entry.sessionId ?? null,
    entry.turn ?? null,
    entry.tool,
    args,
    entry.decision,
    entry.result,
    entry.durationMs ?? null,
  );
}

export function listAudit(db: Db, limit = 20): AuditRecord[] {
  const rows = db
    .prepare("SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?")
    .all(limit) as unknown as AuditRow[];
  return rows.map((row) => {
    let args: unknown = null;
    if (row.args_json) {
      try {
        args = JSON.parse(row.args_json);
      } catch {
        args = row.args_json;
      }
    }
    return {
      id: row.id,
      ts: row.ts,
      sessionId: row.session_id,
      turn: row.turn,
      tool: row.tool,
      args,
      decision: row.decision,
      result: row.result,
      durationMs: row.duration_ms,
    };
  });
}
