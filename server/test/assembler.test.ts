import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { IndexService } from "../src/index/service.ts";
import { assembleContext } from "../src/runtime/assembler.ts";
import { SkillLibrary } from "../src/skills/loader.ts";
import { appendMessage, listSessionMessages } from "../src/store/messages.ts";
import { createSession } from "../src/store/sessions.ts";
import { formatDate } from "../src/util/format.ts";
import { createTestContext, type TestContext } from "./helpers.ts";

const NOW = new Date(2026, 10, 22, 10, 0, 0).getTime();
let ctx: TestContext;
let skills: SkillLibrary;

before(async () => {
  ctx = createTestContext();
  skills = new SkillLibrary(path.join(ctx.config.serverRoot, "skills"));
  await new IndexService(ctx.db, ctx.config).indexNow();
});

after(() => {
  ctx.cleanup();
});

describe("上下文装配", () => {
  it("system 包含身份、工作区边界与技能，不含日期", () => {
    const session = createSession(ctx.db, { workspaceRoot: ctx.config.workspaceRoot });
    appendMessage(ctx.db, {
      sessionId: session.id,
      turn: 1,
      role: "user",
      content: { text: "营收文件在哪" },
    });

    const assembled = assembleContext({
      db: ctx.db,
      config: ctx.config,
      skills,
      history: listSessionMessages(ctx.db, session.id),
      userText: "营收文件在哪",
      memories: [],
      now: NOW,
    });

    assert.equal(assembled.messages[0].role, "system");
    assert.ok(assembled.system.includes("MemoryPalace"));
    assert.ok(assembled.system.includes("测试工作区"));
    assert.ok(assembled.system.includes("file-recall"));
    assert.ok(assembled.system.includes("XLSX、图片"));
    assert.ok(assembled.system.includes("PDF/DOCX 只能读到检索片段"));
    assert.ok(assembled.system.includes("会立刻更新索引，不需要重建"));
    assert.ok(assembled.system.includes("对话范围"));
    assert.ok(assembled.system.includes("这和工作区文件无关"));
    assert.ok(assembled.system.includes("直接聊"));
    assert.ok(assembled.system.includes("不要用 list_folder 扫全库猜意图"));
    assert.ok(assembled.system.includes("probe=true"));
    assert.ok(assembled.system.includes("探测结果默认不展示"));
    assert.equal(assembled.system.includes(formatDate(NOW)), false);
    assert.equal(JSON.stringify(assembled.messages).includes("<retrieved_context>"), false);

    const last = assembled.messages[assembled.messages.length - 1];
    assert.equal(last.role, "user");
    assert.ok(last.content.includes(`<control type="date" value="${formatDate(NOW)}" />`));
    assert.ok(last.content.includes("营收文件在哪"));
  });

  it("同一会话两轮 system 逐字节相同，日期只出现在当前用户轮", () => {
    const session = createSession(ctx.db, { workspaceRoot: ctx.config.workspaceRoot });
    appendMessage(ctx.db, {
      sessionId: session.id,
      turn: 1,
      role: "user",
      content: { text: "第一问" },
    });
    const first = assembleContext({
      db: ctx.db,
      config: ctx.config,
      skills,
      history: listSessionMessages(ctx.db, session.id),
      userText: "第一问",
      memories: [],
      now: NOW,
    });

    appendMessage(ctx.db, {
      sessionId: session.id,
      turn: 1,
      role: "assistant",
      content: { text: "第一答" },
    });
    appendMessage(ctx.db, {
      sessionId: session.id,
      turn: 2,
      role: "user",
      content: { text: "第二问" },
    });
    const second = assembleContext({
      db: ctx.db,
      config: ctx.config,
      skills,
      history: listSessionMessages(ctx.db, session.id),
      userText: "第二问",
      memories: [],
      now: NOW + 86_400_000,
    });

    assert.equal(second.system, first.system);
    assert.equal(second.prefixHash, first.prefixHash);

    const dated = second.messages.filter(
      (message) => message.role !== "system" && message.content.includes("<control type=\"date\""),
    );
    assert.equal(dated.length, 1);
    const last = second.messages[second.messages.length - 1];
    assert.ok(last.role === "user" && last.content.includes("第二问"));
  });

  it("长期记忆进入 L3", () => {
    const session = createSession(ctx.db, { workspaceRoot: ctx.config.workspaceRoot });
    appendMessage(ctx.db, {
      sessionId: session.id,
      turn: 1,
      role: "user",
      content: { text: "合同在哪" },
    });
    const assembled = assembleContext({
      db: ctx.db,
      config: ctx.config,
      skills,
      history: listSessionMessages(ctx.db, session.id),
      userText: "合同在哪",
      memories: [{ kind: "preference", fact: "用户习惯把合同放在 05-合同。" }],
      now: NOW,
    });
    assert.ok(assembled.system.includes("长期记忆"));
    assert.ok(assembled.system.includes("[preference] 用户习惯把合同放在 05-合同。"));
  });
});
