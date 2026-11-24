import { ConfigError, loadConfig, type Config } from "./config.ts";
import { createApiServer } from "./http/server.ts";
import { IndexService } from "./index/service.ts";
import { warmEmbedder } from "./rag/embed.ts";
import { closeDatabase, openDatabase } from "./store/db.ts";
import { markInterruptedRuns } from "./store/runs.ts";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

function assertLoopback(config: Config): void {
  if (!LOOPBACK.has(config.host)) {
    throw new ConfigError(
      "invalid_host",
      `MP_HOST 只能是回环地址（127.0.0.1 / localhost / ::1），当前为 ${config.host}。`,
    );
  }
}

function main(): void {
  const config = loadConfig();
  assertLoopback(config);

  const db = openDatabase(config.dbPath);
  markInterruptedRuns(db);

  const indexService = new IndexService(db, config);
  if (indexService.resetIfWorkspaceChanged()) {
    console.log("[mp] 检测到工作区已切换，旧索引已清空，将按新工作区重建。");
  }
  const server = createApiServer({ config, db, indexService });
  // 后台预热本地向量模型；失败只降级为关键词检索，不影响启动。
  warmEmbedder();

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`[mp] 端口 ${config.port} 已被占用。换个端口：MP_PORT=4311 npm start`);
    } else {
      console.error(`[mp] 服务启动失败：${error.message}`);
    }
    closeDatabase(db);
    process.exitCode = 1;
  });

  server.listen(config.port, config.host, () => {
    const base = `http://${config.host === "::1" ? "[::1]" : config.host}:${config.port}`;
    console.log(`[mp] MemoryPalace API  ${base}`);
    console.log(`[mp] 工作区  ${config.workspaceRoot}`);
    console.log(`[mp] 数据库  ${config.dbPath}`);
    console.log(`[mp] 模型    ${config.model} (${config.provider})`);
    if (config.provider === "deepseek" && !config.apiKey) {
      console.log("[mp] 提示：还没有 DEEPSEEK_API_KEY；M1 的索引与搜索不受影响，聊天要到 M2 才需要。");
    }

    if (config.indexOnStart && !indexService.hasIndex()) {
      const started = indexService.start();
      console.log(`[mp] 索引为空，已启动首次索引：${started.runId}`);
    }
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[mp] 收到 ${signal}，正在关闭…`);
    server.close(() => {
      closeDatabase(db);
      process.exit(0);
    });
    setTimeout(() => {
      closeDatabase(db);
      process.exit(0);
    }, 3000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

try {
  main();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`[mp] 配置错误（${error.code}）：${error.message}`);
  } else {
    console.error("[mp] 启动失败：", error);
  }
  process.exitCode = 1;
}
