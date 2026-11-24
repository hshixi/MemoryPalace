/** 引用位置：文本按行，PDF 按页，DOCX 按段。 */
export type LocKind = "line" | "page" | "paragraph";

export interface ChunkDraft {
  chunkIndex: number;
  startLine: number;
  endLine: number;
  text: string;
  locKind: LocKind;
}

export interface ExtractResult {
  chunks: ChunkDraft[];
  redacted: boolean;
  truncated: boolean;
  reason: string | null;
}

export function emptyResult(reason: string | null): ExtractResult {
  return { chunks: [], redacted: false, truncated: false, reason };
}

export function locKindOf(value: string | null | undefined): LocKind {
  return value === "page" || value === "paragraph" ? value : "line";
}

export function locLabel(kind: LocKind, start: number, end: number): string {
  if (kind === "page") return start === end ? `第 ${start} 页` : `第 ${start}–${end} 页`;
  if (kind === "paragraph") {
    return start === end ? `第 ${start} 段` : `第 ${start}–${end} 段`;
  }
  return start === end ? `第 ${start} 行` : `第 ${start}–${end} 行`;
}
