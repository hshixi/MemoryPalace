import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";

export interface TraceUsage {
  prompt: number;
  cached: number;
  completion: number;
  reasoning?: number;
}

export interface TraceRecord {
  id: string;
  sessionId: string | null;
  turn: number | null;
  callIndex: number | null;
  model: string;
  promptHash: string | null;
  usage: TraceUsage;
  finishReason: string | null;
  latencyMs: number;
  costUsd: number;
  createdAt: number;
}

interface TraceRow {
  id: string;
  session_id: string | null;
  turn: number | null;
  call_index: number | null;
  model: string;
  prompt_hash: string | null;
  usage_json: string | null;
  finish_reason: string | null;
  latency_ms: number | null;
  cost_usd: number | null;
  created_at: number;
}

export function recordTrace(
  db: Db,
  input: {
    sessionId: string | null;
    turn: number | null;
    callIndex: number;
    model: string;
    promptHash: string;
    usage: TraceUsage;
    finishReason: string;
    latencyMs: number;
    costUsd: number;
  },
): TraceRecord {
  const id = `tr_${randomUUID()}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO traces
       (id, session_id, turn, call_index, model, prompt_hash, usage_json, finish_reason, latency_ms, cost_usd, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.sessionId,
    input.turn,
    input.callIndex,
    input.model,
    input.promptHash,
    JSON.stringify(input.usage),
    input.finishReason,
    input.latencyMs,
    input.costUsd,
    now,
  );
  return {
    id,
    sessionId: input.sessionId,
    turn: input.turn,
    callIndex: input.callIndex,
    model: input.model,
    promptHash: input.promptHash,
    usage: input.usage,
    finishReason: input.finishReason,
    latencyMs: input.latencyMs,
    costUsd: input.costUsd,
    createdAt: now,
  };
}

export function listTraces(db: Db, limit = 20): TraceRecord[] {
  const rows = db
    .prepare("SELECT * FROM traces ORDER BY created_at DESC LIMIT ?")
    .all(limit) as unknown as TraceRow[];
  return rows.map((row) => {
    let usage: TraceUsage = { prompt: 0, cached: 0, completion: 0 };
    if (row.usage_json) {
      try {
        usage = JSON.parse(row.usage_json) as TraceUsage;
      } catch {
        // 保留默认值。
      }
    }
    return {
      id: row.id,
      sessionId: row.session_id,
      turn: row.turn,
      callIndex: row.call_index,
      model: row.model,
      promptHash: row.prompt_hash,
      usage,
      finishReason: row.finish_reason,
      latencyMs: row.latency_ms ?? 0,
      costUsd: row.cost_usd ?? 0,
      createdAt: row.created_at,
    };
  });
}
