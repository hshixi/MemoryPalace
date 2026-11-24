import type { Db } from "../store/db.ts";
import type { FileRecord } from "../store/files.ts";
import { mapFile } from "../store/files.ts";
import { formatBytes, formatRelativeTime } from "../util/format.ts";
import { inRange, parseTimeHint, type TimeRange } from "../util/time.ts";
import type { FileKind } from "./kinds.ts";

export interface SearchFile {
  id: number;
  name: string;
  path: string;
  kind: FileKind;
  ext: string;
  sizeBytes: number;
  sizeLabel: string;
  modifiedAt: number;
  modifiedLabel: string;
  score: number;
  match: string[];
}

export interface SearchInterpretation {
  keywords: string[];
  type: string | null;
  timeLabel: string | null;
  modifiedAfter: string | null;
  modifiedBefore: string | null;
}

export interface SearchResult {
  query: string;
  interpreted: SearchInterpretation;
  files: SearchFile[];
}

export interface SearchOptions {
  k?: number;
  type?: string;
  modifiedAfter?: number;
  modifiedBefore?: number;
  now?: number;
}

interface FileRow {
  id: number;
  rel_path: string;
  name: string;
  ext: string;
  kind: FileKind;
  size_bytes: number;
  mtime_ms: number;
  ctime_ms: number | null;
  parent_path: string;
  depth: number;
  indexed_at: number;
}

const TIME_REMOVAL =
  /最近\s*\d+\s*天|今天|今日|昨天|昨日|上周|上个星期|上星期|本周|这周|这个星期|上个月|上月|本月|这个月/g;

const TYPE_REMOVAL =
  /pdf|excel|xlsx|xls|csv|表格|图片|截图|照片|png|jpg|jpeg|heic|svg|文档|word|docx|ppt|pptx|演示|代码/gi;

const STOP_WORDS = new Set([
  "那份",
  "这个",
  "那个",
  "帮我",
  "找一下",
  "找找",
  "上次",
  "之前",
  "关于",
  "里的",
  "里面",
  "一份",
  "一个",
  "一篇",
  "一下",
  "文件",
  "资料",
  "有关",
  "相关",
  "最近",
  "改过",
  "看看",
  "哪些",
  "什么",
  "怎么",
  "如何",
  "可以",
  "需要",
  "想要",
  "请",
  "能",
  "吗",
  "呢",
  "吧",
  "的",
  "是",
  "在",
  "有",
  "和",
  "与",
  "及",
  "或",
  "我",
  "你",
  "他",
  "她",
  "它",
]);

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function isFtsSafe(keyword: string): boolean {
  return keyword.length >= 3 && /^[\p{L}\p{N}]+$/u.test(keyword);
}

export function parseSearchQuery(
  query: string,
  now = Date.now(),
): {
  keywords: string[];
  typeHint: string | null;
  timeRange: TimeRange | null;
} {
  const timeRange = parseTimeHint(query, now);

  let typeHint: string | null = null;
  const lower = query.toLowerCase();
  if (/\bpdf\b|pdf/.test(lower)) typeHint = "pdf";
  else if (/excel|xlsx|xls|csv|表格/.test(lower)) typeHint = "spreadsheet";
  else if (/图片|截图|照片|png|jpg|jpeg|heic|svg/.test(lower)) typeHint = "image";
  else if (/ppt|pptx|演示/.test(lower)) typeHint = "presentation";
  else if (/代码|code/.test(lower)) typeHint = "code";
  else if (/文档|word|docx/.test(lower)) typeHint = "document";

  let text = query.replace(TIME_REMOVAL, " ").replace(TYPE_REMOVAL, " ");
  // 中文没有空格，停用词要在切分前从整句里拿掉。
  for (const word of STOP_WORDS) {
    text = text.split(word).join(" ");
  }

  const parts = text
    .split(/[\s,，。.!！?？、;；:：/\\|()[\]{}"'“”‘’]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const keywords: string[] = [];
  const add = (word: string) => {
    const normalized = word.toLowerCase();
    if (normalized.length < 2 || STOP_WORDS.has(normalized)) return;
    if (!keywords.includes(normalized)) keywords.push(normalized);
  };

  for (const part of parts) {
    const cleaned = part
      .replace(/^(帮我|找一下|找找|讲|说|看|找)+/, "")
      .replace(/(吗|呢|吧)$/, "");
    if (!cleaned || STOP_WORDS.has(cleaned)) continue;

    for (const cjk of cleaned.match(/[㐀-鿿]{2,}/g) ?? []) add(cjk);
    for (const latin of cleaned.match(/[a-zA-Z0-9][a-zA-Z0-9_-]{1,}/g) ?? []) add(latin);
  }

  return { keywords, typeHint, timeRange };
}

function typeToFilter(type: string): { kind?: FileKind; ext?: string } | null {
  const value = type.toLowerCase();
  if (value === "any" || value === "all") return null;
  if (value === "pdf") return { ext: "pdf" };
  if (value === "image") return { kind: "image" };
  if (value === "document") return { kind: "document" };
  if (value === "spreadsheet" || value === "table") return { kind: "spreadsheet" };
  if (value === "presentation") return { kind: "presentation" };
  if (value === "code") return { kind: "code" };
  if (value === "archive") return { kind: "archive" };
  return null;
}

function matchesType(file: FileRecord, type: string): boolean {
  const filter = typeToFilter(type);
  if (!filter) return true;
  if (filter.ext) return file.ext === filter.ext;
  if (filter.kind) return file.kind === filter.kind;
  return true;
}

function collectCandidates(
  db: Db,
  keywords: string[],
  explicitType: string | undefined,
  explicitRange: { after?: number; before?: number } | null,
): Map<number, FileRecord> {
  const candidates = new Map<number, FileRecord>();

  const addRows = (rows: FileRow[]) => {
    for (const row of rows) candidates.set(row.id, mapFile(row));
  };

  if (keywords.length === 0) {
    const where: string[] = [];
    const params: Array<string | number> = [];
    const filter = explicitType ? typeToFilter(explicitType) : null;
    if (filter?.kind) {
      where.push("kind = ?");
      params.push(filter.kind);
    }
    if (filter?.ext) {
      where.push("ext = ?");
      params.push(filter.ext);
    }
    if (explicitRange?.after !== undefined) {
      where.push("mtime_ms >= ?");
      params.push(explicitRange.after);
    }
    if (explicitRange?.before !== undefined) {
      where.push("mtime_ms <= ?");
      params.push(explicitRange.before);
    }
    const sql = `SELECT * FROM files ${
      where.length ? `WHERE ${where.join(" AND ")}` : ""
    } ORDER BY mtime_ms DESC LIMIT 300`;
    addRows(db.prepare(sql).all(...params) as unknown as FileRow[]);
    return candidates;
  }

  for (const keyword of keywords) {
    if (isFtsSafe(keyword)) {
      const ftsQuery = `"${keyword.replace(/"/g, '""')}"`;
      try {
        const rows = db
          .prepare(
            `SELECT f.* FROM files_fts
             JOIN files f ON f.id = files_fts.rowid
             WHERE files_fts MATCH ?
             ORDER BY bm25(files_fts)
             LIMIT 120`,
          )
          .all(ftsQuery) as unknown as FileRow[];
        addRows(rows);
      } catch {
        // FTS 查询失败不阻塞 LIKE 兜底。
      }
    }

    const pattern = `%${escapeLike(keyword)}%`;
    const rows = db
      .prepare(
        `SELECT * FROM files
         WHERE name LIKE ? ESCAPE '\\' OR rel_path LIKE ? ESCAPE '\\'
         ORDER BY mtime_ms DESC
         LIMIT 120`,
      )
      .all(pattern, pattern) as unknown as FileRow[];
    addRows(rows);
  }

  return candidates;
}

export function searchFiles(db: Db, query: string, options: SearchOptions = {}): SearchResult {
  const now = options.now ?? Date.now();
  const parsed = parseSearchQuery(query, now);
  const k = Math.max(1, Math.min(options.k ?? 8, 20));

  const explicitRange =
    options.modifiedAfter !== undefined || options.modifiedBefore !== undefined
      ? { after: options.modifiedAfter, before: options.modifiedBefore }
      : null;

  const candidates = collectCandidates(db, parsed.keywords, options.type, explicitRange);

  const scored: SearchFile[] = [];

  for (const file of candidates.values()) {
    if (options.type && !matchesType(file, options.type)) continue;
    if (explicitRange?.after !== undefined && file.mtimeMs < explicitRange.after) continue;
    if (explicitRange?.before !== undefined && file.mtimeMs > explicitRange.before) continue;

    const match = new Set<string>();
    let base = 0;

    if (parsed.keywords.length === 0) {
      base = 20;
    } else {
      for (const keyword of parsed.keywords) {
        const name = file.name.toLowerCase();
        const relPath = file.relPath.toLowerCase();
        if (name === keyword) {
          base = Math.max(base, 100);
          match.add("filename");
        } else if (name.startsWith(keyword)) {
          base = Math.max(base, 80);
          match.add("filename");
        } else if (name.includes(keyword)) {
          base = Math.max(base, 60);
          match.add("filename");
        } else if (relPath.includes(keyword)) {
          base = Math.max(base, 30);
          match.add("path");
        }
      }
      if (base === 0) continue;
      base += Math.round((match.size / parsed.keywords.length) * 24);
    }

    const effectiveRange = explicitRange ? null : parsed.timeRange;
    if (effectiveRange && inRange(file.mtimeMs, effectiveRange)) {
      base += 15;
      match.add("time");
    } else if (now - file.mtimeMs <= 7 * 86_400_000) {
      base += 5;
    }

    const effectiveType = options.type ?? parsed.typeHint ?? undefined;
    if (effectiveType && matchesType(file, effectiveType)) {
      base += 10;
      match.add("type");
    }

    scored.push({
      id: file.id,
      name: file.name,
      path: file.relPath,
      kind: file.kind,
      ext: file.ext,
      sizeBytes: file.sizeBytes,
      sizeLabel: formatBytes(file.sizeBytes),
      modifiedAt: file.mtimeMs,
      modifiedLabel: formatRelativeTime(file.mtimeMs, now),
      score: Math.min(1, base / 130),
      match: [...match],
    });
  }

  scored.sort((a, b) => b.score - a.score || b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name, "zh-CN"));

  return {
    query,
    interpreted: {
      keywords: parsed.keywords,
      type: options.type ?? parsed.typeHint,
      timeLabel: parsed.timeRange?.label ?? null,
      modifiedAfter: explicitRange?.after ? new Date(explicitRange.after).toISOString() : null,
      modifiedBefore: explicitRange?.before ? new Date(explicitRange.before).toISOString() : null,
    },
    files: scored.slice(0, k),
  };
}
