import os from "node:os";
import path from "node:path";

/**
 * 中文 base 模型，768 维，q8 量化后约 103 MB。
 * 在同一套 eval 上明显好于 small（见 docs/backend/RAG.md 6.5），
 * large 再大 3 倍但收益很小，不作为默认。
 */
export const DEFAULT_EMBED_MODEL = "Xenova/bge-base-zh-v1.5";
/** bge 官方建议：查询加指令前缀，文档不加。 */
const QUERY_PREFIX = "为这个句子生成表示以用于检索相关文章：";
const BATCH_SIZE = 16;

export interface Embedder {
  model: string;
  dim: number;
  embedDocuments(texts: string[]): Promise<Float32Array[]>;
  embedQuery(text: string): Promise<Float32Array>;
}

/** MP_EMBED=0 时完全关闭向量层，退回纯关键词检索。 */
export function embeddingsEnabled(): boolean {
  return process.env.MP_EMBED !== "0";
}

let embedderPromise: Promise<Embedder | null> | null = null;

export async function getEmbedder(): Promise<Embedder | null> {
  if (!embeddingsEnabled()) return null;
  if (!embedderPromise) {
    embedderPromise = createEmbedder().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[embed] 本地向量模型不可用，退回关键词检索：${message}`);
      return null;
    });
  }
  return embedderPromise;
}

async function createEmbedder(): Promise<Embedder> {
  const transformers = await import("@huggingface/transformers");
  const model = process.env.MP_EMBED_MODEL ?? DEFAULT_EMBED_MODEL;
  const cacheDir =
    process.env.MP_EMBED_CACHE ?? path.join(os.homedir(), ".cache", "memorypalace-embed");
  const dtype = process.env.MP_EMBED_DTYPE ?? "q8";

  transformers.env.cacheDir = cacheDir;
  const extract = await transformers.pipeline("feature-extraction", model, {
    dtype,
  } as never);

  const run = async (texts: string[]): Promise<Float32Array[]> => {
    const out = (await extract(texts, {
      pooling: "mean",
      normalize: true,
    } as never)) as { tolist(): number[][] };
    return out.tolist().map((row) => Float32Array.from(row));
  };

  const probe = await run(["测试"]);
  const dim = probe[0]?.length ?? 0;
  if (dim === 0) throw new Error("向量维度为 0");

  return {
    model,
    dim,
    async embedDocuments(texts) {
      const out: Float32Array[] = [];
      for (let offset = 0; offset < texts.length; offset += BATCH_SIZE) {
        out.push(...(await run(texts.slice(offset, offset + BATCH_SIZE))));
      }
      return out;
    },
    async embedQuery(text) {
      const [vector] = await run([QUERY_PREFIX + text]);
      return vector;
    },
  };
}

/** 启动时预热，避免第一次搜索多等几秒；失败不影响服务。 */
export function warmEmbedder(): void {
  if (!embeddingsEnabled()) return;
  void getEmbedder();
}
