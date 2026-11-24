import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { IndexService } from "../src/index/service.ts";
import { SkillLibrary } from "../src/skills/loader.ts";
import { getFileByRelPath } from "../src/store/files.ts";
import { ToolRegistry, type ToolContext, type ToolPlan } from "../src/runtime/tools.ts";
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

function toolCtx(config = ctx.config): ToolContext {
  return {
    db: ctx.db,
    config,
    skills,
    sessionId: "test-session",
    turn: 1,
    signal: new AbortController().signal,
  };
}

async function prepare(
  name: string,
  args: Record<string, unknown>,
  config = ctx.config,
): Promise<{ plan: ToolPlan; summary: string }> {
  const result = await registry.prepare(name, JSON.stringify(args), toolCtx(config));
  assert.ok(result.ok && result.plan, `prepare 失败：${result.execution?.summary ?? ""}`);
  return { plan: result.plan, summary: result.plan.preview.title };
}

async function prepareError(
  name: string,
  args: Record<string, unknown>,
): Promise<{ code?: string; message?: string }> {
  const result = await registry.prepare(name, JSON.stringify(args), toolCtx());
  assert.equal(result.ok, false);
  assert.ok(result.execution);
  return { code: result.execution.error?.code, message: result.execution.error?.message };
}

describe("写工具", () => {
  it("write_file 新建文本文件，预览有 diff，索引立刻能查到", async () => {
    const { plan } = await prepare("write_file", {
      path: "docs/新笔记.md",
      content: "# 新笔记\n\n第一行。\n",
    });
    assert.equal(plan.preview.title, "新建「新笔记.md」");
    assert.equal(plan.preview.diff?.added, 4);
    assert.equal(plan.preview.diff?.removed, 0);

    const execution = await registry.apply(plan, toolCtx());
    assert.equal(execution.ok, true);
    assert.equal(fs.readFileSync(path.join(ctx.workspace, "docs/新笔记.md"), "utf8"), "# 新笔记\n\n第一行。\n");
    const indexed = getFileByRelPath(ctx.db, "docs/新笔记.md");
    assert.ok(indexed);
    assert.equal(indexed?.parentPath, "docs");
  });

  it("write_file 覆盖已有文件时给出增删行数", async () => {
    const { plan } = await prepare("write_file", {
      path: "docs/public.md",
      content: "# 公开笔记\n\n新增一行。\n",
    });
    assert.equal(plan.preview.diff?.added, 2);
    assert.equal(plan.preview.diff?.removed, 0);

    const execution = await registry.apply(plan, toolCtx());
    assert.equal(execution.ok, true);
    const indexed = getFileByRelPath(ctx.db, "docs/public.md");
    assert.equal(indexed?.sizeBytes, Buffer.byteLength("# 公开笔记\n\n新增一行。\n"));
  });

  it("write_file 拒绝非文本、敏感、越界和过大的内容", async () => {
    assert.equal((await prepareError("write_file", { path: "docs/方案.pdf", content: "x" })).code, "unsupported_type");
    assert.equal((await prepareError("write_file", { path: "docs/.env", content: "secret" })).code, "permission_denied");
    assert.equal((await prepareError("write_file", { path: "../outside.md", content: "x" })).code, "path_escape");
    assert.equal((await prepareError("write_file", { path: "/tmp/x.md", content: "x" })).code, "path_escape");
    const huge = await prepareError("write_file", { path: "docs/huge.md", content: "a".repeat(200_001) });
    assert.equal(huge.code, "too_large");
  });

  it("move_file 移动后旧路径消失、新路径入索引，且不覆盖已有文件", async () => {
    fs.mkdirSync(path.join(ctx.workspace, "docs/归档"), { recursive: true });
    const { plan } = await prepare("move_file", {
      from: "docs/新笔记.md",
      to: "docs/归档/新笔记.md",
    });
    assert.deepEqual(plan.preview.rows, [{ from: "docs/新笔记.md", to: "docs/归档/新笔记.md" }]);

    const execution = await registry.apply(plan, toolCtx());
    assert.equal(execution.ok, true);
    assert.equal(getFileByRelPath(ctx.db, "docs/新笔记.md"), null);
    assert.ok(getFileByRelPath(ctx.db, "docs/归档/新笔记.md"));

    assert.equal(
      (await prepareError("move_file", { from: "docs/public.md", to: "docs/归档/新笔记.md" })).code,
      "target_exists",
    );
  });

  it("delete_file 只进废纸篓，原文件消失、索引移除", async () => {
    fs.writeFileSync(path.join(ctx.workspace, "docs/待删.md"), "临时文件\n", "utf8");
    await new IndexService(ctx.db, ctx.config).indexNow();

    const { plan } = await prepare("delete_file", { path: "docs/待删.md" });
    assert.equal(plan.preview.title, "把「待删.md」移入废纸篓？");

    const execution = await registry.apply(plan, toolCtx());
    assert.equal(execution.ok, true);
    assert.equal(fs.existsSync(path.join(ctx.workspace, "docs/待删.md")), false);
    assert.equal(fs.existsSync(path.join(ctx.config.trashDir, "待删.md")), true);
    assert.equal(getFileByRelPath(ctx.db, "docs/待删.md"), null);
  });

  it("delete_file 拒绝目录和符号链接", async () => {
    assert.equal((await prepareError("delete_file", { path: "docs" })).code, "not_a_file");
    assert.equal((await prepareError("delete_file", { path: "docs/outside.md" })).code, "path_escape");
  });

  it("确认期间文件被改动就报 stale_target，不覆盖别人的修改", async () => {
    fs.writeFileSync(path.join(ctx.workspace, "docs/race.md"), "v1\n", "utf8");
    const { plan } = await prepare("write_file", { path: "docs/race.md", content: "v2\n" });
    fs.writeFileSync(path.join(ctx.workspace, "docs/race.md"), "v1 changed\n", "utf8");

    const execution = await registry.apply(plan, toolCtx());
    assert.equal(execution.ok, false);
    assert.equal(execution.error?.code, "stale_target");
    assert.equal(fs.readFileSync(path.join(ctx.workspace, "docs/race.md"), "utf8"), "v1 changed\n");
  });

  it("写工具不能绕过确认直接 execute", async () => {
    const execution = await registry.execute(
      "delete_file",
      JSON.stringify({ path: "docs/public.md" }),
      toolCtx(),
    );
    assert.equal(execution.ok, false);
    assert.equal(execution.error?.code, "confirm_required");
  });

  it("allowWrites=false 时写工具根本不注册", () => {
    const disabled = new ToolRegistry(undefined, { allowWrites: false });
    assert.deepEqual(disabled.names(), [
      "get_file_info",
      "list_folder",
      "load_skill",
      "read_file",
      "reveal_in_finder",
      "search_content",
      "search_files",
    ]);
  });
});
