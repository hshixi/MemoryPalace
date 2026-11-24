import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { Config } from "../src/config.ts";
import { IndexService } from "../src/index/service.ts";
import type {
  ChatRequest,
  ModelProvider,
  ProviderCapabilities,
  StreamEvent,
} from "../src/model/types.ts";
import { ConfirmBroker } from "../src/runtime/confirm.ts";
import { RuntimeError, runTurn } from "../src/runtime/runtime.ts";
import { ToolRegistry } from "../src/runtime/tools.ts";
import { SkillLibrary } from "../src/skills/loader.ts";
import { listAudit } from "../src/store/audit.ts";
import type { Db } from "../src/store/db.ts";
import { getSession, createSession } from "../src/store/sessions.ts";
import { listToolCalls } from "../src/store/toolcalls.ts";
import { listTraces } from "../src/store/traces.ts";
import { createTestContext, type TestContext } from "./helpers.ts";

let ctx: TestContext;
let skills: SkillLibrary;

before(async () => {
  ctx = createTestContext();
  await new IndexService(ctx.db, ctx.config).indexNow();
  skills = new SkillLibrary(path.join(ctx.config.serverRoot, "skills"));
});

after(() => {
  ctx.cleanup();
});

class ScriptedProvider implements ModelProvider {
  readonly id = "scripted";
  readonly capabilities: ProviderCapabilities = {
    tools: true,
    parallelToolCalls: false,
    streaming: true,
    prefixCache: false,
    reasoning: false,
    maxContext: 64_000,
    maxOutput: 4_000,
  };
  readonly requests: ChatRequest[] = [];
  private readonly scripts: StreamEvent[][];

  constructor(scripts: StreamEvent[][]) {
    this.scripts = scripts;
  }

  async *streamChat(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
    this.requests.push(req);
    const script = this.scripts.shift();
    if (!script) throw new Error("脚本用完了");
    for (const event of script) {
      if (signal.aborted) throw new Error("aborted");
      yield event;
    }
  }
}

function toolCall(id: string, name: string, args: Record<string, unknown>): StreamEvent[] {
  return [
    {
      type: "tool_call_delta",
      index: 0,
      id,
      name,
      arguments: JSON.stringify(args),
    },
    { type: "usage", usage: { prompt: 100, cached: 40, completion: 20 } },
    { type: "finish", reason: "tool_calls" },
  ];
}

function answer(text: string): StreamEvent[] {
  return [
    { type: "text_delta", text },
    { type: "usage", usage: { prompt: 120, cached: 80, completion: 12 } },
    { type: "finish", reason: "stop" },
  ];
}

function makeSession() {
  return createSession(ctx.db, { workspaceRoot: ctx.config.workspaceRoot, title: "测试" });
}

function deps(
  db: Db,
  provider: ModelProvider,
  config: Config = ctx.config,
  confirm = new ConfirmBroker(db, config.confirmTimeoutMs),
) {
  return { db, config, provider, tools: new ToolRegistry(), skills, confirm };
}

async function collect(
  provider: ModelProvider,
  userText: string,
  config: Config = ctx.config,
) {
  const session = makeSession();
  const events: Array<{ event: string; data: unknown }> = [];
  const result = await runTurn(deps(ctx.db, provider, config), {
    session,
    userText,
    signal: new AbortController().signal,
    emit: (event, data) => events.push({ event, data }),
  });
  return { session, events, result };
}

describe("运行时", () => {
  it("工具调用 → 工具结果 → 最终回答，并写入全部账本", async () => {
    const provider = new ScriptedProvider([
      toolCall("call_1", "search_files", { query: "营收" }),
      answer("找到一份 Q3 营收分析。"),
    ]);
    const { session, events, result } = await collect(provider, "营收文件在哪");

    assert.equal(result.usage.prompt, 220);
    assert.equal(result.usage.cached, 120);
    assert.ok(result.usage.cost > 0);
    assert.ok(result.traceId?.startsWith("tr_"));

    const names = events.map((event) => event.event);
    assert.ok(names.includes("tool_start"));
    assert.ok(names.includes("tool_result"));
    assert.ok(names.includes("text_delta"));
    assert.ok(names.includes("done"));
    assert.equal(names.filter((name) => name === "usage").length, 2);

    const toolStart = events.find((event) => event.event === "tool_start");
    assert.deepEqual((toolStart?.data as { args: unknown }).args, { query: "营收" });

    const toolResult = events.find((event) => event.event === "tool_result");
    assert.equal((toolResult?.data as { name: string }).name, "search_files");
    assert.equal((toolResult?.data as { ok: boolean }).ok, true);

    const messages = ctx.db
      .prepare("SELECT role, content_json FROM messages WHERE session_id = ? ORDER BY rowid")
      .all(session.id) as unknown as Array<{ role: string; content_json: string }>;
    assert.deepEqual(
      messages.map((message) => message.role),
      ["user", "assistant", "tool", "assistant"],
    );

    const calls = listToolCalls(ctx.db, session.id);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.name, "search_files");
    assert.equal(calls[0]?.ok, true);

    const traces = listTraces(ctx.db);
    assert.ok(traces.filter((trace) => trace.sessionId === session.id).length >= 2);
    assert.ok(listAudit(ctx.db, 50).some((entry) => entry.sessionId === session.id));

    const query = ctx.db
      .prepare("SELECT result_count FROM queries WHERE session_id = ?")
      .get(session.id) as { result_count: number };
    assert.equal(query.result_count, 1);

    assert.ok(getSession(ctx.db, session.id)?.staticPrefixHash?.startsWith("sha256:"));

    const secondRequest = provider.requests[1];
    assert.ok(secondRequest.messages.some((message) => message.role === "tool"));
    const assistant = secondRequest.messages.find(
      (message) => message.role === "assistant" && message.toolCalls?.length,
    );
    assert.equal(assistant?.content, "");
  });

  it("正文检索的结果数也写进最近问过", async () => {
    const provider = new ScriptedProvider([
      toolCall("call_content", "search_content", { query: "营收", k: 5 }),
      answer("正文里有相关片段。"),
    ]);
    const { session } = await collect(provider, "哪份文件提到过营收");

    const query = ctx.db
      .prepare("SELECT result_count FROM queries WHERE session_id = ?")
      .get(session.id) as { result_count: number };
    assert.ok(query.result_count > 0, "search_content 命中后不应显示 0 个结果");
  });

  it("工具失败也回填给模型，不中断这一轮", async () => {
    const provider = new ScriptedProvider([
      toolCall("call_pdf", "read_file", { path: "docs/方案.pdf" }),
      answer("这个 PDF 目前只能看元数据。"),
    ]);
    const { session, events } = await collect(provider, "方案 PDF 里写了什么");

    const toolResult = events.find((event) => event.event === "tool_result");
    assert.equal((toolResult?.data as { ok: boolean }).ok, false);
    const error = (toolResult?.data as { error?: { code?: string } }).error;
    assert.equal(error?.code, "unsupported_type");

    const toolMessage = ctx.db
      .prepare("SELECT content_json FROM messages WHERE session_id = ? AND role = 'tool'")
      .get(session.id) as { content_json: string };
    assert.ok(toolMessage.content_json.includes("unsupported_type"));

    const calls = listToolCalls(ctx.db, session.id);
    assert.equal(calls[0]?.ok, false);
    assert.equal(calls[0]?.errorCode, "unsupported_type");
    assert.equal(listAudit(ctx.db, 50).find((entry) => entry.tool === "read_file")?.decision, "deny");

    const done = events.find((event) => event.event === "done");
    assert.equal((done?.data as { status: string }).status, "done");
  });

  it("同一个工具和参数连续两次就停，不再往后执行", async () => {
    const provider = new ScriptedProvider([
      toolCall("call_a", "search_files", { query: "营收" }),
      toolCall("call_b", "search_files", { query: "营收" }),
      answer("不应该走到这里"),
    ]);
    const before = (ctx.db.prepare("SELECT count(*) AS c FROM tool_calls").get() as { c: number }).c;
    await assert.rejects(
      () => collect(provider, "再搜一遍"),
      (error: unknown) => error instanceof RuntimeError && error.code === "loop_detected",
    );

    const after = (ctx.db.prepare("SELECT count(*) AS c FROM tool_calls").get() as { c: number }).c;
    assert.equal(after - before, 1);
  });

  it("达到 maxTurns 时明确报错，不无限转圈", async () => {
    const provider = new ScriptedProvider([
      toolCall("call_x", "search_files", { query: "营收" }),
      toolCall("call_y", "search_files", { query: "预算" }),
      toolCall("call_z", "search_files", { query: "品牌" }),
    ]);
    await assert.rejects(
      () => collect(provider, "一直找", { ...ctx.config, maxTurns: 2 }),
      (error: unknown) => error instanceof RuntimeError && error.code === "max_turns",
    );
  });

  it("模型空回答不会伪造一条消息", async () => {
    const provider = new ScriptedProvider([
      [{ type: "finish", reason: "stop" }],
    ]);
    await assert.rejects(
      () => collect(provider, "你好"),
      (error: unknown) => error instanceof RuntimeError && error.code === "empty_response",
    );
  });
});
