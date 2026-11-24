import assert from "node:assert/strict";
import fs from "node:fs";
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
import { getPending } from "../src/store/pending.ts";
import { createSession } from "../src/store/sessions.ts";
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

interface Collected {
  events: Array<{ event: string; data: Record<string, unknown> }>;
}

async function run(
  provider: ModelProvider,
  userText: string,
  options: {
    config?: Config;
    decide?: (actionId: string) => "allow" | "deny" | "abort";
  } = {},
): Promise<Collected> {
  const config = options.config ?? ctx.config;
  const confirm = new ConfirmBroker(ctx.db, config.confirmTimeoutMs);
  const controller = new AbortController();
  const session = createSession(ctx.db, {
    workspaceRoot: config.workspaceRoot,
    title: "确认测试",
  });
  const events: Collected["events"] = [];

  await runTurn(
    { db: ctx.db, config, provider, tools: new ToolRegistry(undefined, { allowWrites: config.allowWrites }), skills, confirm },
    {
      session,
      userText,
      signal: controller.signal,
      emit: (event, data) => {
        const payload = data as Record<string, unknown>;
        events.push({ event, data: payload });
        if (event !== "confirm_required" || !options.decide) return;
        const decision = options.decide(String(payload.actionId));
        if (decision === "abort") {
          controller.abort();
          return;
        }
        const result = confirm.resolve(String(payload.actionId), decision);
        assert.equal(result, "ok");
      },
    },
  );
  return { events };
}

function writeFile(relPath: string, content = "测试\n"): void {
  const abs = path.join(ctx.workspace, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

describe("确认流", () => {
  it("用户确认后执行删除，文件进废纸篓并留下两层审计", async () => {
    writeFile("docs/conf-delete.md");
    await new IndexService(ctx.db, ctx.config).indexNow();

    const provider = new ScriptedProvider([
      toolCall("call_del", "delete_file", { path: "docs/conf-delete.md" }),
      answer("已经移入废纸篓。"),
    ]);
    const { events } = await run(provider, "删掉 docs/conf-delete.md", {
      decide: () => "allow",
    });

    const confirmEvent = events.find((event) => event.event === "confirm_required");
    assert.ok(confirmEvent);
    assert.equal(confirmEvent.data.tool, "delete_file");
    assert.equal(confirmEvent.data.title, "把「conf-delete.md」移入废纸篓？");
    assert.equal(confirmEvent.data.diff, undefined);

    const result = events.find((event) => event.event === "tool_result");
    assert.equal((result?.data as { ok: boolean }).ok, true);
    assert.equal(fs.existsSync(path.join(ctx.workspace, "docs/conf-delete.md")), false);
    assert.equal(fs.existsSync(path.join(ctx.config.trashDir, "conf-delete.md")), true);

    const actionId = String(confirmEvent.data.actionId);
    assert.equal(getPending(ctx.db, actionId)?.status, "allowed");

    const decisions = listAudit(ctx.db, 50).filter((entry) => entry.tool === "delete_file");
    assert.deepEqual(
      decisions.map((entry) => entry.decision).sort(),
      ["allow", "confirm"],
    );
    const secondRequest = provider.requests[1];
    const toolMessage = secondRequest.messages.find((message) => message.role === "tool");
    assert.match(toolMessage?.content ?? "", /移入废纸篓/);
  });

  it("用户取消时不执行，模型收到 rejected 并如实说明", async () => {
    writeFile("docs/conf-keep.md");
    const provider = new ScriptedProvider([
      toolCall("call_keep", "delete_file", { path: "docs/conf-keep.md" }),
      answer("你取消了，我没有动这个文件。"),
    ]);
    const { events } = await run(provider, "删掉 docs/conf-keep.md", {
      decide: () => "deny",
    });

    const confirmEvent = events.find((event) => event.event === "confirm_required");
    const result = events.find((event) => event.event === "tool_result");
    assert.equal((result?.data as { ok: boolean }).ok, false);
    assert.equal((result?.data as { error?: { code?: string } }).error?.code, "rejected");
    assert.equal(fs.existsSync(path.join(ctx.workspace, "docs/conf-keep.md")), true);
    assert.equal(getPending(ctx.db, String(confirmEvent?.data.actionId))?.status, "denied");
  });

  it("等不到确认就超时，不做任何改动", async () => {
    writeFile("docs/conf-timeout.md");
    const provider = new ScriptedProvider([
      toolCall("call_slow", "delete_file", { path: "docs/conf-timeout.md" }),
      answer("确认超时。"),
    ]);
    const { events } = await run(provider, "删掉 docs/conf-timeout.md", {
      config: { ...ctx.config, confirmTimeoutMs: 30 },
    });

    const result = events.find((event) => event.event === "tool_result");
    assert.equal((result?.data as { error?: { code?: string } }).error?.code, "confirm_timeout");
    assert.equal(fs.existsSync(path.join(ctx.workspace, "docs/conf-timeout.md")), true);
    const confirmEvent = events.find((event) => event.event === "confirm_required");
    assert.equal(getPending(ctx.db, String(confirmEvent?.data.actionId))?.status, "expired");
  });

  it("客户端断开时按 aborted 收尾，不执行", async () => {
    writeFile("docs/conf-abort.md");
    const provider = new ScriptedProvider([
      toolCall("call_abort", "delete_file", { path: "docs/conf-abort.md" }),
      answer("不会走到这里"),
    ]);
    await assert.rejects(
      () =>
        run(provider, "删掉 docs/conf-abort.md", {
          decide: () => "abort",
        }),
      (error: unknown) => error instanceof RuntimeError && error.code === "aborted",
    );
    assert.equal(fs.existsSync(path.join(ctx.workspace, "docs/conf-abort.md")), true);
  });

  it("单轮破坏性操作有上限", async () => {
    writeFile("docs/limit-a.md");
    writeFile("docs/limit-b.md");
    const provider = new ScriptedProvider([
      toolCall("call_a", "delete_file", { path: "docs/limit-a.md" }),
      toolCall("call_b", "delete_file", { path: "docs/limit-b.md" }),
      answer("第一个处理了，第二个到上限了。"),
    ]);
    const { events } = await run(provider, "删掉这两个文件", {
      config: { ...ctx.config, maxDestructive: 1 },
      decide: () => "allow",
    });

    const results = events.filter((event) => event.event === "tool_result");
    assert.equal(results.length, 2);
    assert.equal((results[0].data as { ok: boolean }).ok, true);
    assert.equal(
      (results[1].data as { error?: { code?: string } }).error?.code,
      "destructive_limit",
    );
    assert.equal(fs.existsSync(path.join(ctx.workspace, "docs/limit-a.md")), false);
    assert.equal(fs.existsSync(path.join(ctx.workspace, "docs/limit-b.md")), true);
  });

  it("写入也要确认，预览里带 diff", async () => {
    writeFile("docs/conf-write.md", "旧内容\n");
    const provider = new ScriptedProvider([
      toolCall("call_write", "write_file", {
        path: "docs/conf-write.md",
        content: "新内容\n",
      }),
      answer("写好了。"),
    ]);
    const { events } = await run(provider, "把 docs/conf-write.md 改成新内容", {
      decide: () => "allow",
    });

    const confirmEvent = events.find((event) => event.event === "confirm_required");
    const diff = confirmEvent?.data.diff as { added: number; removed: number } | undefined;
    assert.equal(confirmEvent?.data.tool, "write_file");
    assert.equal(diff?.added, 1);
    assert.equal(diff?.removed, 1);
    assert.equal(
      fs.readFileSync(path.join(ctx.workspace, "docs/conf-write.md"), "utf8"),
      "新内容\n",
    );
  });

  it("MP_ALLOW_WRITES=0 时写工具不可见", async () => {
    writeFile("docs/conf-disabled.md");
    const provider = new ScriptedProvider([
      toolCall("call_disabled", "delete_file", { path: "docs/conf-disabled.md" }),
      answer("写操作被关闭了。"),
    ]);
    const { events } = await run(provider, "删掉 docs/conf-disabled.md", {
      config: { ...ctx.config, allowWrites: false },
    });
    assert.equal(events.some((event) => event.event === "confirm_required"), false);
    const result = events.find((event) => event.event === "tool_result");
    assert.equal((result?.data as { error?: { code?: string } }).error?.code, "unknown_tool");
    assert.equal(fs.existsSync(path.join(ctx.workspace, "docs/conf-disabled.md")), true);
  });
});
