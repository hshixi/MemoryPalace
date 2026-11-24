import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { IndexService } from "../src/index/service.ts";
import type {
  ChatRequest,
  ModelProvider,
  ProviderCapabilities,
  StreamEvent,
} from "../src/model/types.ts";
import { ConfirmBroker } from "../src/runtime/confirm.ts";
import { runTurn } from "../src/runtime/runtime.ts";
import { ToolRegistry, type ToolContext, type ToolPlan } from "../src/runtime/tools.ts";
import { SkillLibrary } from "../src/skills/loader.ts";
import { listAudit } from "../src/store/audit.ts";
import {
  findSimilarMemory,
  injectableMemories,
  listMemories,
  listMemoryFacts,
  rememberFact,
  removeMemory,
  MAX_MEMORY_FACTS,
} from "../src/store/memory.ts";
import { createSession, getSession } from "../src/store/sessions.ts";
import { createTestContext, type TestContext } from "./helpers.ts";

let ctx: TestContext;
let skills: SkillLibrary;
let registry: ToolRegistry;

before(async () => {
  ctx = createTestContext();
  await new IndexService(ctx.db, ctx.config).indexNow();
  skills = new SkillLibrary(path.join(ctx.config.serverRoot, "skills"));
  registry = new ToolRegistry();
});

after(() => {
  ctx.cleanup();
});

function toolCtx(sessionId = "test-session"): ToolContext {
  return {
    db: ctx.db,
    config: ctx.config,
    skills,
    sessionId,
    turn: 1,
    signal: new AbortController().signal,
  };
}

async function prepare(
  args: Record<string, unknown>,
): Promise<{ plan: ToolPlan; summary: string }> {
  const result = await registry.prepare("save_memory", JSON.stringify(args), toolCtx());
  assert.ok(result.ok && result.plan, `prepare 失败：${result.execution?.summary ?? ""}`);
  return { plan: result.plan, summary: result.plan.preview.summary };
}

describe("长期记忆存储", () => {
  it("写入、读取、删除是一条完整链路", () => {
    const { memory, merged } = rememberFact(ctx.db, {
      fact: "「月报」指代季度经营分析报告",
      kind: "alias",
      confidence: 0.9,
    });
    assert.equal(merged, false);
    assert.equal(memory.kind, "alias");

    const listed = listMemories(ctx.db);
    assert.ok(listed.some((entry) => entry.id === memory.id));
    assert.ok(listMemoryFacts(ctx.db).includes("[alias] 「月报」指代季度经营分析报告"));

    assert.equal(removeMemory(ctx.db, memory.id), true);
    assert.equal(removeMemory(ctx.db, memory.id), false);
    assert.equal(
      listMemories(ctx.db).some((entry) => entry.id === memory.id),
      false,
    );
  });

  it("相似记忆合并到同一条，不重复新增", () => {
    const first = rememberFact(ctx.db, {
      fact: "客户 A 的合同在 05-合同 里",
      kind: "context",
    });
    const second = rememberFact(ctx.db, {
      fact: "客户A的合同 在05-合同里",
      kind: "context",
    });
    assert.equal(second.merged, true);
    assert.equal(second.memory.id, first.memory.id);
    assert.equal(
      listMemories(ctx.db).filter((entry) => entry.fact.includes("客户A")).length,
      1,
    );
    assert.ok(findSimilarMemory(ctx.db, "客户A的合同在05-合同里"));
  });

  it("context 超过 30 天不再注入，但不会自动删除", () => {
    const old = rememberFact(ctx.db, {
      fact: "上个月在找投资人名单",
      kind: "context",
    });
    const longAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    ctx.db
      .prepare("UPDATE memory SET created_at = ?, updated_at = ? WHERE id = ?")
      .run(longAgo, longAgo, old.memory.id);

    assert.equal(
      injectableMemories(ctx.db).some((entry) => entry.id === old.memory.id),
      false,
    );
    assert.ok(listMemories(ctx.db).some((entry) => entry.id === old.memory.id));
  });

  it("超过 50 条时先淘汰最久没用的 context", () => {
    ctx.db.exec("DELETE FROM memory");
    // 用互不相似的随机后缀，避免触发合并逻辑。
    for (let index = 0; index < MAX_MEMORY_FACTS; index += 1) {
      rememberFact(ctx.db, {
        fact: `偏好记录 ${randomUUID()}`,
        kind: "preference",
      });
    }
    const oldest = rememberFact(ctx.db, { fact: "最旧的上下文", kind: "context" });
    ctx.db
      .prepare("UPDATE memory SET updated_at = ?, last_used_at = ? WHERE id = ?")
      .run(1, 1, oldest.memory.id);

    const newestFact = `最后一条 ${randomUUID()}`;
    rememberFact(ctx.db, { fact: newestFact, kind: "preference" });
    const facts = listMemories(ctx.db).map((entry) => entry.fact);
    assert.equal(facts.length, MAX_MEMORY_FACTS);
    assert.equal(facts.includes("最旧的上下文"), false);
    assert.ok(facts.includes(newestFact));
  });
});

describe("save_memory 工具", () => {
  it("准备阶段给确认卡，确认后才落库", async () => {
    const { plan } = await prepare({
      kind: "preference",
      fact: "偏好按文件名而不是日期描述文件",
    });
    assert.equal(plan.preview.title, "记住这条信息？");
    assert.match(plan.preview.summary, /偏好按文件名/);
    assert.equal(listMemories(ctx.db).some((entry) => entry.fact.includes("偏好按文件名")), false);

    const outcome = await plan.apply();
    assert.match(outcome.summary, /已记住/);
    assert.ok(listMemories(ctx.db).some((entry) => entry.fact.includes("偏好按文件名")));
  });

  it("相似记忆在预览里就说明会合并", async () => {
    const { plan } = await prepare({
      kind: "preference",
      fact: "偏好按文件名而不是日期描述文件！",
    });
    assert.equal(plan.preview.title, "更新已有记忆？");
    assert.match(plan.preview.summary, /合并/);
    const outcome = await plan.apply();
    assert.equal((outcome.data as { merged: boolean }).merged, true);
  });

  it("拒绝空内容、超长和未知类型", async () => {
    for (const args of [
      { kind: "context", fact: "   " },
      { kind: "context", fact: "字".repeat(101) },
      { kind: "unknown", fact: "写不进去" },
    ]) {
      const result = await registry.prepare(
        "save_memory",
        JSON.stringify(args),
        toolCtx(),
      );
      assert.equal(result.ok, false);
      assert.equal(result.execution?.error?.code, "invalid_arguments");
    }
  });

  it("不能绕过确认直接 execute", async () => {
    const execution = await registry.execute(
      "save_memory",
      JSON.stringify({ kind: "alias", fact: "绕过确认" }),
      toolCtx(),
    );
    assert.equal(execution.ok, false);
    assert.equal(execution.error?.code, "confirm_required");
  });
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
    { type: "tool_call_delta", index: 0, id, name, arguments: JSON.stringify(args) },
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

async function run(
  provider: ModelProvider,
  session: ReturnType<typeof createSession>,
  userText: string,
  decide?: "allow" | "deny",
) {
  const confirm = new ConfirmBroker(ctx.db, ctx.config.confirmTimeoutMs);
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  await runTurn(
    {
      db: ctx.db,
      config: ctx.config,
      provider,
      tools: registry,
      skills,
      confirm,
    },
    {
      session,
      userText,
      signal: new AbortController().signal,
      emit: (event, data) => {
        const payload = data as Record<string, unknown>;
        events.push({ event, data: payload });
        if (event === "confirm_required" && decide) {
          confirm.resolve(String(payload.actionId), decide);
        }
      },
    },
  );
  return { events, confirm };
}

describe("会话里的记忆", () => {
  it("确认后写入，审计留两层，下一次会话才进 system", async () => {
    ctx.db.exec("DELETE FROM memory");
    const session = createSession(ctx.db, {
      workspaceRoot: ctx.config.workspaceRoot,
      memorySnapshot: [],
    });

    const provider = new ScriptedProvider([
      toolCall("call_mem", "save_memory", {
        kind: "alias",
        fact: "「周会」指代每周一的会议记录",
      }),
      answer("记住了。"),
    ]);
    const { events } = await run(provider, session, "记住：「周会」指代每周一的会议记录", "allow");

    const confirmEvent = events.find((event) => event.event === "confirm_required");
    assert.equal(confirmEvent?.data.tool, "save_memory");
    assert.match(String(confirmEvent?.data.summary), /周会/);
    assert.ok(events.some((event) => event.event === "tool_result"));

    const stored = listMemories(ctx.db)[0];
    assert.equal(stored?.kind, "alias");
    const decisions = listAudit(ctx.db, 50).filter((entry) => entry.tool === "save_memory");
    assert.deepEqual(
      decisions.map((entry) => entry.decision).sort(),
      ["allow", "confirm"],
    );

    // 同一会话的 system 仍是会话开始时的快照，不因中途写入而改变。
    const again = new ScriptedProvider([answer("好。")]);
    await run(again, getSession(ctx.db, session.id)!, "再说一次");
    const system = again.requests[0].messages[0];
    assert.equal(system.role, "system");
    assert.equal(String(system.content).includes("周会"), false);

    // 新会话才会注入。
    const fresh = new ScriptedProvider([answer("好。")]);
    const newSession = createSession(ctx.db, {
      workspaceRoot: ctx.config.workspaceRoot,
      memorySnapshot: listMemories(ctx.db).map((memory) => ({
        id: memory.id,
        kind: memory.kind,
        fact: memory.fact,
      })),
    });
    await run(fresh, newSession, "你好");
    assert.ok(String(fresh.requests[0].messages[0].content).includes("[alias] 「周会」指代每周一的会议记录"));
  });

  it("拒绝时不写入", async () => {
    ctx.db.exec("DELETE FROM memory");
    const session = createSession(ctx.db, {
      workspaceRoot: ctx.config.workspaceRoot,
      memorySnapshot: [],
    });
    const provider = new ScriptedProvider([
      toolCall("call_mem_deny", "save_memory", {
        kind: "context",
        fact: "这条不该被记住",
      }),
      answer("取消了。"),
    ]);
    const { events } = await run(provider, session, "记住：这条不该被记住", "deny");

    assert.equal(listMemories(ctx.db).length, 0);
    const result = events.find((event) => event.event === "tool_result");
    assert.equal((result?.data as { error?: { code?: string } }).error?.code, "rejected");
  });
});

// 避免未使用告警：真实运行里 fs 由测试环境准备目录时使用。
void fs;
