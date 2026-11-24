import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { reindexPath, deindexPath } from "../index/reconcile.ts";
import { isTextExt } from "../index/kinds.ts";
import { resolveInsideWorkspace, resolveTargetInsideWorkspace, PolicyError } from "../policy/paths.ts";
import { moveToTrash } from "../policy/trash.ts";
import { formatBytes, formatRelativeTime } from "../util/format.ts";
import { lineDiff } from "./diff.ts";
import {
  ToolError,
  rejectExtra,
  requireString,
  type ActionTool,
  type ConfirmPreview,
  type ToolContext,
  type ToolOutcome,
} from "./tool-kit.ts";

const MAX_WRITE_BYTES = 200_000;
const MAX_OVERWRITE_READ_BYTES = 256_000;

interface Fingerprint {
  sizeBytes: number;
  mtimeMs: number;
}

function fingerprint(absPath: string): Fingerprint {
  const stat = fs.lstatSync(absPath);
  return { sizeBytes: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
}

function sameFingerprint(a: Fingerprint, b: Fingerprint): boolean {
  return a.sizeBytes === b.sizeBytes && a.mtimeMs === b.mtimeMs;
}

function staleTarget(relPath: string): ToolError {
  return new ToolError(
    "stale_target",
    `${relPath} 在确认期间被改动过，为了不覆盖别人的修改，这次操作已取消。请重新发起。`,
  );
}

function assertRegularFile(absPath: string, relPath: string): fs.Stats {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(absPath);
  } catch {
    throw new ToolError("not_found", `${relPath} 不存在了`);
  }
  if (stat.isSymbolicLink()) {
    throw new ToolError("permission_denied", "不接受符号链接");
  }
  if (!stat.isFile()) {
    throw new ToolError("not_a_file", "P1 只支持对普通文件做写操作");
  }
  return stat;
}

function readTextFile(absPath: string, relPath: string): string {
  const stat = fs.statSync(absPath);
  if (stat.size > MAX_OVERWRITE_READ_BYTES) {
    throw new ToolError(
      "too_large",
      `${relPath} 超过 256 KB，P1 不支持整体覆盖这么大的文本；请先缩小文件。`,
    );
  }
  const buffer = fs.readFileSync(absPath);
  if (buffer.subarray(0, 8_192).includes(0)) {
    throw new ToolError("unsupported_type", `${relPath} 看起来是二进制，不能当文本覆盖。`);
  }
  return buffer.toString("utf8");
}

function detailRows(input: Array<[string, string]>): Array<{ label: string; value: string }> {
  return input.map(([label, value]) => ({ label, value }));
}

const writeFileTool: ActionTool = {
  name: "write_file",
  permission: "write",
  parallelSafe: false,
  definition: {
    type: "function",
    function: {
      name: "write_file",
      description:
        "创建或整体覆盖一个文本文件（md/txt/csv/json/yaml 等）。执行前会把改动预览给用户确认，用户点确认后才会真正写入。每次只写一个文件，content 就是完整的新内容；不要用来改 PDF/DOCX/XLSX/图片。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "工作区相对路径，例如 01-财务/备忘.md" },
          content: { type: "string", description: "文件的完整新内容" },
        },
        required: ["path", "content"],
      },
    },
  },
  async prepare(args, ctx: ToolContext) {
    rejectExtra(args, ["path", "content"]);
    const inputPath = requireString(args, "path", { max: 1_000 });
    if (typeof args.content !== "string") {
      throw new ToolError("invalid_arguments", "content 必须是字符串");
    }
    const content = args.content;
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_WRITE_BYTES) {
      throw new ToolError(
        "too_large",
        `内容超过 ${MAX_WRITE_BYTES.toLocaleString()} 字节，P1 不支持一次写这么大的文件。`,
      );
    }
    if (content.includes("\0")) {
      throw new ToolError("invalid_arguments", "content 不能包含 NUL 字符");
    }

    const resolved = resolveTargetInsideWorkspace(inputPath, ctx.config.workspaceRoot);
    const ext = path.extname(resolved.relPath).slice(1).toLowerCase();
    if (!isTextExt(ext)) {
      throw new ToolError(
        "unsupported_type",
        `P1 只能写文本文件；.${ext || "?"} 不支持。`,
      );
    }

    const exists = fs.existsSync(resolved.absPath);
    let before = "";
    let expected: Fingerprint | null = null;
    if (exists) {
      assertRegularFile(resolved.absPath, resolved.relPath);
      before = readTextFile(resolved.absPath, resolved.relPath);
      expected = fingerprint(resolved.absPath);
    }

    const diff = lineDiff(before, content);
    const preview: ConfirmPreview = {
      title: `${exists ? "覆盖" : "新建"}「${path.basename(resolved.relPath)}」`,
      summary: exists
        ? `将整体覆盖 ${resolved.relPath}，改动 +${diff.added} / -${diff.removed} 行。`
        : `将在 ${resolved.relPath} 新建一个文件，共 ${content.split("\n").length} 行。`,
      details: detailRows([
        ["路径", resolved.relPath],
        ["大小", formatBytes(bytes)],
        ["动作", exists ? "覆盖已有文件" : "新建文件"],
      ]),
      diff,
    };

    return {
      preview,
      async apply(): Promise<ToolOutcome> {
        const current = resolveTargetInsideWorkspace(inputPath, ctx.config.workspaceRoot);
        if (expected) {
          assertRegularFile(current.absPath, current.relPath);
          if (!sameFingerprint(fingerprint(current.absPath), expected)) {
            throw staleTarget(current.relPath);
          }
        } else if (fs.existsSync(current.absPath)) {
          throw new ToolError("target_exists", "确认期间同名文件出现了，已取消写入。");
        }
        if (ctx.signal.aborted) throw new ToolError("aborted", "请求已取消");

        const tmp = path.join(
          path.dirname(current.absPath),
          `.mp-write-${randomUUID()}.tmp`,
        );
        try {
          fs.writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600 });
          fs.renameSync(tmp, current.absPath);
        } catch (error) {
          try {
            fs.unlinkSync(tmp);
          } catch {
            // 临时文件可能没写成功，忽略。
          }
          throw error;
        }
        await reindexPath(ctx.db, current.absPath, current.relPath);

        return {
          summary: `${exists ? "已覆盖" : "已新建"} ${current.relPath}`,
          data: {
            path: current.relPath,
            created: !exists,
            diff: { added: diff.added, removed: diff.removed },
          },
          modelData: {
            ok: true,
            path: current.relPath,
            created: !exists,
            sizeBytes: bytes,
            added: diff.added,
            removed: diff.removed,
          },
        };
      },
    };
  },
};

const moveFileTool: ActionTool = {
  name: "move_file",
  permission: "write",
  parallelSafe: false,
  definition: {
    type: "function",
    function: {
      name: "move_file",
      description:
        "在工作区内移动或重命名一个文件。目标路径不能已经存在，不会静默覆盖。执行前需要用户确认。只支持普通文件，不支持移动文件夹。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          from: { type: "string", description: "源文件的工作区相对路径" },
          to: { type: "string", description: "目标路径；父目录必须已经存在" },
        },
        required: ["from", "to"],
      },
    },
  },
  async prepare(args, ctx: ToolContext) {
    rejectExtra(args, ["from", "to"]);
    const fromInput = requireString(args, "from", { max: 1_000 });
    const toInput = requireString(args, "to", { max: 1_000 });

    const from = resolveInsideWorkspace(fromInput, ctx.config.workspaceRoot);
    const stat = assertRegularFile(from.absPath, from.relPath);
    const to = resolveTargetInsideWorkspace(toInput, ctx.config.workspaceRoot);

    if (from.relPath === to.relPath) {
      throw new ToolError("invalid_arguments", "源路径和目标路径是同一个。");
    }
    if (fs.existsSync(to.absPath)) {
      throw new ToolError("target_exists", `${to.relPath} 已经存在，不会覆盖。`);
    }

    const expected = fingerprint(from.absPath);
    const preview: ConfirmPreview = {
      title: `移动「${path.basename(from.relPath)}」`,
      summary: `从 ${from.relPath} 移动到 ${to.relPath}。这是移动，不是复制。`,
      details: detailRows([
        ["大小", formatBytes(stat.size)],
        ["最近修改", formatRelativeTime(stat.mtimeMs)],
      ]),
      rows: [{ from: from.relPath, to: to.relPath }],
    };

    return {
      preview,
      async apply(): Promise<ToolOutcome> {
        const currentFrom = resolveInsideWorkspace(fromInput, ctx.config.workspaceRoot);
        assertRegularFile(currentFrom.absPath, currentFrom.relPath);
        if (!sameFingerprint(fingerprint(currentFrom.absPath), expected)) {
          throw staleTarget(currentFrom.relPath);
        }
        const currentTo = resolveTargetInsideWorkspace(toInput, ctx.config.workspaceRoot);
        if (fs.existsSync(currentTo.absPath)) {
          throw new ToolError("target_exists", `${currentTo.relPath} 在确认期间出现了，已取消移动。`);
        }
        if (ctx.signal.aborted) throw new ToolError("aborted", "请求已取消");

        try {
          fs.renameSync(currentFrom.absPath, currentTo.absPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EXDEV") {
            throw new ToolError("cross_device", "源和目标不在同一个磁盘上，P1 不支持跨磁盘移动。");
          }
          throw error;
        }
        deindexPath(ctx.db, currentFrom.relPath);
        await reindexPath(ctx.db, currentTo.absPath, currentTo.relPath);

        return {
          summary: `已移动 ${currentFrom.relPath} → ${currentTo.relPath}`,
          data: { from: currentFrom.relPath, to: currentTo.relPath },
          modelData: { ok: true, from: currentFrom.relPath, to: currentTo.relPath },
        };
      },
    };
  },
};

const deleteFileTool: ActionTool = {
  name: "delete_file",
  permission: "delete",
  parallelSafe: false,
  definition: {
    type: "function",
    function: {
      name: "delete_file",
      description:
        "把一个文件移入系统废纸篓（不是永久删除，不会用 rm）。执行前必须经过用户确认。只支持普通文件，不支持删除文件夹；一次只删一个文件。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "要删除的文件，工作区相对路径" },
        },
        required: ["path"],
      },
    },
  },
  async prepare(args, ctx: ToolContext) {
    rejectExtra(args, ["path"]);
    const inputPath = requireString(args, "path", { max: 1_000 });
    const resolved = resolveInsideWorkspace(inputPath, ctx.config.workspaceRoot);
    const stat = assertRegularFile(resolved.absPath, resolved.relPath);
    const expected = fingerprint(resolved.absPath);

    const preview: ConfirmPreview = {
      title: `把「${path.basename(resolved.relPath)}」移入废纸篓？`,
      summary: "文件会进入系统废纸篓，可以手动恢复；不会永久删除。",
      details: detailRows([
        ["路径", resolved.relPath],
        ["大小", formatBytes(stat.size)],
        ["最近修改", formatRelativeTime(stat.mtimeMs)],
      ]),
      rows: [{ from: resolved.relPath }],
    };

    return {
      preview,
      async apply(): Promise<ToolOutcome> {
        const current = resolveInsideWorkspace(inputPath, ctx.config.workspaceRoot);
        assertRegularFile(current.absPath, current.relPath);
        if (!sameFingerprint(fingerprint(current.absPath), expected)) {
          throw staleTarget(current.relPath);
        }
        if (ctx.signal.aborted) throw new ToolError("aborted", "请求已取消");

        try {
          const trashed = moveToTrash(current.absPath, ctx.config.trashDir);
          deindexPath(ctx.db, current.relPath);
          return {
            summary: `已移入废纸篓：${current.relPath}`,
            data: {
              path: current.relPath,
              trashedAs: path.basename(trashed.trashPath),
            },
            modelData: {
              ok: true,
              path: current.relPath,
              trashedAs: path.basename(trashed.trashPath),
              recoverable: true,
            },
          };
        } catch (error) {
          if (error instanceof PolicyError) {
            throw new ToolError(error.code, error.message);
          }
          throw error;
        }
      },
    };
  },
};

export const WRITE_TOOLS: ActionTool[] = [writeFileTool, moveFileTool, deleteFileTool];
