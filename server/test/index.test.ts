import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { IndexService } from "../src/index/service.ts";
import { scanWorkspace } from "../src/index/scan.ts";
import { searchFiles } from "../src/index/search.ts";
import { listAudit } from "../src/store/audit.ts";
import { countFiles } from "../src/store/files.ts";
import { getLastRun } from "../src/store/runs.ts";
import { createTestContext, type TestContext } from "./helpers.ts";

let ctx: TestContext;
let service: IndexService;

before(() => {
  ctx = createTestContext();
  service = new IndexService(ctx.db, ctx.config);
});

after(() => {
  ctx.cleanup();
});

describe("扫描器", () => {
  it("跳过符号链接、忽略目录，并统计被排除的敏感文件", async () => {
    const result = await scanWorkspace(ctx.workspace);
    assert.equal(result.filesIndexed, 8);
    assert.equal(result.filesExcluded, 3);
    assert.ok(result.filesSeen >= 12);

    const paths = result.files.map((file) => file.relPath);
    assert.equal(paths.some((item) => item.endsWith(".env")), false);
    assert.equal(paths.some((item) => item.includes("id_rsa")), false);
    assert.equal(paths.some((item) => item.includes("credential")), false);
    assert.equal(paths.some((item) => item.includes("outside.md")), false);
    assert.equal(paths.some((item) => item.startsWith("node_modules/")), false);
    assert.equal(paths.some((item) => item.startsWith(".git/")), false);
    assert.equal(paths.some((item) => item.endsWith(".DS_Store")), false);
  });
});

describe("索引服务", () => {
  it("首次索引写入文件、FTS 和审计", async () => {
    const run = await service.indexNow();
    assert.equal(run.status, "done");
    assert.equal(run.filesIndexed, 8);
    assert.equal(run.filesExcluded, 3);
    assert.ok(run.finishedAt);

    assert.equal(countFiles(ctx.db), 8);
    assert.equal(getLastRun(ctx.db)?.status, "done");
    assert.ok(listAudit(ctx.db).some((entry) => entry.tool === "index_workspace"));

    const result = searchFiles(ctx.db, "营收");
    assert.equal(result.files[0]?.path, "docs/2026-Q3-营收分析.md");
  });

  it("重复索引是整体替换，不会产生重复记录", async () => {
    const run = await service.indexNow();
    assert.equal(run.status, "done");
    assert.equal(countFiles(ctx.db), 8);
    assert.equal(searchFiles(ctx.db, "营收").files.length, 1);
  });

  it("索引进行中再次 start 复用同一个任务", async () => {
    const first = service.start();
    const second = service.start();
    assert.equal(first.alreadyRunning, false);
    assert.equal(second.alreadyRunning, true);
    assert.equal(second.runId, first.runId);

    const finished = await service.indexNow();
    assert.equal(finished.status, "done");
    assert.equal(service.isRunning(), false);
  });

  it("切换工作区时清空旧索引，避免串数据", async () => {
    const other = new IndexService(ctx.db, {
      ...ctx.config,
      workspaceRoot: path.join(ctx.root, "other-workspace"),
    });
    assert.equal(other.resetIfWorkspaceChanged(), true);
    assert.equal(countFiles(ctx.db), 0);
    assert.equal(other.hasIndex(), false);

    const same = new IndexService(ctx.db, ctx.config);
    assert.equal(same.resetIfWorkspaceChanged(), false);
  });
});
