export interface DiffLine {
  op: "add" | "del" | "ctx";
  text: string;
}

export interface DiffPreview {
  added: number;
  removed: number;
  truncated: boolean;
  /** 每行前缀是 "+" / "-" / " "，方便前端直接着色。 */
  lines: string[];
  note?: string;
}

const MAX_DP_CELLS = 160_000;
const MAX_DIFF_LINES = 80;
const MAX_SIDE_LINES = 400;

function splitLines(text: string): string[] {
  if (!text) return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

/**
 * 行级 diff：小文件用 LCS，大文件只给规模摘要，绝不假装做了逐行比对。
 */
export function lineDiff(
  before: string,
  after: string,
  options: { maxLines?: number; maxSideLines?: number } = {},
): DiffPreview {
  const maxLines = options.maxLines ?? MAX_DIFF_LINES;
  const maxSide = options.maxSideLines ?? MAX_SIDE_LINES;
  const a = splitLines(before);
  const b = splitLines(after);

  if (a.length > maxSide || b.length > maxSide || a.length * b.length > MAX_DP_CELLS) {
    return {
      added: 0,
      removed: 0,
      truncated: true,
      lines: [],
      note: `旧文件 ${a.length} 行，新内容 ${b.length} 行；改动范围较大，不做逐行对比，确认后将整体覆盖。`,
    };
  }

  // 后缀数组式的 LCS 表；受 MAX_DP_CELLS 限制，不会失控。
  const rows = a.length;
  const cols = b.length;
  const table: Uint16Array[] = [];
  for (let i = 0; i <= rows; i += 1) table.push(new Uint16Array(cols + 1));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < rows && j < cols) {
    if (a[i] === b[j]) {
      out.push({ op: "ctx", text: a[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ op: "del", text: a[i] });
      removed += 1;
      i += 1;
    } else {
      out.push({ op: "add", text: b[j] });
      added += 1;
      j += 1;
    }
  }
  while (i < rows) {
    out.push({ op: "del", text: a[i] });
    removed += 1;
    i += 1;
  }
  while (j < cols) {
    out.push({ op: "add", text: b[j] });
    added += 1;
    j += 1;
  }

  const truncated = out.length > maxLines;
  const shown = out.slice(0, maxLines);
  const prefix = { add: "+", del: "-", ctx: " " } as const;

  return {
    added,
    removed,
    truncated,
    lines: shown.map((line) => `${prefix[line.op]}${line.text}`),
    ...(truncated ? { note: `只显示前 ${maxLines} 行改动` } : {}),
  };
}
