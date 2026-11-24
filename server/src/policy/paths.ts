import fs from "node:fs";
import path from "node:path";
import { hasIgnoredSegment, isSensitiveRelPath } from "./sensitive.ts";

export type PolicyErrorCode =
  | "invalid_path"
  | "path_escape"
  | "permission_denied"
  | "not_found"
  | "not_a_directory"
  | "not_a_file";

export class PolicyError extends Error {
  readonly code: PolicyErrorCode;

  constructor(code: PolicyErrorCode, message: string) {
    super(message);
    this.name = "PolicyError";
    this.code = code;
  }
}

export interface ResolvedPath {
  absPath: string;
  relPath: string;
}

/**
 * 把模型/前端给的相对路径解析到工作区内。
 * 先做词法检查，再用 realpath 解析符号链接，最后再做一次边界检查。
 */
export function resolveInsideWorkspace(
  inputPath: string,
  workspaceRoot: string,
  options: { allowRoot?: boolean } = {},
): ResolvedPath {
  if (typeof inputPath !== "string" || inputPath.includes("\0")) {
    throw new PolicyError("invalid_path", "路径不合法");
  }

  const raw = inputPath.trim().replace(/\\/g, "/");
  if (path.isAbsolute(raw) || /^[A-Za-z]:\//.test(raw)) {
    throw new PolicyError("path_escape", "不接受绝对路径");
  }

  const normalizedRaw = raw.replace(/^\.\//, "");
  if (normalizedRaw.split("/").includes("..")) {
    throw new PolicyError("path_escape", "路径不能包含 ..");
  }

  const realRoot = fs.realpathSync(workspaceRoot);
  const lexicalAbs = path.resolve(realRoot, normalizedRaw || ".");
  if (lexicalAbs !== realRoot && !lexicalAbs.startsWith(realRoot + path.sep)) {
    throw new PolicyError("path_escape", "路径不在工作区内");
  }

  if (lexicalAbs === realRoot && !options.allowRoot) {
    throw new PolicyError("invalid_path", "这里需要一个文件或子目录路径");
  }

  // 敏感路径在触碰文件系统之前就拒绝，避免用“存在/不存在”泄露信息。
  if (normalizedRaw && (isSensitiveRelPath(normalizedRaw) || hasIgnoredSegment(normalizedRaw))) {
    throw new PolicyError("permission_denied", "该路径不允许访问");
  }

  let realAbs: string;
  try {
    realAbs = fs.realpathSync(lexicalAbs);
  } catch {
    throw new PolicyError("not_found", `路径不存在：${inputPath}`);
  }

  if (realAbs !== realRoot && !realAbs.startsWith(realRoot + path.sep)) {
    throw new PolicyError("path_escape", "符号链接指向了工作区外");
  }

  const relPath = path.relative(realRoot, realAbs).split(path.sep).join("/");

  if (relPath && (isSensitiveRelPath(relPath) || hasIgnoredSegment(relPath))) {
    throw new PolicyError("permission_denied", "该路径不允许访问");
  }

  return { absPath: realAbs, relPath };
}

/**
 * 解析一个「可能还不存在」的写入目标：新文件、移动目标。
 * 父目录必须已经存在且在工作区内；目标本身若是符号链接一律拒绝。
 */
export function resolveTargetInsideWorkspace(
  inputPath: string,
  workspaceRoot: string,
): ResolvedPath {
  if (typeof inputPath !== "string" || inputPath.includes("\0")) {
    throw new PolicyError("invalid_path", "路径不合法");
  }

  const raw = inputPath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!raw || raw === ".") {
    throw new PolicyError("invalid_path", "需要一个具体的目标文件路径");
  }
  if (path.isAbsolute(raw) || /^[A-Za-z]:\//.test(raw)) {
    throw new PolicyError("path_escape", "不接受绝对路径");
  }
  const parts = raw.split("/");
  if (parts.includes("..")) {
    throw new PolicyError("path_escape", "路径不能包含 ..");
  }
  if (parts.some((part) => part === "" || part === ".")) {
    throw new PolicyError("invalid_path", "路径里有空段");
  }
  if (isSensitiveRelPath(raw) || hasIgnoredSegment(raw)) {
    throw new PolicyError("permission_denied", "该路径不允许访问");
  }

  const base = parts[parts.length - 1];
  const parentRel = parts.slice(0, -1).join("/");
  const parent = resolveInsideWorkspace(parentRel || ".", workspaceRoot, {
    allowRoot: true,
  });
  const parentStat = fs.statSync(parent.absPath);
  if (!parentStat.isDirectory()) {
    throw new PolicyError("not_a_directory", "父路径不是目录");
  }

  const absPath = path.join(parent.absPath, base);
  const relPath = parent.relPath ? `${parent.relPath}/${base}` : base;

  if (fs.existsSync(absPath)) {
    const stat = fs.lstatSync(absPath);
    if (stat.isSymbolicLink()) {
      throw new PolicyError("permission_denied", "不接受符号链接作为写入目标");
    }
    const realAbs = fs.realpathSync(absPath);
    const realRoot = fs.realpathSync(workspaceRoot);
    if (realAbs !== realRoot && !realAbs.startsWith(realRoot + path.sep)) {
      throw new PolicyError("path_escape", "目标指向了工作区外");
    }
  }

  return { absPath, relPath };
}

export function assertDirectory(absPath: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    throw new PolicyError("not_found", "目录不存在");
  }
  if (!stat.isDirectory()) {
    throw new PolicyError("not_a_directory", "路径不是目录");
  }
}

export function assertFile(absPath: string): fs.Stats {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    throw new PolicyError("not_found", "文件不存在");
  }
  if (!stat.isFile()) {
    throw new PolicyError("not_a_file", "路径不是普通文件");
  }
  return stat;
}
