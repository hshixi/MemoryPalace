import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import { transaction } from "./db.ts";

export type MemoryKind = "alias" | "preference" | "context" | "correction";

export const MEMORY_KINDS: MemoryKind[] = [
  "alias",
  "preference",
  "context",
  "correction",
];

export interface MemoryRecord {
  id: string;
  fact: string;
  kind: MemoryKind;
  sourceSession: string | null;
  confidence: number | null;
  hitCount: number;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** 热记忆上限；超出后先淘汰最久没用的 context。 */
export const MAX_MEMORY_FACTS = 50;
export const MAX_FACT_CHARS = 100;
const CONTEXT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface MemoryRow {
  id: string;
  fact: string;
  kind: string | null;
  source_session: string | null;
  confidence: number | null;
  hit_count: number | null;
  last_used_at: number | null;
  created_at: number | null;
  updated_at: number | null;
}

function toKind(value: string | null): MemoryKind {
  return MEMORY_KINDS.includes(value as MemoryKind)
    ? (value as MemoryKind)
    : "context";
}

function mapMemory(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    fact: row.fact,
    kind: toKind(row.kind),
    sourceSession: row.source_session,
    confidence: row.confidence,
    hitCount: row.hit_count ?? 0,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at ?? 0,
    updatedAt: row.updated_at ?? row.created_at ?? 0,
  };
}

/** 归一化：全角转半角、小写、去掉空白和标点，只留可比较的字符。 */
function normalizeFact(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function bigrams(text: string): Set<string> {
  const set = new Set<string>();
  if (text.length <= 1) {
    if (text) set.add(text);
    return set;
  }
  for (let i = 0; i < text.length - 1; i += 1) {
    set.add(text.slice(i, i + 2));
  }
  return set;
}

/** Dice 系数；中文按字符二元组比较，够了，不引分词器。 */
export function factSimilarity(a: string, b: string): number {
  const left = normalizeFact(a);
  const right = normalizeFact(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const aSet = bigrams(left);
  const bSet = bigrams(right);
  let overlap = 0;
  for (const gram of aSet) {
    if (bSet.has(gram)) overlap += 1;
  }
  return (2 * overlap) / (aSet.size + bSet.size);
}

export function listMemories(db: Db, limit = MAX_MEMORY_FACTS): MemoryRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM memory
       ORDER BY coalesce(last_used_at, updated_at, created_at) DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as MemoryRow[];
  return rows.map(mapMemory);
}

export function getMemory(db: Db, id: string): MemoryRecord | null {
  const row = db.prepare("SELECT * FROM memory WHERE id = ?").get(id) as
    | MemoryRow
    | undefined;
  return row ? mapMemory(row) : null;
}

/** 注入用的记忆：context 超过 30 天不再进 system，避免旧线索长期占位。 */
export function injectableMemories(db: Db, now = Date.now()): MemoryRecord[] {
  return listMemories(db).filter(
    (memory) =>
      memory.kind !== "context" || now - memory.updatedAt <= CONTEXT_TTL_MS,
  );
}

export function formatMemoryFacts(memories: MemoryRecord[]): string[] {
  return memories.map((memory) => `[${memory.kind}] ${memory.fact}`);
}

/** 兼容旧的调用点：直接给出注入行。 */
export function listMemoryFacts(db: Db, now = Date.now()): string[] {
  return formatMemoryFacts(injectableMemories(db, now));
}

export function findSimilarMemory(
  db: Db,
  fact: string,
  threshold = 0.85,
): MemoryRecord | null {
  const target = normalizeFact(fact);
  if (!target) return null;
  for (const memory of listMemories(db)) {
    const other = normalizeFact(memory.fact);
    if (other === target) return memory;
    if (factSimilarity(target, other) >= threshold) return memory;
  }
  return null;
}

export interface RememberInput {
  fact: string;
  kind?: MemoryKind;
  sourceSession?: string | null;
  confidence?: number;
}

/**
 * 显式写入：相似记忆直接合并（更新那条），不重复新增；超出 50 条先淘汰旧 context。
 */
export function rememberFact(
  db: Db,
  input: RememberInput,
): { memory: MemoryRecord; merged: boolean } {
  const fact = input.fact.trim().replace(/\s+/g, " ");
  if (!fact) throw new Error("记忆内容不能为空");
  const kind = input.kind ?? "context";
  const confidence = input.confidence ?? 0.9;
  const sourceSession = input.sourceSession ?? null;
  const now = Date.now();

  const similar = findSimilarMemory(db, fact);
  if (similar) {
    db.prepare(
      `UPDATE memory
       SET fact = ?, kind = ?, confidence = ?, source_session = coalesce(?, source_session), updated_at = ?
       WHERE id = ?`,
    ).run(fact, kind, confidence, sourceSession, now, similar.id);
    return { memory: getMemory(db, similar.id)!, merged: true };
  }

  const id = `mem_${randomUUID()}`;
  transaction(db, () => {
    db.prepare(
      `INSERT INTO memory (id, fact, kind, source_session, confidence, hit_count, last_used_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    ).run(id, fact, kind, sourceSession, confidence, now, now, now);
    enforceLimit(db, id);
  });
  return { memory: getMemory(db, id)!, merged: false };
}

function enforceLimit(db: Db, protectId: string): void {
  const count = (
    db.prepare("SELECT count(*) AS c FROM memory").get() as { c: number }
  ).c;
  if (count <= MAX_MEMORY_FACTS) return;
  // 刚写入的这条不参与淘汰，否则「新增一条 context」可能立刻被自己挤掉。
  db.prepare(
    `DELETE FROM memory WHERE id IN (
       SELECT id FROM memory
       WHERE id <> ?
       ORDER BY CASE WHEN kind = 'context' THEN 0 ELSE 1 END,
                coalesce(last_used_at, updated_at, created_at) ASC
       LIMIT ?
     )`,
  ).run(protectId, count - MAX_MEMORY_FACTS);
}

export function removeMemory(db: Db, id: string): boolean {
  const result = db.prepare("DELETE FROM memory WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}

/** 会话开始时标记哪些记忆被注入了。 */
export function touchMemories(db: Db, ids: string[], now = Date.now()): void {
  if (ids.length === 0) return;
  const statement = db.prepare(
    "UPDATE memory SET hit_count = hit_count + 1, last_used_at = ? WHERE id = ?",
  );
  for (const id of ids) statement.run(now, id);
}
