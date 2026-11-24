import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { scanWorkspace } from "../src/index/scan.ts";
import { parseSearchQuery, searchFiles } from "../src/index/search.ts";
import { replaceFiles } from "../src/store/files.ts";
import { createTestContext, type TestContext } from "./helpers.ts";

const DAY = 86_400_000;
let ctx: TestContext;

before(async () => {
  ctx = createTestContext();
  const result = await scanWorkspace(ctx.workspace);
  replaceFiles(ctx.db, result.files);
});

after(() => {
  ctx.cleanup();
});

describe("查询解析", () => {
  it("去掉口语停用词，留下真正关键词", () => {
    const parsed = parseSearchQuery("帮我找一下上周那份讲营收的 PDF");
    assert.deepEqual(parsed.keywords, ["营收"]);
    assert.equal(parsed.typeHint, "pdf");
    assert.equal(parsed.timeRange?.label, "上周");
  });

  it("英文与中文混合也能切分", () => {
    const parsed = parseSearchQuery("RAG 检索策略");
    assert.deepEqual(parsed.keywords, ["rag", "检索策略"]);
    assert.equal(parsed.typeHint, null);
  });
});

describe("元数据搜索", () => {
  it("两字中文关键词走 LIKE 也能命中", () => {
    const result = searchFiles(ctx.db, "营收");
    assert.ok(result.files.length > 0);
    assert.equal(result.files[0].name, "2026-Q3-营收分析.md");
    assert.ok(result.files[0].match.includes("filename"));
  });

  it("多关键词能命中英文与中文组合", () => {
    const result = searchFiles(ctx.db, "RAG 策略");
    assert.equal(result.files[0]?.path, "docs/RAG-检索策略.md");
  });

  it("自然语言里的 PDF 与上周是软信号", () => {
    const result = searchFiles(ctx.db, "上周的 PDF");
    assert.equal(result.interpreted.type, "pdf");
    assert.equal(result.interpreted.timeLabel, "上周");
    assert.equal(result.files[0]?.name, "方案.pdf");
    assert.ok(result.files[0].match.includes("time"));
    assert.ok(result.files[0].match.includes("type"));
  });

  it("显式类型过滤是硬过滤", () => {
    const result = searchFiles(ctx.db, "", { type: "image", k: 20 });
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].path, "images/架构草图.png");
  });

  it("显式时间范围是硬过滤", () => {
    const result = searchFiles(ctx.db, "", { modifiedAfter: Date.now() - 2 * DAY, k: 20 });
    assert.ok(result.files.length > 0);
    assert.equal(
      result.files.some((file) => file.name === "方案.pdf"),
      false,
    );
    for (const file of result.files) {
      assert.ok(file.modifiedAt >= Date.now() - 2 * DAY);
    }
  });

  it("目录名也能作为匹配来源", () => {
    const result = searchFiles(ctx.db, "design");
    assert.equal(result.files[0]?.path, "design/brand-guide.md");
    assert.ok(result.files[0].match.includes("path"));
  });

  it("敏感文件不会出现在结果里", () => {
    const result = searchFiles(ctx.db, "", { k: 20 });
    const paths = result.files.map((file) => file.path);
    assert.equal(paths.some((item) => item.endsWith(".env")), false);
    assert.equal(paths.some((item) => item.includes("id_rsa")), false);
    assert.equal(paths.some((item) => item.includes("credential")), false);
  });
});
