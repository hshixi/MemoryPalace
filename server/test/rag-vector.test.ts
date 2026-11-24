import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIN_VECTOR_SCORE, rankVectors } from "../src/rag/vector.ts";
import { fuseCandidates } from "../src/rag/search.ts";
import type { ContentHit } from "../src/rag/search.ts";

/** 这些是纯函数测试，不加载嵌入模型；npm test 里 MP_EMBED=0 也能跑。 */

function hit(path: string, startLine = 1, via: ContentHit["via"] = "keyword"): ContentHit {
  return {
    path,
    name: path.slice(path.lastIndexOf("/") + 1),
    locKind: "line",
    startLine,
    endLine: startLine,
    snippet: `${path} 的片段`,
    score: 1,
    keywords: [],
    via,
    injection: { suspected: false, signals: [] },
  };
}

describe("向量打分", () => {
  it("余弦相似度排序，低于阈值的候选被丢掉", () => {
    const ids = new Int32Array([10, 20, 30, 40]);
    const matrix = new Float32Array([
      1, 0, // 10: 1.0
      0, 1, // 20: 0
      0.9, 0.1, // 30: ~0.994
      0.4, 0.2, // 40: 0.4
    ]);
    const ranked = rankVectors(ids, matrix, 2, new Float32Array([1, 0]), 10);
    assert.deepEqual(
      ranked.map((row) => row.chunkId),
      [10, 30, 40],
    );
    assert.ok(ranked.every((row) => row.score >= MIN_VECTOR_SCORE));
  });

  it("limit 截断发生在过滤之后", () => {
    const ids = new Int32Array([1, 2, 3]);
    const matrix = new Float32Array([1, 0, 0.5, 0.5, 0.1, 0.1]);
    const ranked = rankVectors(ids, matrix, 2, new Float32Array([1, 0]), 1);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].chunkId, 1);
  });

  it("空索引返回空数组，同分按 chunkId 稳定排序", () => {
    assert.deepEqual(rankVectors(new Int32Array(0), new Float32Array(0), 2, new Float32Array([1, 0]), 5), []);
    const ids = new Int32Array([7, 3]);
    const matrix = new Float32Array([1, 0, 1, 0]);
    const ranked = rankVectors(ids, matrix, 2, new Float32Array([1, 0]), 5);
    assert.deepEqual(
      ranked.map((row) => row.chunkId),
      [3, 7],
    );
  });
});

describe("RRF 融合", () => {
  it("两边都命中的块标 both，并保留关键词的窄行号", () => {
    const keyword = [{ chunkId: 1, hit: hit("a.md", 12) }];
    const vector = [
      {
        chunkId: 1,
        hit: hit("a.md", 1, "vector"),
      },
    ];
    const [top] = fuseCandidates(keyword, vector);
    assert.equal(top.hit.via, "both");
    assert.equal(top.hit.startLine, 12);
    assert.equal(top.hit.score, 1);
  });

  it("关键词单独命中排在语义单独命中前面", () => {
    const fused = fuseCandidates(
      [{ chunkId: 1, hit: hit("kw.md") }],
      [{ chunkId: 2, hit: hit("vec.md", 1, "vector") }],
      { minKeywordHitsToSkipVectorOnly: 99 },
    );
    assert.deepEqual(
      fused.map((row) => [row.chunkId, row.hit.via]),
      [
        [1, "keyword"],
        [2, "vector"],
      ],
    );
    assert.equal(fused[0].hit.score, 1);
  });

  it("关键词名次靠后时仍可能被双命中反超", () => {
    const keyword = [
      { chunkId: 1, hit: hit("kw.md") },
      { chunkId: 2, hit: hit("both.md") },
    ];
    const vector = [
      { chunkId: 2, hit: hit("both.md", 1, "vector") },
      { chunkId: 3, hit: hit("vec.md", 1, "vector") },
    ];
    const fused = fuseCandidates(keyword, vector);
    assert.equal(fused[0].chunkId, 2);
    assert.equal(fused[0].hit.via, "both");
  });

  it("关键词已命中时丢掉纯语义候选，但仍保留双命中", () => {
    const keyword = [
      { chunkId: 1, hit: hit("a.md") },
      { chunkId: 2, hit: hit("b.md") },
    ];
    const vector = [
      { chunkId: 3, hit: hit("noise.md", 1, "vector") },
      { chunkId: 1, hit: hit("a.md", 1, "vector") },
    ];
    const fused = fuseCandidates(keyword, vector);
    assert.deepEqual(
      fused.map((row) => [row.chunkId, row.hit.via]),
      [
        [1, "both"],
        [2, "keyword"],
      ],
    );
  });

  it("关键词只命中一块时也不补纯语义", () => {
    const fused = fuseCandidates(
      [{ chunkId: 1, hit: hit("a.md") }],
      [{ chunkId: 3, hit: hit("noise.md", 1, "vector") }],
    );
    assert.deepEqual(
      fused.map((row) => row.chunkId),
      [1],
    );
  });

  it("关键词零命中时纯语义候选兜底", () => {
    const vector = [{ chunkId: 3, hit: hit("synonym.md", 1, "vector") }];
    const fused = fuseCandidates([], vector);
    assert.deepEqual(
      fused.map((row) => row.chunkId),
      [3],
    );
    assert.equal(fused[0].hit.via, "vector");
  });

  it("空输入返回空数组；只有语义时保留 vector 标记", () => {
    assert.deepEqual(fuseCandidates([], []), []);
    const fused = fuseCandidates([], [{ chunkId: 9, hit: hit("v.md", 1, "vector") }]);
    assert.equal(fused.length, 1);
    assert.equal(fused[0].hit.via, "vector");
    assert.equal(fused[0].hit.score, 1);
  });
});
