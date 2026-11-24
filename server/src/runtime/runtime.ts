import { randomUUID } from "node:crypto";
import type { Config } from "../config.ts";
import type {
  ModelProvider,
  ProviderMessage,
  ProviderToolCall,
  ProviderUsage,
} from "../model/types.ts";
import type { SessionRecord } from "../store/sessions.ts";
import { recordAudit } from "../store/audit.ts";
import type { Db } from "../store/db.ts";
import { injectableMemories } from "../store/memory.ts";
import { appendMessage, listSessionMessages, nextTurn } from "../store/messages.ts";
import { recordQuery, updateQueryResultCount } from "../store/queries.ts";
import {
  setSessionMemorySnapshot,
  setSessionPrefixHash,
  touchSession,
  type MemorySnapshotEntry,
} from "../store/sessions.ts";
import { recordToolCall } from "../store/toolcalls.ts";
import { recordTrace } from "../store/traces.ts";
import { assembleContext, hashText } from "./assembler.ts";
import type { ConfirmBroker, ConfirmOutcome } from "./confirm.ts";
import type { ToolPlan } from "./tool-kit.ts";
import {
  ToolRegistry,
  type ToolContext,
  type ToolExecution,
} from "./tools.ts";

export class RuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
  }
}

export interface RuntimeDeps {
  db: Db;
  config: Config;
  provider: ModelProvider;
  tools: ToolRegistry;
  skills: Parameters<typeof assembleContext>[0]["skills"];
  confirm: ConfirmBroker;
}

export interface TurnInput {
  session: SessionRecord;
  userText: string;
  signal: AbortSignal;
  emit: (event: string, data: unknown) => void;
}

export interface TurnResult {
  messageId: string;
  traceId: string | null;
  usage: UsageTotals;
}

export interface UsageTotals {
  prompt: number;
  cached: number;
  completion: number;
  cost: number;
}

interface AggregatedCall {
  index: number;
  id: string;
  name: string;
  arguments: string;
}

interface CallAggregate {
  text: string;
  reasoning: string;
  calls: AggregatedCall[];
  finishReason: string;
  usage: ProviderUsage;
  sawUsage: boolean;
}

const MAX_TOOL_ROUND_CHARS = 16_000;

function addUsage(total: UsageTotals, usage: ProviderUsage): void {
  total.prompt += usage.prompt;
  total.cached += usage.cached;
  total.completion += usage.completion;
  total.cost +=
    (Math.max(0, usage.prompt - usage.cached) / 1e6) * 0.14 +
    (usage.cached / 1e6) * 0.0028 +
    (usage.completion / 1e6) * 0.28;
}

function emptyUsage(): ProviderUsage {
  return { prompt: 0, cached: 0, completion: 0 };
}

async function aggregateStream(
  provider: ModelProvider,
  req: Parameters<ModelProvider["streamChat"]>[0],
  signal: AbortSignal,
  onText?: (text: string) => void,
): Promise<CallAggregate> {
  let text = "";
  let reasoning = "";
  let finishReason = "";
  let usage = emptyUsage();
  let sawUsage = false;
  const calls = new Map<number, { id: string; name: string; arguments: string }>();

  for await (const event of provider.streamChat(req, signal)) {
    if (signal.aborted) throw new RuntimeError("aborted", "请求已取消");
    if (event.type === "text_delta") {
      text += event.text;
      onText?.(event.text);
      continue;
    }
    if (event.type === "reasoning_delta") {
      reasoning += event.text;
      continue;
    }
    if (event.type === "usage") {
      usage = event.usage;
      sawUsage = true;
      continue;
    }
    if (event.type === "finish") {
      finishReason = event.reason;
      continue;
    }
    const current = calls.get(event.index) ?? { id: "", name: "", arguments: "" };
    if (event.id) current.id = event.id;
    if (event.name) current.name += event.name;
    if (event.arguments) current.arguments += event.arguments;
    calls.set(event.index, current);
  }

  const ordered: AggregatedCall[] = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, call]) => ({
      index,
      id: call.id || `call_${randomUUID()}`,
      name: call.name,
      arguments: call.arguments || "{}",
    }));

  return { text, reasoning, calls: ordered, finishReason, usage, sawUsage };
}

function safeParseArgs(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function canonicalArgs(text: string): string {
  const parsed = safeParseArgs(text);
  return parsed === null ? text : JSON.stringify(parsed);
}

function toSseUsage(total: UsageTotals): Record<string, number> {
  return {
    prompt: total.prompt,
    cached: total.cached,
    completion: total.completion,
    cost: Number(total.cost.toFixed(6)),
  };
}

function toolResultEvent(call: ProviderToolCall, result: ToolExecution): Record<string, unknown> {
  return {
    toolCallId: call.id,
    name: call.name,
    ok: result.ok,
    summary: result.summary,
    durationMs: result.durationMs,
    ...(result.data === undefined ? {} : { data: result.data }),
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}

/** 审计/事件里不能塞完整的 200 KB 正文。 */
function clipArgs(args: unknown): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    out[key] =
      typeof value === "string" && value.length > 500
        ? `${value.slice(0, 500)}…（${value.length} 字符）`
        : value;
  }
  return out;
}

function actionError(code: string, message: string): ToolExecution {
  return {
    ok: false,
    summary: message,
    error: { code, message },
    modelContent: JSON.stringify({ ok: false, error: { code, message } }),
    durationMs: 0,
    sensitive: false,
  };
}

function rejectedExecution(outcome: Exclude<ConfirmOutcome, "allow">): ToolExecution {
  const map = {
    deny: {
      code: "rejected",
      message: "用户取消了这个操作，没有做任何修改。不要声称已经执行。",
    },
    expired: {
      code: "confirm_timeout",
      message: "等待用户确认超时，操作没有执行。",
    },
    aborted: {
      code: "aborted",
      message: "请求已取消，操作没有执行。",
    },
  } as const;
  const { code, message } = map[outcome];
  return {
    ok: false,
    summary: message,
    error: { code, message },
    modelContent: JSON.stringify({ ok: false, error: { code, message } }),
    durationMs: 0,
    sensitive: false,
  };
}

export async function runTurn(deps: RuntimeDeps, input: TurnInput): Promise<TurnResult> {
  const { db, config, provider, tools } = deps;
  const { session, userText, signal, emit } = input;
  const turn = nextTurn(db, session.id);

  appendMessage(db, {
    sessionId: session.id,
    turn,
    role: "user",
    content: { text: userText },
  });
  touchSession(db, session.id, userText);
  const queryId = recordQuery(db, { text: userText, sessionId: session.id });

  const history = listSessionMessages(db, session.id);
  // 记忆在会话开始时定格；会话中新增的记忆靠工具结果留在历史里，不改 system，避免缓存失效。
  let memories: MemorySnapshotEntry[] = session.memorySnapshot ?? [];
  if (!session.memorySnapshot) {
    memories = injectableMemories(db).map((memory) => ({
      id: memory.id,
      kind: memory.kind,
      fact: memory.fact,
    }));
    setSessionMemorySnapshot(db, session.id, memories);
  }
  const assembled = assembleContext({
    db,
    config,
    skills: deps.skills,
    history,
    userText,
    memories,
  });

  if (!session.staticPrefixHash) {
    setSessionPrefixHash(db, session.id, assembled.prefixHash);
  } else if (session.staticPrefixHash !== assembled.prefixHash) {
    console.warn(
      `[mp] 会话 ${session.id} 的静态前缀发生变化，prompt cache 可能失效。`,
    );
    setSessionPrefixHash(db, session.id, assembled.prefixHash);
  }

  const messages: ProviderMessage[] = [...assembled.messages];
  const totals: UsageTotals = { prompt: 0, cached: 0, completion: 0, cost: 0 };
  let lastTraceId: string | null = null;
  let searchCount: number | null = null;
  let toolChars = 0;
  let previousCallKey = "";
  let repeated = 0;
  let destructiveCount = 0;

  for (let callIndex = 1; callIndex <= config.maxTurns; callIndex += 1) {
    if (signal.aborted) throw new RuntimeError("aborted", "请求已取消");

    const started = Date.now();
    const aggregate = await aggregateStream(
      provider,
      {
        model: config.model,
        messages,
        tools: tools.definitions(),
        maxOutputTokens: config.maxOutputTokens,
        thinking: config.thinking,
      },
      signal,
      (text) => emit("text_delta", { text }),
    );
    const latencyMs = Date.now() - started;

    if (aggregate.sawUsage) {
      addUsage(totals, aggregate.usage);
      emit("usage", toSseUsage(totals));
    }

    const finishReason =
      aggregate.finishReason === "length"
        ? "length"
        : aggregate.calls.length > 0
          ? "tool_calls"
          : aggregate.finishReason || "stop";

    const trace = recordTrace(db, {
      sessionId: session.id,
      turn,
      callIndex,
      model: config.model,
      promptHash: hashText(JSON.stringify({ messages, tools: tools.definitions() })),
      usage: {
        prompt: aggregate.usage.prompt,
        cached: aggregate.usage.cached,
        completion: aggregate.usage.completion,
        ...(aggregate.usage.reasoning ? { reasoning: aggregate.usage.reasoning } : {}),
      },
      finishReason,
      latencyMs,
      costUsd:
        (Math.max(0, aggregate.usage.prompt - aggregate.usage.cached) / 1e6) * 0.14 +
        (aggregate.usage.cached / 1e6) * 0.0028 +
        (aggregate.usage.completion / 1e6) * 0.28,
    });
    lastTraceId = trace.id;

    if (finishReason === "length") {
      throw new RuntimeError("output_truncated", "模型输出被截断，请缩小问题范围。");
    }

    if (aggregate.calls.length === 0) {
      if (!aggregate.text.trim()) {
        throw new RuntimeError("empty_response", "模型没有返回可用回答。");
      }
      const message = appendMessage(db, {
        sessionId: session.id,
        turn,
        role: "assistant",
        content: { text: aggregate.text },
      });
      touchSession(db, session.id);
      emit("done", {
        messageId: message.id,
        traceId: lastTraceId,
        usage: toSseUsage(totals),
        status: "done",
      });
      return { messageId: message.id, traceId: lastTraceId, usage: totals };
    }

    const calls: ProviderToolCall[] = aggregate.calls.map((call) => ({
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    }));

    messages.push({
      role: "assistant",
      content: aggregate.text,
      toolCalls: calls,
    });
    appendMessage(db, {
      sessionId: session.id,
      turn,
      role: "assistant",
      content: { text: aggregate.text, toolCalls: calls },
    });

    for (const call of calls) {
      const key = `${call.name}:${canonicalArgs(call.arguments)}`;
      if (key === previousCallKey) {
        repeated += 1;
      } else {
        previousCallKey = key;
        repeated = 1;
      }
      if (repeated >= 2) {
        throw new RuntimeError(
          "loop_detected",
          "检索在原地打转：同一个工具和参数连续调用了两次，已停止。",
        );
      }

      const parsedArgs = safeParseArgs(call.arguments);
      const auditArgs = clipArgs(parsedArgs);
      emit("tool_start", {
        toolCallId: call.id,
        name: call.name,
        args: auditArgs,
        argsText: call.arguments.length > 500 ? `${call.arguments.slice(0, 500)}…` : call.arguments,
      });

      const ctx: ToolContext = {
        db,
        config,
        skills: deps.skills,
        sessionId: session.id,
        turn,
        signal,
      };

      const tool = tools.get(call.name);
      const isDestructive = tool?.permission === "write" || tool?.permission === "delete";
      let result: ToolExecution;
      let confirmed = false;

      if (isDestructive) {
        let plan: ToolPlan | null = null;
        if (!config.allowWrites) {
          result = actionError("writes_disabled", "写操作已关闭（MP_ALLOW_WRITES=0）。");
        } else if (destructiveCount >= config.maxDestructive) {
          result = actionError(
            "destructive_limit",
            `这一轮已经确认了 ${config.maxDestructive} 个写/删操作，达到上限；剩下的请下一轮再提。`,
          );
        } else {
          const prepared = await tools.prepare(call.name, call.arguments, ctx);
          if (!prepared.ok || !prepared.plan) {
            result = prepared.execution ?? actionError("tool_error", "准备操作失败");
          } else {
            plan = prepared.plan;
            result = actionError("pending", "等待确认");
          }
        }

        if (plan) {
          const pending = deps.confirm.create(
            {
              sessionId: session.id,
              turn,
              toolCallId: call.id,
              tool: call.name,
              args: auditArgs,
              preview: plan.preview,
            },
            signal,
          );
          recordAudit(db, {
            sessionId: session.id,
            turn,
            tool: call.name,
            args: auditArgs,
            decision: "confirm",
            result: `等待用户确认（${pending.actionId}）`,
          });
          emit("confirm_required", {
            actionId: pending.actionId,
            toolCallId: call.id,
            tool: call.name,
            expiresAt: pending.expiresAt,
            ...plan.preview,
          });

          const outcome = await pending.decision;
          if (outcome === "aborted") throw new RuntimeError("aborted", "请求已取消");
          if (outcome === "allow") {
            destructiveCount += 1;
            confirmed = true;
            result = await tools.apply(plan, ctx);
          } else {
            result = rejectedExecution(outcome);
          }
        }
      } else {
        result = await tools.execute(call.name, call.arguments, ctx);
      }

      // 最近问过的「结果数」要同时覆盖元数据检索和正文检索；
      // 一轮里可能先搜文件再搜正文，取命中最多的那次，避免后面的窄查询把它抹成 0。
      if (result.ok && (call.name === "search_files" || call.name === "search_content")) {
        const data = result.data as { files?: unknown[]; hits?: unknown[] } | undefined;
        const count = Array.isArray(data?.files)
          ? data.files.length
          : Array.isArray(data?.hits)
            ? data.hits.length
            : 0;
        if (count > (searchCount ?? 0)) {
          searchCount = count;
          updateQueryResultCount(db, queryId, count);
        }
      }

      recordToolCall(db, {
        id: call.id,
        sessionId: session.id,
        turn,
        name: call.name,
        args: auditArgs,
        result: { ok: result.ok, summary: result.summary },
        ok: result.ok,
        errorCode: result.error?.code ?? null,
        durationMs: result.durationMs,
      });
      recordAudit(db, {
        sessionId: session.id,
        turn,
        tool: call.name,
        ...(result.sensitive ? {} : { args: auditArgs }),
        decision: result.ok ? "allow" : "deny",
        result: result.sensitive
          ? "敏感文件已拦截"
          : confirmed && result.ok
            ? `已确认 · ${result.summary}`
            : result.summary,
        durationMs: result.durationMs,
      });

      emit("tool_result", toolResultEvent(call, result));

      let content = result.modelContent;
      if (toolChars + content.length > MAX_TOOL_ROUND_CHARS) {
        content = JSON.stringify({
          ok: result.ok,
          summary: result.summary,
          truncated: true,
          note: "本轮工具结果总长超过 16K 字符，后续结果已压缩；请缩小范围。",
        });
      } else {
        toolChars += content.length;
      }

      messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content,
      });
      appendMessage(db, {
        sessionId: session.id,
        turn,
        role: "tool",
        content: {
          text: content,
          toolCallId: call.id,
          name: call.name,
        },
      });
    }
  }

  throw new RuntimeError(
    "max_turns",
    `已达到单轮最多 ${config.maxTurns} 次模型调用的上限，先停在这里。`,
  );
}
