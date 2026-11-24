import type {
  ActivityDatum,
  AuditEvent,
  ContentHitItem,
  DashboardData,
  FileKind,
  FileItem,
  MetadataHit,
  RecentQuery,
  Topic,
  TypeDatum,
} from "./types";

export const LIVE = import.meta.env.VITE_MP_LIVE === "1";
const API_BASE = (import.meta.env.VITE_MP_API_BASE as string | undefined) ?? "";

export interface BackendFile {
  id?: number;
  name: string;
  path: string;
  kind: string;
  ext?: string;
  sizeBytes?: number;
  sizeLabel: string;
  modifiedAt?: number;
  modifiedLabel: string;
  match?: string[];
  score?: number;
}

export interface BackendUsage {
  prompt: number;
  cached: number;
  completion: number;
  cost: number;
}

export interface BackendSearchData {
  query?: string;
  interpreted?: unknown;
  files?: BackendFile[];
}

export interface BackendToolStart {
  toolCallId: string;
  name: string;
  args: unknown;
  argsText?: string;
}

export interface BackendToolResult {
  toolCallId: string;
  name: string;
  ok: boolean;
  summary: string;
  durationMs: number;
  data?: unknown;
  error?: { code: string; message: string };
}

export interface BackendDone {
  messageId: string;
  traceId: string | null;
  usage: BackendUsage;
  status: string;
}

export interface BackendConfirmDiff {
  added: number;
  removed: number;
  truncated: boolean;
  lines: string[];
  note?: string;
}

/** 后端执行写操作前发出的确认请求，前端据此渲染确认卡。 */
export interface BackendConfirmRequired {
  actionId: string;
  toolCallId: string;
  tool: string;
  expiresAt: number;
  title: string;
  summary: string;
  details?: Array<{ label: string; value: string }>;
  rows?: Array<{ from: string; to?: string }>;
  diff?: BackendConfirmDiff;
}

export interface BackendWorkspace {
  path: string;
  displayName: string;
  fileCount: number;
  totalBytes: number;
  sizeLabel: string;
  topicCount: number;
  lastIndexedAt: number | null;
  lastIndexedLabel: string;
  status: "empty" | "indexing" | "ready";
}

export interface BackendTopicFile extends BackendFile {
  id: number;
  ext: string;
  modifiedAt: number;
}

export interface BackendTopicKind {
  label: string;
  count: number;
  pct: number;
}

export interface BackendTopicRelated {
  topicId: string;
  reason: string;
  weight: number;
}

export interface BackendTopic {
  id: string;
  name: string;
  count: number;
  sizeBytes: number;
  lastModifiedAt: number;
  blurb: string;
  kinds: BackendTopicKind[];
  related: BackendTopicRelated[];
  files: BackendTopicFile[];
}

export interface BackendTopicEdge {
  a: string;
  b: string;
  weight: number;
  reason: string;
}

export interface BackendLastRun {
  id: string;
  status: string;
  filesIndexed: number;
  excluded: number;
  durationMs: number | null;
  errorCount: number;
}

export interface BackendIndexRun {
  id: string;
  status: "running" | "done" | "failed";
  filesSeen: number;
  filesIndexed: number;
  filesExcluded: number;
  startedAt: number;
  finishedAt: number | null;
  errors: unknown[];
}

export interface BackendOverview {
  workspace: BackendWorkspace;
  index: {
    status: "empty" | "indexing" | "ready";
    runId: string | null;
    filesSeen: number;
    filesIndexed: number;
    filesExcluded: number;
  };
  topics: BackendTopic[];
  edges: BackendTopicEdge[];
  activity: ActivityDatum[];
  types: TypeDatum[];
  recentQueries: RecentQuery[];
  lastRun: BackendLastRun | null;
}

export interface BackendAuditRecord {
  id: number;
  ts: number;
  sessionId: string | null;
  turn: number | null;
  tool: string;
  args: unknown;
  decision: "allow" | "deny" | "confirm";
  result: string | null;
  durationMs: number | null;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function readError(response: Response): Promise<ApiError> {
  let payload: { error?: { code?: string; message?: string } } = {};
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    // 非 JSON 错误体，保留状态码。
  }
  return new ApiError(
    payload.error?.code ?? "http_error",
    payload.error?.message ?? `请求失败（${response.status}）`,
    response.status,
  );
}

async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { signal });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as T;
}

async function apiPost<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as T;
}

async function apiDelete<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    signal,
  });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as T;
}

export type BackendMemoryKind = "alias" | "preference" | "context" | "correction";

export interface BackendMemory {
  id: string;
  fact: string;
  kind: BackendMemoryKind;
  sourceSession: string | null;
  confidence: number | null;
  hitCount: number;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export async function getMemories(
  signal?: AbortSignal,
): Promise<BackendMemory[]> {
  const payload = await apiGet<{ memories?: BackendMemory[] }>(
    "/api/memories",
    signal,
  );
  return Array.isArray(payload.memories) ? payload.memories : [];
}

export function deleteMemory(id: string): Promise<{ ok: boolean; id: string }> {
  return apiDelete(`/api/memories/${encodeURIComponent(id)}`);
}

export function getOverview(signal?: AbortSignal): Promise<BackendOverview> {
  return apiGet<BackendOverview>("/api/overview", signal);
}

export function revealFile(path: string): Promise<{ ok: boolean; path: string }> {
  return apiPost("/api/reveal", { path });
}

export interface RebuildStart {
  runId: string;
  status: "started" | "running";
  alreadyRunning: boolean;
}

/** 409 表示已有任务在跑，同样带 runId，可以直接接着轮询。 */
export async function startRebuild(): Promise<RebuildStart> {
  const response = await fetch(`${API_BASE}/api/index/rebuild`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok && response.status !== 409) {
    throw await readError(response);
  }
  return (await response.json()) as RebuildStart;
}

export function getIndexRun(
  runId: string,
  signal?: AbortSignal,
): Promise<BackendIndexRun> {
  return apiGet<BackendIndexRun>(
    `/api/index/runs/${encodeURIComponent(runId)}`,
    signal,
  );
}

export async function getAudit(
  limit = 20,
  signal?: AbortSignal,
): Promise<BackendAuditRecord[]> {
  const payload = await apiGet<{ events?: BackendAuditRecord[] }>(
    `/api/audit?limit=${limit}`,
    signal,
  );
  return Array.isArray(payload.events) ? payload.events : [];
}

export interface BrowseFolderEntry {
  name: string;
  path: string;
  count: number;
}

export interface BackendBrowse {
  path: string;
  folders: BrowseFolderEntry[];
  files: BackendFile[];
  totalFiles: number;
  offset: number;
  limit: number;
  breadcrumbs: Array<{ name: string; path: string }>;
}

export function browseFolder(
  path: string,
  offset = 0,
  limit = 50,
  signal?: AbortSignal,
): Promise<BackendBrowse> {
  const params = new URLSearchParams({
    path,
    offset: String(offset),
    limit: String(limit),
  });
  return apiGet<BackendBrowse>(`/api/browse?${params.toString()}`, signal);
}

export type ConfirmDecision = "allow" | "deny";

/** 回答 `/api/confirm`，让卡住的 SSE 继续往下走。 */
export function confirmAction(
  actionId: string,
  decision: ConfirmDecision,
): Promise<{ ok: boolean; actionId: string; decision: string }> {
  return apiPost("/api/confirm", { actionId, decision });
}

export interface ChatHandlers {
  onSession?: (sessionId: string) => void;
  onUsage?: (usage: BackendUsage) => void;
  onToolStart?: (call: BackendToolStart) => void;
  onToolResult?: (result: BackendToolResult) => void;
  onConfirmRequired?: (request: BackendConfirmRequired) => void;
  onTextDelta?: (text: string) => void;
  onDone?: (done: BackendDone) => void;
}

/** 解析后端 SSE；事件体一定是单行 JSON。 */
export async function streamChat(
  message: string,
  sessionId: string | null,
  handlers: ChatHandlers,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }),
    signal,
  });
  if (!response.ok) throw await readError(response);
  if (!response.body) {
    throw new ApiError("empty_stream", "后端没有返回 SSE 数据流");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (event: string, dataText: string): boolean => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(dataText) as Record<string, unknown>;
    } catch {
      throw new ApiError("bad_event", `无法解析 SSE 事件：${event}`);
    }

    if (event === "session") {
      handlers.onSession?.(String(data.sessionId ?? ""));
      return false;
    }
    if (event === "usage") {
      handlers.onUsage?.(data as unknown as BackendUsage);
      return false;
    }
    if (event === "tool_start") {
      handlers.onToolStart?.(data as unknown as BackendToolStart);
      return false;
    }
    if (event === "tool_result") {
      handlers.onToolResult?.(data as unknown as BackendToolResult);
      return false;
    }
    if (event === "confirm_required") {
      handlers.onConfirmRequired?.(data as unknown as BackendConfirmRequired);
      return false;
    }
    if (event === "text_delta") {
      handlers.onTextDelta?.(String(data.text ?? ""));
      return false;
    }
    if (event === "done") {
      handlers.onDone?.(data as unknown as BackendDone);
      return true;
    }
    if (event === "error") {
      throw new ApiError(
        String(data.code ?? "runtime_error"),
        String(data.message ?? "对话失败"),
      );
    }
    return false;
  };

  const takeBlocks = (flush = false): boolean => {
    let index = buffer.search(/\r?\n\r?\n/);
    while (index >= 0) {
      const block = buffer.slice(0, index);
      const separator = buffer.slice(index).match(/^\r?\n\r?\n/)?.[0] ?? "\n\n";
      buffer = buffer.slice(index + separator.length);

      const lines = block.split(/\r?\n/);
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const dataLines = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""));
      if (eventLine && dataLines.length > 0) {
        const done = dispatch(
          eventLine.slice(6).trim(),
          dataLines.join("\n"),
        );
        if (done) return true;
      }
      index = buffer.search(/\r?\n\r?\n/);
    }

    if (flush && buffer.trim()) {
      const lines = buffer.split(/\r?\n/);
      buffer = "";
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const dataText = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (eventLine && dataText) {
        return dispatch(eventLine.slice(6).trim(), dataText);
      }
    }
    return false;
  };

  let finished = false;
  while (!finished) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    finished = takeBlocks();
  }
  buffer += decoder.decode();
  if (!finished) finished = takeBlocks(true);

  if (!finished) {
    await reader.cancel().catch(() => undefined);
    throw new ApiError("stream_closed", "连接提前结束，没有收到完成事件");
  }
}

const IMAGE_EXT: Record<string, FileKind> = {
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
  svg: "svg",
  heic: "heic",
  fig: "fig",
  sketch: "fig",
};

export function mapFileKind(kind: string, ext = "", name = ""): FileKind {
  const suffix = ext || name.split(".").pop()?.toLowerCase() || "";
  if (kind === "image") return IMAGE_EXT[suffix] ?? "png";
  if (kind === "spreadsheet") return suffix === "csv" ? "csv" : "xlsx";
  if (kind === "presentation") return "ppt";
  if (kind === "archive") return "zip";
  if (kind === "code") return "code";
  if (kind === "document") {
    if (suffix === "pdf") return "pdf";
    if (suffix === "doc" || suffix === "docx" || suffix === "pages" || suffix === "rtf") {
      return "docx";
    }
    if (suffix === "md" || suffix === "markdown") return "md";
    if (suffix === "txt") return "txt";
    return "md";
  }
  return "other";
}

export function toFileItem(file: BackendFile): FileItem {
  return {
    id: file.id !== undefined ? String(file.id) : file.path,
    name: file.name,
    path: file.path,
    kind: mapFileKind(file.kind, file.ext, file.name),
    size: file.sizeLabel,
    modified: file.modifiedLabel,
  };
}

export function filesFromToolData(data: unknown): BackendFile[] {
  if (!data || typeof data !== "object") return [];
  const record = data as { files?: unknown; file?: unknown };
  if (Array.isArray(record.files)) {
    return record.files.filter(isBackendFile);
  }
  if (isBackendFile(record.file)) return [record.file];
  return [];
}

function isBackendFile(value: unknown): value is BackendFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<BackendFile>;
  return (
    typeof file.name === "string" &&
    typeof file.path === "string" &&
    typeof file.kind === "string" &&
    typeof file.sizeLabel === "string" &&
    typeof file.modifiedLabel === "string"
  );
}

export function hitsFromSearchData(data: unknown): MetadataHit[] {
  const files = filesFromToolData(data);
  return files.map((file) => ({
    id: file.path,
    name: file.name,
    path: file.path,
    match: Array.isArray(file.match) ? file.match : [],
    score: typeof file.score === "number" ? file.score : 0,
  }));
}

function normalizeForCite(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

/**
 * 只保留回答里真正引用到的正文命中。
 *
 * 检索是「可能相关」，回答才是「确认相关」。纯语义补位可能捞回八竿子打不着
 * 的片段，模型会在回答里说「没有找到」；这时卡片就不该出现。判定方式：
 * 回答里出现了文件名 / 去掉扩展名的文件名 / 完整路径，或引用了片段里的
 * 一小段原文。回答为空（还没开始写）时一张都不显示。
 */
export function filterCitedContentHits(
  answer: string,
  hits: ContentHitItem[],
): ContentHitItem[] {
  if (hits.length === 0) return hits;
  const text = normalizeForCite(answer);
  if (!text) return [];
  return hits.filter((hit) => {
    const name = normalizeForCite(hit.name);
    const stem = name.replace(/\.[a-z0-9]+$/, "");
    if (name.length > 0 && text.includes(name)) return true;
    if (stem.length >= 4 && text.includes(stem)) return true;
    const filePath = normalizeForCite(hit.path);
    if (filePath.length >= 6 && text.includes(filePath)) return true;
    const snippet = normalizeForCite(hit.snippet).replace(/^…+/, "").slice(0, 24);
    return snippet.length >= 12 && text.includes(snippet);
  });
}

export function contentHitsFromToolData(data: unknown): ContentHitItem[] {
  if (!data || typeof data !== "object") return [];
  const hits = (data as { hits?: unknown }).hits;
  if (!Array.isArray(hits)) return [];
  const out: ContentHitItem[] = [];
  for (const raw of hits) {
    if (!raw || typeof raw !== "object") continue;
    const hit = raw as Partial<ContentHitItem> & { injection?: { suspected?: boolean } };
    if (
      typeof hit.path !== "string" ||
      typeof hit.name !== "string" ||
      typeof hit.startLine !== "number" ||
      typeof hit.endLine !== "number" ||
      typeof hit.snippet !== "string"
    ) {
      continue;
    }
    out.push({
      id: `${hit.path}:${hit.startLine}`,
      name: hit.name,
      path: hit.path,
      locKind:
        hit.locKind === "page" || hit.locKind === "paragraph" ? hit.locKind : "line",
      startLine: hit.startLine,
      endLine: hit.endLine,
      snippet: hit.snippet,
      score: typeof hit.score === "number" ? hit.score : 0,
      via:
        hit.via === "vector" || hit.via === "both" || hit.via === "keyword"
          ? hit.via
          : "keyword",
      injectionSuspected: hit.injection?.suspected === true,
    });
  }
  return out;
}

/* ---------- Dashboard ---------- */

const CX = 500;
const CY = 255;

function place(
  indexInRing: number,
  ringCount: number,
  rx: number,
  ry: number,
): { x: number; y: number } {
  if (ringCount === 1) return { x: CX, y: CY };
  const angle = -Math.PI / 2 + (indexInRing / ringCount) * Math.PI * 2;
  return {
    x: Math.round(CX + Math.cos(angle) * rx),
    y: Math.round(CY + Math.sin(angle) * ry),
  };
}

/** 后端只给主题和边，坐标在这里按数量排序后确定性布局。 */
function layoutBackendTopics(topics: BackendTopic[]): Topic[] {
  const outerCount = Math.min(topics.length, 12);
  const innerCount = topics.length - outerCount;
  const outerRx = topics.length <= 4 ? 300 : 380;
  const outerRy = topics.length <= 4 ? 150 : 178;

  return topics.map((topic, index) => {
    const position =
      index < outerCount
        ? place(index, outerCount, outerRx, outerRy)
        : place(index - outerCount, innerCount, 190, 92);

    return {
      id: topic.id,
      name: topic.name,
      count: topic.count,
      blurb: topic.blurb,
      x: position.x,
      y: position.y,
      kinds: topic.kinds.map((kind) => ({
        label: kind.label,
        pct: kind.pct,
      })),
      related: topic.related.map((related) => ({
        topicId: related.topicId,
        reason: related.reason,
      })),
      files: topic.files.map(toFileItem),
    };
  });
}

const TOOL_LABEL: Record<string, string> = {
  search_files: "检索文件",
  get_file_info: "查看文件信息",
  list_folder: "浏览目录",
  read_file: "读取文件",
  reveal_in_finder: "Finder 定位",
  load_skill: "加载技能",
  write_file: "写入文件",
  move_file: "移动文件",
  delete_file: "移入废纸篓",
  trash_file: "移入废纸篓",
  user_confirm: "用户确认",
  index_workspace: "索引工作区",
};

const DENY_LABEL: Record<string, string> = {
  permission_denied: "敏感文件已拦截",
  path_escape: "越界路径已拦截",
  symlink_rejected: "符号链接已拒绝",
  unsupported_type: "不支持的文件类型",
  reveal_disabled: "Finder 定位已关闭",
  unknown_tool: "未知工具调用",
  invalid_args: "参数不合法",
  rejected: "用户取消",
  confirm_timeout: "确认超时",
  destructive_limit: "本轮写操作已达上限",
  stale_target: "文件在确认期间被改动",
  target_exists: "目标已存在",
  too_large: "文件过大",
  not_a_file: "不是普通文件",
  cross_device: "不支持跨磁盘移动",
  writes_disabled: "写操作已关闭",
};

function relativeTime(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  const date = new Date(ts);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function stripControlTags(text: string): string {
  return text.replace(/<control\b[^>]*\/>/g, "").trim();
}

function auditDetail(record: BackendAuditRecord): string {
  const args =
    record.args && typeof record.args === "object"
      ? (record.args as Record<string, unknown>)
      : {};
  if (record.decision === "deny") {
    return DENY_LABEL[record.result ?? ""] ?? record.result ?? "已拦截";
  }
  if (record.tool === "index_workspace" && record.result) {
    const match = record.result.match(/indexed (\d+) files?,\s*excluded (\d+)/);
    if (match) return `${match[1]} 个文件 · ${match[2]} 个排除`;
  }
  if (typeof args.path === "string") return args.path;
  if (typeof args.query === "string") {
    return `“${stripControlTags(args.query)}”`;
  }
  if (typeof args.folder === "string") return args.folder;
  return record.result ?? "—";
}

export function toAuditEvents(records: BackendAuditRecord[]): AuditEvent[] {
  return records.map((record) => ({
    id: String(record.id),
    time: relativeTime(record.ts),
    action:
      record.decision === "deny"
        ? "已拦截"
        : record.decision === "confirm"
          ? "待确认"
          : (TOOL_LABEL[record.tool] ?? record.tool),
    detail: auditDetail(record),
    tone:
      record.decision === "deny"
        ? "critical"
        : record.decision === "confirm"
          ? "warn"
          : "neutral",
  }));
}

export function toDashboardData(
  overview: BackendOverview,
  audit: BackendAuditRecord[] = [],
): DashboardData {
  return {
    workspace: {
      path: overview.workspace.path,
      displayName: overview.workspace.displayName,
      fileCount: overview.workspace.fileCount,
      sizeLabel: overview.workspace.sizeLabel,
      topicCount: overview.workspace.topicCount,
      lastIndexedLabel: overview.workspace.lastIndexedLabel,
      status: overview.workspace.status,
    },
    topics: layoutBackendTopics(overview.topics),
    activity: overview.activity ?? [],
    types: overview.types ?? [],
    recentQueries: overview.recentQueries ?? [],
    audit: toAuditEvents(audit),
    lastRun: overview.lastRun
      ? {
          filesIndexed: overview.lastRun.filesIndexed,
          excluded: overview.lastRun.excluded,
          errorCount: overview.lastRun.errorCount,
          durationMs: overview.lastRun.durationMs,
        }
      : null,
  };
}
