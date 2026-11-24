import type { Config } from "../config.ts";
import type { ToolDefinition } from "../model/types.ts";
import type { SkillLibrary } from "../skills/loader.ts";
import type { Db } from "../store/db.ts";
import type { FileRecord } from "../store/files.ts";
import { formatBytes, formatRelativeTime } from "../util/format.ts";
import type { DiffPreview } from "./diff.ts";

export class ToolError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.details = details;
  }
}

export interface ToolContext {
  db: Db;
  config: Config;
  skills: SkillLibrary;
  sessionId: string;
  turn: number;
  signal: AbortSignal;
}

export interface ToolOutcome {
  summary: string;
  data?: unknown;
  modelData?: Record<string, unknown>;
}

export type ToolPermission = "read" | "meta" | "write" | "delete";

export interface ConfirmRow {
  from: string;
  to?: string;
}

/** 给用户看的确认信息；不会直接回传给模型。 */
export interface ConfirmPreview {
  title: string;
  summary: string;
  details?: Array<{ label: string; value: string }>;
  rows?: ConfirmRow[];
  diff?: DiffPreview;
}

export interface ToolPlan {
  preview: ConfirmPreview;
  /** 确认之后才调用；内部会重新校验目标有没有被换掉。 */
  apply(): Promise<ToolOutcome>;
}

interface ToolBase {
  name: string;
  parallelSafe: boolean;
  definition: ToolDefinition;
}

export interface ReadOnlyTool extends ToolBase {
  permission: "read" | "meta";
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome>;
}

export interface ActionTool extends ToolBase {
  permission: "write" | "delete";
  prepare(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolPlan>;
}

export type Tool = ReadOnlyTool | ActionTool;

export interface ToolExecution {
  ok: boolean;
  summary: string;
  data?: unknown;
  error?: { code: string; message: string; details?: unknown };
  modelContent: string;
  durationMs: number;
  sensitive: boolean;
}

export function isActionTool(tool: Tool): tool is ActionTool {
  return tool.permission === "write" || tool.permission === "delete";
}

export function fileCard(file: FileRecord, now = Date.now()): Record<string, unknown> {
  return {
    id: file.id,
    name: file.name,
    path: file.relPath,
    kind: file.kind,
    ext: file.ext,
    sizeBytes: file.sizeBytes,
    sizeLabel: formatBytes(file.sizeBytes),
    modifiedAt: file.mtimeMs,
    modifiedLabel: formatRelativeTime(file.mtimeMs, now),
  };
}

export function rejectExtra(args: Record<string, unknown>, allowed: string[]): void {
  const extra = Object.keys(args).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    throw new ToolError("invalid_arguments", `不认识的参数：${extra.join(", ")}`);
  }
}

export function requireString(
  args: Record<string, unknown>,
  key: string,
  options: { max?: number; allowEmpty?: boolean } = {},
): string {
  const value = args[key];
  if (typeof value !== "string") {
    throw new ToolError("invalid_arguments", `${key} 必须是字符串`);
  }
  const text = value.trim();
  if (!text && !options.allowEmpty) {
    throw new ToolError("invalid_arguments", `${key} 不能为空`);
  }
  if (options.max && text.length > options.max) {
    throw new ToolError("invalid_arguments", `${key} 不能超过 ${options.max} 字符`);
  }
  return text;
}

export function optionalString(
  args: Record<string, unknown>,
  key: string,
  options: { max?: number } = {},
): string | undefined {
  if (args[key] === undefined) return undefined;
  if (typeof args[key] !== "string") {
    throw new ToolError("invalid_arguments", `${key} 必须是字符串`);
  }
  const text = (args[key] as string).trim();
  if (options.max && text.length > options.max) {
    throw new ToolError("invalid_arguments", `${key} 不能超过 ${options.max} 字符`);
  }
  return text || undefined;
}

export function optionalInteger(
  args: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number | undefined {
  if (args[key] === undefined) return undefined;
  const value = args[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ToolError("invalid_arguments", `${key} 必须是 ${min} 到 ${max} 的整数`);
  }
  return value;
}

export function capText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}\n…（已截断）`, truncated: true };
}
