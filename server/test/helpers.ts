import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Config } from "../src/config.ts";
import { openDatabase, type Db } from "../src/store/db.ts";
import { startOfWeek } from "../src/util/time.ts";

const DAY = 86_400_000;

export interface TestContext {
  root: string;
  workspace: string;
  config: Config;
  db: Db;
  cleanup: () => void;
}

function write(root: string, relPath: string, content = "fixture\n"): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function setMtime(root: string, relPath: string, ms: number): void {
  const abs = path.join(root, relPath);
  const date = new Date(ms);
  fs.utimesSync(abs, date, date);
}

export function createTestContext(): TestContext {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mp-test-"));
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });

  const now = Date.now();
  const lastWeek = startOfWeek(now) - 7 * DAY + 3 * DAY;

  write(workspace, "docs/2026-Q3-营收分析.md", "# Q3 营收分析\n\n订阅收入增长。\n");
  write(workspace, "docs/RAG-检索策略.md", "# RAG 检索策略\n\n关键词与向量混合。\n");
  fs.copyFileSync(
    path.join(import.meta.dirname, "fixtures/archive.pdf"),
    path.join(workspace, "docs/方案.pdf"),
  );
  write(workspace, "docs/public.md", "# 公开笔记\n");
  write(workspace, "docs/.env", "DEEPSEEK_API_KEY=sk-should-never-be-indexed\n");
  write(workspace, "docs/id_rsa", "-----BEGIN OPENSSH PRIVATE KEY-----\n");
  write(workspace, "docs/client-credentials.json", "{\"token\":\"secret\"}\n");
  write(workspace, "sheets/Q3-预算.xlsx", "xlsx fixture\n");
  write(workspace, "images/架构草图.png", "png fixture\n");
  write(workspace, "design/brand-guide.md", "# 品牌指南\n");
  write(workspace, "root-note.txt", "根目录便签\n");
  write(workspace, ".DS_Store", "junk\n");
  write(workspace, ".git/config", "[core]\n");
  write(workspace, "node_modules/pkg/index.js", "module.exports = 1\n");

  setMtime(workspace, "docs/方案.pdf", lastWeek);

  try {
    fs.symlinkSync("/etc/hosts", path.join(workspace, "docs/outside.md"));
  } catch {
    // 部分文件系统不允许符号链接；测试里它不是必需项。
  }

  const config: Config = {
    repoRoot: root,
    serverRoot: path.resolve(import.meta.dirname, ".."),
    workspaceRoot: fs.realpathSync(workspace),
    workspaceDisplayName: "测试工作区",
    dbPath: path.join(root, "data", "test.sqlite"),
    host: "127.0.0.1",
    port: 0,
    model: "deepseek-v4-flash",
    provider: "mock",
    apiKey: null,
    baseUrl: "https://api.deepseek.com",
    thinking: false,
    maxTurns: 12,
    maxOutputTokens: 8192,
    allowReveal: false,
    allowWrites: true,
    trashDir: path.join(root, "trash"),
    confirmTimeoutMs: 2_000,
    maxDestructive: 3,
    origins: ["http://localhost:5173"],
    indexOnStart: false,
  };

  const db = openDatabase(config.dbPath);

  return {
    root,
    workspace,
    config,
    db,
    cleanup: () => {
      try {
        db.close();
      } catch {
        // 已关闭。
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export function makePrivilegedConfig(config: Config, overrides: Partial<Config> = {}): Config {
  return { ...config, ...overrides };
}
