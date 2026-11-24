import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { buildOverview } from "../src/index/overview.ts";
import { IndexService } from "../src/index/service.ts";
import { openDatabase } from "../src/store/db.ts";
import { createTestContext, type TestContext } from "./helpers.ts";

let ctx: TestContext;
let service: IndexService;

before(async () => {
  ctx = createTestContext();
  service = new IndexService(ctx.db, ctx.config);
  await service.indexNow();
});

after(() => {
  ctx.cleanup();
});

describe("Dashboard 总览", () => {
  it("返回真实的工作区统计", () => {
    const overview = buildOverview(ctx.db, ctx.config, service);
    assert.equal(overview.workspace.displayName, "测试工作区");
    assert.equal(overview.workspace.fileCount, 8);
    assert.equal(overview.workspace.topicCount, 5);
    assert.equal(overview.workspace.status, "ready");
    assert.equal(overview.workspace.lastIndexedAt !== null, true);
    assert.notEqual(overview.workspace.lastIndexedLabel, "尚未索引");
    assert.equal(overview.lastRun?.status, "done");
    assert.equal(overview.lastRun?.filesIndexed, 8);
    assert.equal(overview.lastRun?.errorCount, 0);
  });

  it("主题按一级目录聚合，根文件进未归类", () => {
    const overview = buildOverview(ctx.db, ctx.config, service);
    const docs = overview.topics.find((topic) => topic.name === "docs");
    assert.ok(docs);
    assert.equal(docs.count, 4);
    assert.equal(docs.files.length, 4);
    assert.ok(docs.kinds.some((kind) => kind.label === "文档"));
    assert.ok(docs.blurb.includes("最近修改"));

    const root = overview.topics.find((topic) => topic.name === "未归类");
    assert.ok(root);
    assert.equal(root.count, 1);
  });

  it("活动轴固定 8 个周桶，类型分布来自真实 kind", () => {
    const overview = buildOverview(ctx.db, ctx.config, service);
    assert.equal(overview.activity.length, 8);
    const document = overview.types.find((type) => type.label === "文档");
    const spreadsheet = overview.types.find((type) => type.label === "表格");
    const image = overview.types.find((type) => type.label === "图片");
    assert.equal(document?.value, 6);
    assert.equal(spreadsheet?.value, 1);
    assert.equal(image?.value, 1);
    assert.ok(Array.isArray(overview.edges));
  });
});

describe("空工作区总览", () => {
  it("没有索引时状态为 empty", () => {
    const db = openDatabase(path.join(ctx.root, "empty.sqlite"));
    try {
      const emptyService = new IndexService(db, ctx.config);
      const overview = buildOverview(db, ctx.config, emptyService);
      assert.equal(overview.workspace.status, "empty");
      assert.equal(overview.workspace.fileCount, 0);
      assert.equal(overview.workspace.topicCount, 0);
      assert.equal(overview.workspace.lastIndexedLabel, "尚未索引");
      assert.equal(overview.lastRun, null);
      assert.equal(overview.activity.length, 8);
      assert.equal(overview.topics.length, 0);
    } finally {
      db.close();
    }
  });
});
