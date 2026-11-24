import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspace_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS index_runs (
  id TEXT PRIMARY KEY,
  root TEXT NOT NULL,
  status TEXT NOT NULL,
  files_seen INTEGER NOT NULL DEFAULT 0,
  files_indexed INTEGER NOT NULL DEFAULT 0,
  files_excluded INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rel_path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  ext TEXT NOT NULL,
  kind TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  ctime_ms INTEGER,
  parent_path TEXT NOT NULL,
  depth INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS files_parent_idx ON files(parent_path);
CREATE INDEX IF NOT EXISTS files_kind_idx ON files(kind);
CREATE INDEX IF NOT EXISTS files_mtime_idx ON files(mtime_ms);

CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
  name,
  rel_path,
  content='files',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  text TEXT NOT NULL,
  loc_kind TEXT NOT NULL DEFAULT 'line',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_file_idx ON chunks(file_id);
CREATE INDEX IF NOT EXISTS chunks_path_idx ON chunks(rel_path);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  content='chunks',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TABLE IF NOT EXISTS chunk_vectors (
  chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chunk_vectors_model_idx ON chunk_vectors(model);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  workspace_root TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL,
  static_prefix_hash TEXT,
  memory_snapshot_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  role TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_session_idx ON messages(session_id, turn, created_at);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  name TEXT NOT NULL,
  args_json TEXT NOT NULL,
  result_json TEXT,
  ok INTEGER,
  error_code TEXT,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS traces (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  turn INTEGER,
  call_index INTEGER,
  model TEXT NOT NULL,
  prompt_hash TEXT,
  usage_json TEXT,
  finish_reason TEXT,
  latency_ms INTEGER,
  cost_usd REAL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  session_id TEXT,
  turn INTEGER,
  tool TEXT NOT NULL,
  args_json TEXT,
  decision TEXT NOT NULL,
  result TEXT,
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS queries (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  text TEXT NOT NULL,
  result_count INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory (
  id TEXT PRIMARY KEY,
  fact TEXT NOT NULL,
  kind TEXT,
  source_session TEXT,
  confidence REAL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS pending_actions (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  tool_call_id TEXT,
  tool TEXT,
  args_json TEXT,
  preview_json TEXT,
  status TEXT,
  created_at INTEGER,
  expires_at INTEGER,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS runtime_snapshots (
  session_id TEXT PRIMARY KEY,
  history_json TEXT,
  resolved_json TEXT,
  pending_json TEXT,
  usage_json TEXT,
  turn INTEGER,
  created_at INTEGER,
  expires_at INTEGER
);

PRAGMA user_version = 4;
`;

export function openDatabase(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  migrate(db);
  ensureFts(db);
  ensureChunksFts(db);
  return db;
}

/** 轻量迁移：只加列，不删不改，旧库直接升级。 */
function migrate(db: Db): void {
  const columns = (table: string): Set<string> => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{
      name: string;
    }>;
    return new Set(rows.map((row) => row.name));
  };
  const addColumn = (table: string, column: string, ddl: string): void => {
    if (!columns(table).has(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  };

  addColumn("memory", "confidence", "confidence REAL");
  addColumn("memory", "hit_count", "hit_count INTEGER NOT NULL DEFAULT 0");
  addColumn("memory", "last_used_at", "last_used_at INTEGER");
  addColumn("sessions", "memory_snapshot_json", "memory_snapshot_json TEXT");
  addColumn("chunks", "loc_kind", "loc_kind TEXT NOT NULL DEFAULT 'line'");
}

function ensureFts(db: Db): void {
  const files = db.prepare("SELECT count(*) AS c FROM files").get() as { c: number };
  const fts = db.prepare("SELECT count(*) AS c FROM files_fts").get() as { c: number };
  if (files.c !== fts.c) {
    db.exec("INSERT INTO files_fts(files_fts) VALUES('rebuild')");
  }
}

function ensureChunksFts(db: Db): void {
  const chunks = db.prepare("SELECT count(*) AS c FROM chunks").get() as { c: number };
  const fts = db.prepare("SELECT count(*) AS c FROM chunks_fts").get() as { c: number };
  if (chunks.c !== fts.c) {
    db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')");
  }
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // 忽略回滚失败，保留原始错误。
    }
    throw error;
  }
}

export function closeDatabase(db: Db): void {
  try {
    db.close();
  } catch {
    // 已经关闭时忽略。
  }
}
