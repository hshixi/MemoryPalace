import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { after, before, describe, it } from "node:test";
import { createApiServer } from "../src/http/server.ts";
import { IndexService } from "../src/index/service.ts";
import { createTestContext, type TestContext } from "./helpers.ts";

interface HealthBody {
  ok: boolean;
  apiKeyConfigured: boolean;
  index: { files: number; status: string };
}

let ctx: TestContext;
let service: IndexService;
let server: http.Server;
let base: string;

before(async () => {
  ctx = createTestContext();
  service = new IndexService(ctx.db, ctx.config);
  await service.indexNow();

  server = createApiServer({ config: ctx.config, db: ctx.db, indexService: service });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  ctx.cleanup();
});

describe("HTTP API", () => {
  it("健康检查返回索引状态", async () => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as HealthBody;
    assert.equal(body.ok, true);
    assert.equal(body.apiKeyConfigured, false);
    assert.equal(body.index.files, 8);
    assert.equal(body.index.status, "ready");
  });

  it("总览与主题接口返回真实结构", async () => {
    const overview = await fetch(`${base}/api/overview`);
    assert.equal(overview.status, 200);
    const body = (await overview.json()) as {
      workspace: { fileCount: number };
      topics: Array<{ name: string }>;
    };
    assert.equal(body.workspace.fileCount, 8);
    assert.ok(body.topics.some((topic) => topic.name === "docs"));

    const topics = await fetch(`${base}/api/topics`);
    assert.equal(topics.status, 200);
  });

  it("目录浏览返回子文件夹、直接文件与面包屑", async () => {
    const root = await fetch(`${base}/api/browse`);
    assert.equal(root.status, 200);
    const rootBody = (await root.json()) as {
      path: string;
      folders: Array<{ name: string; count: number; path: string }>;
      files: Array<{ path: string }>;
      totalFiles: number;
      breadcrumbs: Array<{ name: string }>;
    };
    assert.equal(rootBody.path, "");
    assert.deepEqual(rootBody.breadcrumbs, []);
    assert.deepEqual(
      rootBody.folders.map((folder) => folder.name).sort(),
      ["design", "docs", "images", "sheets"],
    );
    assert.equal(
      rootBody.folders.find((folder) => folder.name === "docs")?.count,
      4,
    );
    assert.deepEqual(
      rootBody.files.map((file) => file.path),
      ["root-note.txt"],
    );
    assert.equal(rootBody.totalFiles, 1);

    const docs = await fetch(
      `${base}/api/browse?path=${encodeURIComponent("docs")}&limit=2`,
    );
    assert.equal(docs.status, 200);
    const docsBody = (await docs.json()) as {
      folders: unknown[];
      files: unknown[];
      totalFiles: number;
      breadcrumbs: Array<{ name: string; path: string }>;
    };
    assert.deepEqual(docsBody.folders, []);
    assert.equal(docsBody.files.length, 2);
    assert.equal(docsBody.totalFiles, 4);
    assert.deepEqual(docsBody.breadcrumbs, [{ name: "docs", path: "docs" }]);
  });

  it("目录浏览拒绝越界与敏感目录", async () => {
    const escape = await fetch(
      `${base}/api/browse?path=${encodeURIComponent("../etc")}`,
    );
    assert.equal(escape.status, 403);
    const sensitive = await fetch(
      `${base}/api/browse?path=${encodeURIComponent("node_modules")}`,
    );
    assert.equal(sensitive.status, 403);
  });

  it("搜索与文件详情走同一条索引", async () => {
    const search = await fetch(`${base}/api/search?q=${encodeURIComponent("营收")}`);
    const body = (await search.json()) as { files: Array<{ path: string; match: string[] }> };
    assert.equal(body.files[0]?.path, "docs/2026-Q3-营收分析.md");
    assert.ok(body.files[0]?.match.includes("filename"));

    const file = await fetch(
      `${base}/api/file?path=${encodeURIComponent("docs/2026-Q3-营收分析.md")}`,
    );
    assert.equal(file.status, 200);
  });

  it("拒绝路径逃逸与敏感文件", async () => {
    const escape = await fetch(`${base}/api/file?path=${encodeURIComponent("../etc/passwd")}`);
    assert.equal(escape.status, 403);
    const escapeBody = (await escape.json()) as { error: { code: string } };
    assert.equal(escapeBody.error.code, "path_escape");

    const sensitive = await fetch(`${base}/api/file?path=${encodeURIComponent("docs/.env")}`);
    assert.equal(sensitive.status, 403);
    const sensitiveBody = (await sensitive.json()) as { error: { code: string } };
    assert.equal(sensitiveBody.error.code, "permission_denied");
  });

  it("Origin 白名单生效", async () => {
    const allowed = await fetch(`${base}/api/health`, {
      headers: { Origin: "http://localhost:5173" },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:5173");

    const denied = await fetch(`${base}/api/health`, {
      headers: { Origin: "http://evil.example" },
    });
    assert.equal(denied.status, 403);
  });

  it("重建索引返回 run，并能查询进度", async () => {
    const response = await fetch(`${base}/api/index/rebuild`, { method: "POST" });
    assert.ok([202, 409].includes(response.status));
    const body = (await response.json()) as { runId: string };
    assert.ok(body.runId.startsWith("run_"));

    await service.indexNow();

    const run = await fetch(`${base}/api/index/runs/${body.runId}`);
    assert.equal(run.status, 200);
    const runBody = (await run.json()) as { status: string; filesIndexed: number };
    assert.equal(runBody.status, "done");
    assert.equal(runBody.filesIndexed, 8);
  });

  it("chat 拒绝空消息", async () => {
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "   " }),
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "invalid_message");
  });

  it("技能清单来自 skills/ 目录", async () => {
    const response = await fetch(`${base}/api/skills`);
    const body = (await response.json()) as { skills: Array<{ name: string }> };
    assert.ok(body.skills.some((skill) => skill.name === "file-recall"));
  });

  it("reveal 关闭时不会真的打开 Finder", async () => {
    const response = await fetch(`${base}/api/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "docs/public.md" }),
    });
    assert.equal(response.status, 403);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "reveal_disabled");
  });

  it("审计日志记录了索引操作", async () => {
    const response = await fetch(`${base}/api/audit`);
    const body = (await response.json()) as { events: Array<{ tool: string }> };
    assert.ok(body.events.some((event) => event.tool === "index_workspace"));
  });
});
