export type Tab = "dashboard" | "chat";
export type Theme = "light" | "dark";

export type FileKind =
  | "pdf"
  | "xlsx"
  | "csv"
  | "fig"
  | "png"
  | "jpg"
  | "svg"
  | "heic"
  | "md"
  | "docx"
  | "zip"
  | "txt"
  | "ppt"
  | "code"
  | "other";

export interface FileItem {
  id: string;
  name: string;
  path: string;
  kind: FileKind;
  size: string;
  modified: string;
}

export interface RelatedTopic {
  topicId: string;
  reason: string;
}

export interface KindBreakdown {
  label: string;
  pct: number;
}

export interface Topic {
  id: string;
  name: string;
  count: number;
  blurb: string;
  x: number;
  y: number;
  kinds: KindBreakdown[];
  related: RelatedTopic[];
  files: FileItem[];
}

export interface WorkspaceSummary {
  path: string;
  displayName?: string;
  fileCount: number;
  sizeLabel: string;
  topicCount: number;
  lastIndexedLabel: string;
  status: "empty" | "indexing" | "ready";
}

export interface LastRunSummary {
  filesIndexed: number;
  excluded: number;
  errorCount: number;
  durationMs: number | null;
}

export interface DashboardData {
  workspace: WorkspaceSummary;
  topics: Topic[];
  activity: ActivityDatum[];
  types: TypeDatum[];
  recentQueries: RecentQuery[];
  audit: AuditEvent[];
  lastRun: LastRunSummary | null;
}

export interface ActivityDatum {
  label: string;
  value: number;
}

export interface TypeDatum {
  label: string;
  value: number;
}

export interface RecentQuery {
  id: string;
  query: string;
  results: number;
  time: string;
}

export type MemoryKind = "alias" | "preference" | "context" | "correction";

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  text: string;
  source: string;
  uses: number;
}

export interface AuditEvent {
  id: string;
  time: string;
  action: string;
  detail: string;
  tone: "good" | "warn" | "critical" | "neutral";
}

export interface EvalFail {
  id: string;
  expected: string;
  got: string;
}

export interface ToolChip {
  id?: string;
  name: string;
  args: string;
  detail?: string;
  status: "running" | "done" | "error";
}

export interface RetrievalChunk {
  file: string;
  section: string;
  score: number;
}

/** search_content 的正文命中：行号和片段都来自真实索引。 */
export type LocKind = "line" | "page" | "paragraph";

/** 这条命中是靠什么找到的：关键词、向量，或两者都命中。 */
export type HitVia = "keyword" | "vector" | "both";

export interface ContentHitItem {
  id: string;
  name: string;
  path: string;
  locKind: LocKind;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
  via: HitVia;
  injectionSuspected: boolean;
}

/** 元数据命中（文件名、路径、类型、时间），不是正文片段。 */
export interface MetadataHit {
  id: string;
  name: string;
  path: string;
  match: string[];
  score: number;
}

export interface Usage {
  prompt: number;
  cached: number;
  completion: number;
  cost: number;
}

export interface ConfirmRow {
  from: string;
  to?: string;
}

export interface ConfirmDiff {
  added: number;
  removed: number;
  truncated: boolean;
  lines: string[];
  note?: string;
}

export interface ConfirmSpec {
  kind: "move" | "delete" | "write" | "memory";
  title: string;
  description: string;
  rows: ConfirmRow[];
  total: number;
  status: "pending" | "armed" | "running" | "done" | "cancelled" | "failed";
  /** 真后端确认流才有：mock 场景没有 actionId。 */
  actionId?: string;
  toolCallId?: string;
  diff?: ConfirmDiff;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools?: ToolChip[];
  files?: FileItem[];
  contentHits?: ContentHitItem[];
  confirm?: ConfirmSpec;
  streaming?: boolean;
}

export interface ChatSeed {
  id: number;
  query: string;
}

export interface RailState {
  chunks?: RetrievalChunk[];
  hits?: MetadataHit[];
  contentHits?: ContentHitItem[];
  tools: { name: string; detail: string; ms: number }[];
  usage: Usage;
  pending?: boolean;
}
