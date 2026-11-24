import type { Config } from "../config.ts";
import { recordAudit } from "../store/audit.ts";
import type { Db } from "../store/db.ts";
import { countFiles, replaceFiles } from "../store/files.ts";
import {
  createRun,
  failRun,
  finishRun,
  getLastRun,
  getRun,
  updateRunProgress,
  type IndexRun,
} from "../store/runs.ts";
import { extractWorkspaceChunks } from "../rag/indexer.ts";
import { embedPendingChunks } from "../rag/vector-index.ts";
import { scanWorkspace, type ScanProgress } from "./scan.ts";

export interface StartIndexResult {
  runId: string;
  alreadyRunning: boolean;
}

export class IndexService {
  private readonly db: Db;
  private readonly config: Config;
  private current: { id: string; promise: Promise<void> } | null = null;

  constructor(db: Db, config: Config) {
    this.db = db;
    this.config = config;
  }

  isRunning(): boolean {
    return this.current !== null;
  }

  currentRunId(): string | null {
    return this.current?.id ?? null;
  }

  start(): StartIndexResult {
    if (this.current) {
      return { runId: this.current.id, alreadyRunning: true };
    }

    const run = createRun(this.db, this.config.workspaceRoot);
    const promise = this.execute(run.id)
      .catch(() => {
        // execute 内部已经记录失败；这里只负责不让 promise 变成 unhandled rejection。
      })
      .finally(() => {
        if (this.current?.id === run.id) this.current = null;
      });

    this.current = { id: run.id, promise };
    return { runId: run.id, alreadyRunning: false };
  }

  async indexNow(): Promise<IndexRun> {
    const active = this.current;
    if (active) {
      await active.promise;
      const existing = getRun(this.db, active.id);
      if (existing) return existing;
    }

    const started = this.start();
    await this.current?.promise;
    const run = getRun(this.db, started.runId);
    if (!run) throw new Error(`索引任务不存在：${started.runId}`);
    return run;
  }

  getRun(id: string): IndexRun | null {
    return getRun(this.db, id);
  }

  /**
   * 同一个 SQLite 文件被指向另一个工作区时，旧索引必须清掉，
   * 否则用户会在新工作区里看到上一个工作区的文件。
   */
  resetIfWorkspaceChanged(): boolean {
    const last = getLastRun(this.db);
    if (!last || last.root === this.config.workspaceRoot) return false;
    replaceFiles(this.db, []);
    return true;
  }

  hasIndex(): boolean {
    return countFiles(this.db) > 0;
  }

  private async execute(runId: string): Promise<void> {
    try {
      const result = await scanWorkspace(this.config.workspaceRoot, {
        onProgress: (progress: ScanProgress) => {
          updateRunProgress(this.db, runId, {
            filesSeen: progress.filesSeen,
            filesIndexed: progress.filesIndexed,
            filesExcluded: progress.filesExcluded,
          });
        },
      });

      const content = await extractWorkspaceChunks(
        this.config.workspaceRoot,
        result.files,
      );
      replaceFiles(this.db, result.files, content.chunks);
      const embedding = await embedPendingChunks(this.db);
      finishRun(this.db, runId, {
        filesSeen: result.filesSeen,
        filesIndexed: result.filesIndexed,
        filesExcluded: result.filesExcluded,
        errors: [
          ...result.errors,
          ...content.errors,
          ...(!embedding.skipped && embedding.reason ? [embedding.reason] : []),
        ].slice(0, 50),
      });

      recordAudit(this.db, {
        tool: "index_workspace",
        decision: "allow",
        result: `indexed ${result.filesIndexed} files, excluded ${result.filesExcluded}, content ${content.contentFiles} files / ${content.chunks.length} chunks, truncated ${content.truncatedFiles} files, vectors ${embedding.embedded}${embedding.skipped ? " (skipped)" : ""}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failRun(this.db, runId, message);
      recordAudit(this.db, {
        tool: "index_workspace",
        decision: "deny",
        result: message,
      });
    }
  }
}
