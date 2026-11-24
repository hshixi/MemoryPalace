import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import { searchFiles } from "../src/index/search.ts";
import { IndexService } from "../src/index/service.ts";
import { searchContent, type SearchMode } from "../src/rag/search.ts";
import { openDatabase } from "../src/store/db.ts";

interface EvalQuery {
  query: string;
  expect: string[];
}

interface EvalFixture {
  queries: EvalQuery[];
}

interface ModeStats {
  hits: number;
  mrr: number;
  ranks: Array<number | null>;
  topPaths: string[];
}

const MODES: SearchMode[] = ["keyword", "vector", "hybrid"];

function argValue(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function rankOf(paths: string[], expect: string[]): number | null {
  const index = paths.findIndex((item) => expect.includes(item));
  return index < 0 ? null : index + 1;
}

async function evaluate(
  db: ReturnType<typeof openDatabase>,
  queries: EvalQuery[],
  mode: SearchMode,
  k: number,
): Promise<ModeStats> {
  const stats: ModeStats = { hits: 0, mrr: 0, ranks: [], topPaths: [] };
  for (const item of queries) {
    const result = await searchContent(db, item.query, { k, mode });
    const paths = result.hits.map((hit) => hit.path);
    const rank = rankOf(paths, item.expect);
    stats.ranks.push(rank);
    stats.topPaths.push(paths[0] ?? "（无命中）");
    if (rank !== null) {
      stats.hits += 1;
      stats.mrr += 1 / rank;
    }
  }
  stats.mrr /= queries.length;
  return stats;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const workspace = path.resolve(argValue("--workspace") ?? config.workspaceRoot);
  const k = Number(argValue("--k") ?? 5);
  const verbose = process.argv.includes("--verbose");
  const fixturePath = path.resolve(
    argValue("--queries") ??
      path.join(import.meta.dirname, "..", "eval", "rag-queries.json"),
  );
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as EvalFixture;

  // 评估用临时库，绝不碰开发库。
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mp-eval-"));
  const db = openDatabase(path.join(tempDir, "eval.sqlite"));
  const evalConfig = { ...config, workspaceRoot: workspace };

  try {
    const run = await new IndexService(db, evalConfig).indexNow();
    const chunked = db.prepare("SELECT count(*) AS c FROM chunks").get() as { c: number };
    const vectors = db.prepare("SELECT count(*) AS c FROM chunk_vectors").get() as {
      c: number;
    };
    console.log(
      `工作区：${workspace}\n索引：${run.filesIndexed} 个文件，正文 ${chunked.c} 块，向量 ${vectors.c} 条，k=${k}\n`,
    );
    if (vectors.c === 0) {
      console.log("提示：没有向量（MP_EMBED=0 或模型不可用），vector 模式会是空的。\n");
    }

    const stats = new Map<SearchMode, ModeStats>();
    for (const mode of MODES) {
      stats.set(mode, await evaluate(db, fixture.queries, mode, k));
    }

    const rows: string[] = [];
    const fileStats = { hits: 0, mrr: 0 };
    for (let index = 0; index < fixture.queries.length; index += 1) {
      const item = fixture.queries[index];
      const files = searchFiles(db, item.query, { k });
      const fileRank = rankOf(
        files.files.map((file) => file.path),
        item.expect,
      );
      if (fileRank !== null) {
        fileStats.hits += 1;
        fileStats.mrr += 1 / fileRank;
      }

      const cells = MODES.map((mode) => {
        const rank = stats.get(mode)?.ranks[index] ?? null;
        return `${rank === null ? "✖" : "✔"}${String(rank ?? "-").padStart(2)}`;
      }).join("  ");
      rows.push(
        `${cells}  ${String(fileRank ?? "-").padStart(2)}  ${item.query} → ${
          stats.get("hybrid")?.topPaths[index] ?? "（无命中）"
        }`,
      );
      if (verbose) {
        rows.push(`    expect: ${item.expect.join(" | ")}`);
        rows.push(
          `    files : ${
            files.files
              .map((file) => file.path)
              .slice(0, 3)
              .join(" | ") || "（无）"
          }`,
        );
      }
    }

    console.log("关键词    向量    混合   文件  查询");
    console.log("------    ----    ----   ----  ------------------------------");
    console.log(rows.join("\n"));

    const total = fixture.queries.length;
    const pct = (value: number) => `${((value / total) * 100).toFixed(1)}%`;
    console.log("");
    for (const mode of MODES) {
      const item = stats.get(mode)!;
      console.log(
        `${mode.padEnd(7)} recall@${k}: ${item.hits}/${total} = ${pct(item.hits)}，MRR = ${item.mrr.toFixed(3)}`,
      );
    }
    console.log(
      `文件名   recall@${k}: ${fileStats.hits}/${total} = ${pct(fileStats.hits)}，MRR = ${(fileStats.mrr / total).toFixed(3)}`,
    );
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

await main();
