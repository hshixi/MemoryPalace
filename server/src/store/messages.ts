import { randomUUID } from "node:crypto";
import type { ProviderToolCall } from "../model/types.ts";
import type { Db } from "./db.ts";

export type StoredRole = "user" | "assistant" | "tool";

export interface StoredContent {
  text: string;
  toolCalls?: ProviderToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface MessageRecord {
  id: string;
  sessionId: string;
  turn: number;
  role: StoredRole;
  content: StoredContent;
  createdAt: number;
}

interface MessageRow {
  id: string;
  session_id: string;
  turn: number;
  role: StoredRole;
  content_json: string;
  created_at: number;
}

function mapMessage(row: MessageRow): MessageRecord {
  let content: StoredContent;
  try {
    content = JSON.parse(row.content_json) as StoredContent;
  } catch {
    content = { text: row.content_json };
  }
  return {
    id: row.id,
    sessionId: row.session_id,
    turn: row.turn,
    role: row.role,
    content,
    createdAt: row.created_at,
  };
}

export function appendMessage(
  db: Db,
  input: { sessionId: string; turn: number; role: StoredRole; content: StoredContent },
): MessageRecord {
  const id = `msg_${randomUUID()}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO messages (id, session_id, turn, role, content_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.sessionId, input.turn, input.role, JSON.stringify(input.content), now);
  return {
    id,
    sessionId: input.sessionId,
    turn: input.turn,
    role: input.role,
    content: input.content,
    createdAt: now,
  };
}

export function listSessionMessages(db: Db, sessionId: string): MessageRecord[] {
  const rows = db
    .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY turn ASC, created_at ASC")
    .all(sessionId) as unknown as MessageRow[];
  return rows.map(mapMessage);
}

export function nextTurn(db: Db, sessionId: string): number {
  const row = db
    .prepare("SELECT coalesce(max(turn), 0) AS turn FROM messages WHERE session_id = ?")
    .get(sessionId) as { turn: number };
  return row.turn + 1;
}
