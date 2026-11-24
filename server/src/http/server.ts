import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Config } from "../config.ts";
import { searchFiles } from "../index/search.ts";
import { buildOverview } from "../index/overview.ts";
import type { IndexService } from "../index/service.ts";
import { buildTopics } from "../index/topics.ts";
import { createProvider } from "../model/index.ts";
import { ProviderError } from "../model/types.ts";
import { resolveInsideWorkspace } from "../policy/paths.ts";
import { ConfirmBroker } from "../runtime/confirm.ts";
import { RuntimeError, runTurn } from "../runtime/runtime.ts";
import { createSseWriter } from "../runtime/sse.ts";
import { ToolRegistry } from "../runtime/tools.ts";
import { SkillLibrary } from "../skills/loader.ts";
import { listAudit, recordAudit } from "../store/audit.ts";
import type { Db } from "../store/db.ts";
import {
  browseFolder,
  countFiles,
  getFileByRelPath,
  listFiles,
  type FileRecord,
} from "../store/files.ts";
import {
  injectableMemories,
  listMemories,
  removeMemory,
  touchMemories,
} from "../store/memory.ts";
import { listSessionMessages } from "../store/messages.ts";
import { getLastRun, getRun } from "../store/runs.ts";
import {
  createSession,
  getSession,
  listSessions,
  type MemorySnapshotEntry,
  type SessionRecord,
} from "../store/sessions.ts";
import { listTraces } from "../store/traces.ts";
import { formatBytes, formatRelativeTime, shortenHome } from "../util/format.ts";
import { HttpError, errorBody, toHttpError } from "./errors.ts";

const MAX_BODY_BYTES = 1_048_576;

interface ApiFile {
  id: number;
  name: string;
  path: string;
  kind: string;
  ext: string;
  sizeBytes: number;
  sizeLabel: string;
  modifiedAt: number;
  modifiedLabel: string;
}

function toApiFile(file: FileRecord, now = Date.now()): ApiFile {
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

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function sendError(res: ServerResponse, error: unknown): void {
  const httpError = toHttpError(error);
  if (httpError.status >= 500) {
    console.error(`[mp] ${httpError.code}: ${httpError.message}`);
  }
  json(res, httpError.status, errorBody(httpError));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "body_too_large", "请求体超过 1 MB");
    }
    chunks.push(buf);
  }
  if (size === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "invalid_json", "请求体必须是 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, "invalid_parameter", `参数不是数字：${value}`);
  }
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function timeParam(value: string | null, name: string): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new HttpError(400, "invalid_parameter", `${name} 不是合法时间：${value}`);
  }
  return parsed;
}

function checkOrigin(req: IncomingMessage, config: Config): string | null {
  const origin = req.headers.origin;
  if (!origin) return null;
  if (config.origins.includes(origin)) return origin;
  throw new HttpError(403, "origin_denied", `来源不在白名单：${origin}`);
}

function applyCors(req: IncomingMessage, res: ServerResponse, config: Config): void {
  const origin = checkOrigin(req, config);
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export interface ServerDeps {
  config: Config;
  db: Db;
  indexService: IndexService;
}

/** 新会话定格当前的长期记忆；会话内新增的记忆只走工具结果，不改 system。 */
function startSession(db: Db, config: Config, title?: string): SessionRecord {
  const snapshot: MemorySnapshotEntry[] = injectableMemories(db).map(
    (memory) => ({
      id: memory.id,
      kind: memory.kind,
      fact: memory.fact,
    }),
  );
  const session = createSession(db, {
    workspaceRoot: config.workspaceRoot,
    ...(title ? { title } : {}),
    memorySnapshot: snapshot,
  });
  touchMemories(
    db,
    snapshot.map((entry) => entry.id),
  );
  return session;
}

function runtimeErrorPayload(error: unknown): { code: string; message: string } {
  if (error instanceof RuntimeError || error instanceof ProviderError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof HttpError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "internal_error",
    message: error instanceof Error ? error.message : String(error),
  };
}

export function createApiServer(deps: ServerDeps): http.Server {
  const { config, db, indexService } = deps;
  const provider = createProvider(config);
  const skills = new SkillLibrary(path.join(config.serverRoot, "skills"));
  const tools = new ToolRegistry(undefined, { allowWrites: config.allowWrites });
  const confirm = new ConfirmBroker(db, config.confirmTimeoutMs);
  const activeSessions = new Set<string>();

  return http.createServer((req, res) => {
    void handle(req, res).catch((error) => {
      if (!res.headersSent) {
        sendError(res, error);
      } else {
        res.end();
      }
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      applyCors(req, res, config);

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      const pathname = url.pathname;
      const method = req.method ?? "GET";

      if (method === "GET" && pathname === "/api/health") {
        const files = countFiles(db);
        const run = getLastRun(db);
        const status = indexService.isRunning() ? "indexing" : files > 0 ? "ready" : "empty";
        json(res, 200, {
          ok: true,
          version: "0.1.0",
          model: config.model,
          provider: config.provider,
          apiKeyConfigured: Boolean(config.apiKey),
          workspace: {
            path: shortenHome(config.workspaceRoot),
            displayName: config.workspaceDisplayName,
            exists: fs.existsSync(config.workspaceRoot),
          },
          index: {
            status,
            files,
            lastIndexedAt: run?.finishedAt ?? null,
            lastRunId: run?.id ?? null,
          },
        });
        return;
      }

      if (method === "GET" && pathname === "/api/overview") {
        json(res, 200, buildOverview(db, config, indexService));
        return;
      }

      if (method === "GET" && pathname === "/api/topics") {
        json(res, 200, buildTopics(db));
        return;
      }

      if (method === "GET" && pathname === "/api/search") {
        const query = url.searchParams.get("q") ?? "";
        const k = intParam(url.searchParams.get("k"), 8, 1, 20);
        const type = url.searchParams.get("type") ?? undefined;
        const modifiedAfter = timeParam(url.searchParams.get("modifiedAfter"), "modifiedAfter");
        const modifiedBefore = timeParam(url.searchParams.get("modifiedBefore"), "modifiedBefore");
        json(res, 200, searchFiles(db, query, { k, type, modifiedAfter, modifiedBefore }));
        return;
      }

      if (method === "GET" && pathname === "/api/files") {
        const parent = url.searchParams.get("parent");
        const kind = url.searchParams.get("kind") ?? undefined;
        const limit = intParam(url.searchParams.get("limit"), 200, 1, 1000);
        const files = listFiles(db, {
          ...(parent !== null ? { parentPath: parent } : {}),
          ...(kind ? { kind } : {}),
          limit,
        });
        json(res, 200, { files: files.map((file) => toApiFile(file)) });
        return;
      }

      if (method === "GET" && pathname === "/api/browse") {
        const parent = url.searchParams.get("path") ?? "";
        const offset = intParam(url.searchParams.get("offset"), 0, 0, 1_000_000);
        const limit = intParam(url.searchParams.get("limit"), 50, 1, 200);
        const resolved = resolveInsideWorkspace(parent, config.workspaceRoot, {
          allowRoot: true,
        });
        const result = browseFolder(db, resolved.relPath, { offset, limit });
        const parts = resolved.relPath ? resolved.relPath.split("/") : [];
        const breadcrumbs = parts.map((name, index) => ({
          name,
          path: parts.slice(0, index + 1).join("/"),
        }));
        json(res, 200, {
          ...result,
          files: result.files.map((file) => toApiFile(file)),
          breadcrumbs,
        });
        return;
      }

      if (method === "GET" && pathname === "/api/file") {
        const rel = url.searchParams.get("path");
        if (!rel) throw new HttpError(400, "missing_path", "缺少 path 参数");
        const resolved = resolveInsideWorkspace(rel, config.workspaceRoot);
        const file = getFileByRelPath(db, resolved.relPath);
        if (!file) throw new HttpError(404, "not_indexed", "文件不在索引里");
        json(res, 200, { file: toApiFile(file) });
        return;
      }

      if (method === "POST" && pathname === "/api/index/rebuild") {
        const started = indexService.start();
        json(res, started.alreadyRunning ? 409 : 202, {
          runId: started.runId,
          status: started.alreadyRunning ? "running" : "started",
          alreadyRunning: started.alreadyRunning,
        });
        return;
      }

      const runMatch = pathname.match(/^\/api\/index\/runs\/([^/]+)$/);
      if (method === "GET" && runMatch) {
        const runId = decodeURIComponent(runMatch[1]);
        const run = getRun(db, runId);
        if (!run) throw new HttpError(404, "run_not_found", "索引任务不存在");
        json(res, 200, {
          id: run.id,
          status: run.status,
          filesSeen: run.filesSeen,
          filesIndexed: run.filesIndexed,
          filesExcluded: run.filesExcluded,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          errors: run.errorsJson ? JSON.parse(run.errorsJson) : [],
        });
        return;
      }

      if (method === "POST" && pathname === "/api/reveal") {
        if (!config.allowReveal) {
          throw new HttpError(403, "reveal_disabled", "Finder 定位已关闭");
        }
        if (process.platform !== "darwin") {
          throw new HttpError(501, "unsupported_platform", "当前只支持 macOS 的 Finder 定位");
        }
        const body = await readJson(req);
        const rel = body.path;
        if (typeof rel !== "string" || !rel) {
          throw new HttpError(400, "missing_path", "缺少 path");
        }
        const started = Date.now();
        const resolved = resolveInsideWorkspace(rel, config.workspaceRoot);
        const file = getFileByRelPath(db, resolved.relPath);
        if (!file) throw new HttpError(404, "not_indexed", "文件不在索引里");

        const child = spawn("open", ["-R", resolved.absPath], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();

        recordAudit(db, {
          tool: "reveal_in_finder",
          args: { path: resolved.relPath },
          decision: "allow",
          result: "opened",
          durationMs: Date.now() - started,
        });
        json(res, 200, { ok: true, path: resolved.relPath });
        return;
      }

      if (method === "GET" && pathname === "/api/audit") {
        const limit = intParam(url.searchParams.get("limit"), 20, 1, 200);
        json(res, 200, { events: listAudit(db, limit) });
        return;
      }

      if (method === "GET" && pathname === "/api/traces") {
        const limit = intParam(url.searchParams.get("limit"), 20, 1, 200);
        json(res, 200, { traces: listTraces(db, limit) });
        return;
      }

      if (method === "GET" && pathname === "/api/skills") {
        json(res, 200, { skills: skills.list() });
        return;
      }

      if (method === "GET" && pathname === "/api/memories") {
        json(res, 200, { memories: listMemories(db) });
        return;
      }

      const memoryMatch = pathname.match(/^\/api\/memories\/([^/]+)$/);
      if (method === "DELETE" && memoryMatch) {
        const id = decodeURIComponent(memoryMatch[1]);
        const removed = removeMemory(db, id);
        recordAudit(db, {
          tool: "memory",
          args: { id },
          decision: removed ? "allow" : "deny",
          result: removed ? "deleted" : "not_found",
        });
        if (!removed) {
          throw new HttpError(404, "memory_not_found", "这条记忆不存在");
        }
        json(res, 200, { ok: true, id });
        return;
      }

      if (method === "GET" && pathname === "/api/sessions") {
        const limit = intParam(url.searchParams.get("limit"), 50, 1, 200);
        json(res, 200, { sessions: listSessions(db, limit) });
        return;
      }

      if (method === "POST" && pathname === "/api/sessions") {
        const body = await readJson(req);
        const title = typeof body.title === "string" ? body.title : undefined;
        const session = startSession(db, config, title);
        json(res, 201, { session });
        return;
      }

      const messagesMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
      if (method === "GET" && messagesMatch) {
        const sessionId = decodeURIComponent(messagesMatch[1]);
        const session = getSession(db, sessionId);
        if (!session) throw new HttpError(404, "session_not_found", "会话不存在");
        const messages = listSessionMessages(db, sessionId).map((message) => ({
          id: message.id,
          role: message.role,
          turn: message.turn,
          createdAt: message.createdAt,
          ...(message.role === "tool"
            ? { name: message.content.name ?? "tool", hidden: true, text: "" }
            : {
                text: message.content.text,
                ...(message.content.toolCalls?.length
                  ? { toolCalls: message.content.toolCalls }
                  : {}),
              }),
        }));
        json(res, 200, { session, messages });
        return;
      }

      if (method === "POST" && pathname === "/api/confirm") {
        const body = await readJson(req);
        const actionId = body.actionId;
        const decision = body.decision;
        if (typeof actionId !== "string" || !actionId) {
          throw new HttpError(400, "missing_action", "缺少 actionId");
        }
        if (decision !== "allow" && decision !== "deny") {
          throw new HttpError(400, "invalid_decision", "decision 只能是 allow 或 deny");
        }
        const outcome = confirm.resolve(actionId, decision);
        if (outcome === "not_found") {
          throw new HttpError(404, "action_not_found", "没有这个待确认操作，可能已过期");
        }
        if (outcome === "expired") {
          throw new HttpError(410, "action_expired", "这个确认已经过期");
        }
        if (outcome === "resolved") {
          throw new HttpError(409, "action_resolved", "这个操作已经处理过了");
        }
        recordAudit(db, {
          tool: "user_confirm",
          args: { actionId, decision },
          decision: decision === "allow" ? "allow" : "deny",
          result: decision === "allow" ? "用户确认执行" : "用户取消执行",
        });
        json(res, 200, { ok: true, actionId, decision });
        return;
      }

      if (method === "POST" && pathname === "/api/chat") {
        await handleChat(req, res);
        return;
      }

      if (method === "GET" && pathname === "/") {
        json(res, 200, {
          name: "MemoryPalace API",
          version: "0.1.0",
          endpoints: [
            "/api/health",
            "/api/overview",
            "/api/topics",
            "/api/search?q=",
            "/api/files",
            "/api/browse?path=",
            "/api/file?path=",
            "/api/index/rebuild",
            "/api/reveal",
            "/api/audit",
            "/api/chat",
            "/api/confirm",
            "/api/sessions",
            "/api/traces",
            "/api/skills",
            "/api/memories",
          ],
        });
        return;
      }

      throw new HttpError(404, "not_found", `没有这个接口：${method} ${pathname}`);
    } catch (error) {
      sendError(res, error);
    }
  }

  async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req);

    if (typeof body.message !== "string") {
      throw new HttpError(400, "invalid_message", "message 必须是字符串");
    }
    const userText = body.message.trim();
    if (!userText) {
      throw new HttpError(400, "invalid_message", "message 不能为空");
    }
    if (userText.length > 8_000) {
      throw new HttpError(400, "message_too_long", "message 不能超过 8,000 字符");
    }
    if (body.sessionId !== undefined && typeof body.sessionId !== "string") {
      throw new HttpError(400, "invalid_session", "sessionId 必须是字符串");
    }
    if (config.provider === "deepseek" && !config.apiKey) {
      throw new HttpError(
        503,
        "missing_api_key",
        "没有配置 DEEPSEEK_API_KEY。可以设置 MP_PROVIDER=mock 先用假模型开发。",
      );
    }

    let session: SessionRecord;
    if (typeof body.sessionId === "string" && body.sessionId) {
      const existing = getSession(db, body.sessionId);
      if (!existing) throw new HttpError(404, "session_not_found", "会话不存在");
      if (existing.workspaceRoot !== config.workspaceRoot) {
        throw new HttpError(409, "workspace_mismatch", "这个会话属于另一个工作区");
      }
      session = existing;
    } else {
      session = startSession(db, config, userText);
    }

    if (activeSessions.has(session.id)) {
      throw new HttpError(409, "session_busy", "这个会话正在处理上一轮，请稍后");
    }
    activeSessions.add(session.id);

    const controller = new AbortController();
    let writer: ReturnType<typeof createSseWriter> | null = null;

    try {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();

      writer = createSseWriter(res);
      writer.startHeartbeat();
      writer.send("session", { sessionId: session.id });

      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });

      await runTurn(
        { db, config, provider, tools, skills, confirm },
        {
          session,
          userText,
          signal: controller.signal,
          emit: (event, data) => writer?.send(event, data),
        },
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        const payload = runtimeErrorPayload(error);
        if (writer && !writer.closed) {
          writer.send("error", payload);
        } else if (!res.headersSent) {
          throw error;
        } else {
          console.error(`[mp] chat ${payload.code}: ${payload.message}`);
        }
      }
    } finally {
      activeSessions.delete(session.id);
      writer?.end();
    }
  }
}
