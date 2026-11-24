import fs from "node:fs/promises";
import path from "node:path";
import { extOf, kindOfExt, type FileKind } from "./kinds.ts";
import {
  isIgnoredDirName,
  isIgnoredFileName,
  isSensitiveRelPath,
} from "../policy/sensitive.ts";

export interface ScannedFile {
  relPath: string;
  name: string;
  ext: string;
  kind: FileKind;
  sizeBytes: number;
  mtimeMs: number;
  ctimeMs: number | null;
  parentPath: string;
  depth: number;
}

export interface ScanProgress {
  filesSeen: number;
  filesIndexed: number;
  filesExcluded: number;
  currentDir: string;
}

export interface ScanResult {
  files: ScannedFile[];
  filesSeen: number;
  filesIndexed: number;
  filesExcluded: number;
  errors: string[];
}

export class ScanLimitError extends Error {
  constructor(limit: number) {
    super(`文件数量超过上限 ${limit.toLocaleString()}，本次索引已停止`);
    this.name = "ScanLimitError";
  }
}

export interface ScanOptions {
  maxFiles?: number;
  onProgress?: (progress: ScanProgress) => void;
}

const DEFAULT_MAX_FILES = 200_000;

export async function scanWorkspace(
  root: string,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const files: ScannedFile[] = [];
  const errors: string[] = [];
  let filesSeen = 0;
  let filesExcluded = 0;
  let lastProgress = 0;

  const emitProgress = (currentDir: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastProgress < 250) return;
    lastProgress = now;
    options.onProgress?.({
      filesSeen,
      filesIndexed: files.length,
      filesExcluded,
      currentDir,
    });
  };

  async function walk(absDir: string, relDir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch (error) {
      errors.push(
        `无法读取目录 ${relDir || "."}：${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

    for (const entry of entries) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

      // P0 一律不跟符号链接；避免跳到工作区外。
      if (entry.isSymbolicLink()) {
        filesSeen += 1;
        continue;
      }

      if (entry.isDirectory()) {
        if (isIgnoredDirName(entry.name)) continue;
        await walk(path.join(absDir, entry.name), relPath);
        continue;
      }

      if (!entry.isFile()) continue;

      filesSeen += 1;
      if (filesSeen > maxFiles) {
        throw new ScanLimitError(maxFiles);
      }

      if (isIgnoredFileName(entry.name)) continue;
      if (isSensitiveRelPath(relPath)) {
        filesExcluded += 1;
        continue;
      }

      const absPath = path.join(absDir, entry.name);
      let stat;
      try {
        stat = await fs.stat(absPath);
      } catch (error) {
        errors.push(
          `无法读取文件 ${relPath}：${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }

      const ext = extOf(entry.name);
      const parentPath = relPath.includes("/")
        ? relPath.slice(0, relPath.lastIndexOf("/"))
        : "";

      files.push({
        relPath,
        name: entry.name,
        ext,
        kind: kindOfExt(ext),
        sizeBytes: stat.size,
        mtimeMs: Math.round(stat.mtimeMs),
        ctimeMs: Number.isFinite(stat.ctimeMs) ? Math.round(stat.ctimeMs) : null,
        parentPath,
        depth: relPath.split("/").length - 1,
      });

      if (files.length % 300 === 0) emitProgress(relDir || ".");
    }
  }

  await walk(root, "");
  emitProgress(".", true);

  return {
    files,
    filesSeen,
    filesIndexed: files.length,
    filesExcluded,
    errors: errors.slice(0, 50),
  };
}
