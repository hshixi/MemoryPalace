import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ProviderName = "deepseek" | "mock";

export interface Config {
  repoRoot: string;
  serverRoot: string;
  workspaceRoot: string;
  workspaceDisplayName: string;
  dbPath: string;
  host: string;
  port: number;
  model: string;
  provider: ProviderName;
  apiKey: string | null;
  baseUrl: string;
  thinking: boolean;
  maxTurns: number;
  maxOutputTokens: number;
  allowReveal: boolean;
  allowWrites: boolean;
  trashDir: string;
  confirmTimeoutMs: number;
  maxDestructive: number;
  origins: string[];
  indexOnStart: boolean;
}

export class ConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ConfigError";
    this.code = code;
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");
const repoRoot = path.resolve(serverRoot, "..");

function loadDotEnv(): void {
  const envPath = path.join(serverRoot, ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    throw new ConfigError(
      "env_load_failed",
      `读取 ${envPath} 失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const value = env(name);
  if (value === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function intEnv(name: string, fallback: number): number {
  const value = env(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError("invalid_config", `${name} 必须是正整数，当前为 ${value}`);
  }
  return parsed;
}

function displayNameFor(root: string): string {
  const base = path.basename(root);
  return base === "workspace-sample" ? "示例工作区" : base || root;
}

export function loadConfig(): Config {
  loadDotEnv();

  const workspaceRoot = path.resolve(
    env("MP_WORKSPACE") ?? path.join(repoRoot, "workspace-sample"),
  );

  if (!fs.existsSync(workspaceRoot)) {
    throw new ConfigError(
      "workspace_missing",
      `工作区不存在：${workspaceRoot}\n请检查 MP_WORKSPACE，或使用默认的 workspace-sample/。`,
    );
  }
  const stat = fs.statSync(workspaceRoot);
  if (!stat.isDirectory()) {
    throw new ConfigError("workspace_not_dir", `工作区不是文件夹：${workspaceRoot}`);
  }

  const dbPath = path.resolve(
    env("MP_DB") ?? path.join(serverRoot, "data", "mp.sqlite"),
  );

  const provider = (env("MP_PROVIDER") ?? "deepseek").toLowerCase();
  if (provider !== "deepseek" && provider !== "mock") {
    throw new ConfigError(
      "invalid_provider",
      `MP_PROVIDER 只能是 deepseek 或 mock，当前为 ${provider}`,
    );
  }

  const origins = (env("MP_ORIGINS") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    repoRoot,
    serverRoot,
    workspaceRoot: fs.realpathSync(workspaceRoot),
    workspaceDisplayName: displayNameFor(workspaceRoot),
    dbPath,
    host: env("MP_HOST") ?? "127.0.0.1",
    port: intEnv("MP_PORT", 4310),
    model: env("MP_MODEL") ?? "deepseek-v4-flash",
    provider,
    apiKey: env("DEEPSEEK_API_KEY") ?? null,
    baseUrl: (env("DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com").replace(/\/+$/, ""),
    thinking: boolEnv("MP_THINKING", false),
    maxTurns: intEnv("MP_MAX_TURNS", 12),
    maxOutputTokens: intEnv("MP_MAX_OUTPUT_TOKENS", 8192),
    allowReveal: boolEnv("MP_ALLOW_REVEAL", true),
    // 写操作总开关；关掉后写/删工具不会注册，模型根本看不到。
    allowWrites: boolEnv("MP_ALLOW_WRITES", true),
    // 删除只进系统废纸篓，永不 rm。测试里用 MP_TRASH_DIR 指向临时目录。
    trashDir: path.resolve(env("MP_TRASH_DIR") ?? path.join(os.homedir(), ".Trash")),
    confirmTimeoutMs: intEnv("MP_CONFIRM_TIMEOUT_MS", 120_000),
    maxDestructive: intEnv("MP_MAX_DESTRUCTIVE", 3),
    origins:
      origins.length > 0
        ? origins
        : [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:4173",
            "http://127.0.0.1:4173",
          ],
    indexOnStart: boolEnv("MP_INDEX_ON_START", true),
  };
}
