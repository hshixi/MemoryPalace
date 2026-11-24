# MemoryPalace · RAG 设计（阶段 1–2：正文索引 + 混合检索）

> 状态：阶段 1A + 1B + 2 已实现（M7a–M7f、M8a–M8e）· 2026-11-24
> 范围：**P2 · RAG**。阶段 1 做文本、PDF、DOCX 正文的关键词检索；阶段 2 加本地向量与 RRF 混合检索。
> 上游文档：[后端设计](DESIGN.md)、[BRIEF.md](../../BRIEF.md) 的 RAG 路线、[harness/05-tool-layer.md](../harness/05-tool-layer.md)。

---

## 0. 用人话说

现在助手能按**文件名**找到文件，但你说「哪份文档里提过续费率」，它只能猜。RAG 阶段 1 要做的是：

1. 索引时把文本文件的正文读出来，切成小块；
2. 每块记住它来自哪个文件、第几行到第几行；
3. 你问内容时，用关键词在这些块里找，返回「片段 + 出处」；
4. 模型看到片段后，如果是文本文件、又需要更多上下文，再用 `read_file(start, end)` 读原文；PDF/DOCX 只能引用片段（按页/段）。

阶段 1 先不做向量，把「正文可检索」和「引用可追溯」跑通，用 eval 量出基线。阶段 2 已加上本地向量，与关键词做 RRF 融合，并在原句集和改写集上对比三种模式；**rerank 和 query 改写仍留到阶段 3**。

阶段 2 的默认行为：内容检索走 `hybrid`（关键词 + 语义），模型不可用时自动退回纯关键词，不阻塞对话。每条命中带 `via`（`keyword` / `vector` / `both`），前端只在语义参与时显示小标记。

---

## 1. 目标与非目标

### 1.1 本阶段要达成

| 目标 | 验收方式 |
|---|---|
| 文本 / PDF / DOCX 正文进索引 | 重建后，`chunks` 表和 `chunks_fts` 有数据 |
| 内容检索工具 | 模型能调用 `search_content`，返回片段、路径、行号范围、分数 |
| 引用可追溯 | 每个片段都能定位到源文件，并按行 / 页 / 段引用；前端显示「正文命中」 |
| 不泄露密钥 | 入库前脱敏；敏感文件仍然完全不进索引 |
| 可量化 | 20–50 条 query → 期望文件的 eval，输出 recall@5 / MRR |
| 不破坏旧能力 | `search_files`、`read_file`、写操作、确认流、记忆全部保持原样 |

### 1.2 本阶段不做

| 不做 | 去向 |
|---|---|
| 向量、embedding、RRF | ✅ 阶段 2（M8）；rerank / query 改写留阶段 3 |
| XLSX / PPTX 解析 | 后续按需；表格与图片目前只有元数据 |
| 图片 OCR、音视频转写 | 后续按需 |
| 自动摘要、自动标签、主题内容相似度 | 阶段 2/3 |
| 增量监听文件变化 | 仍然手动重建 + 写操作后就地更新 |

---

## 2. 数据流

```
索引重建
  scanWorkspace()            只读元数据，沿用现有实现
    ↓
  extractChunksAsync()       按扩展名分派：文本 / PDF（pdfjs）/ DOCX（mammoth）
    ↓
  redactSecrets()            入库前脱敏，原文不落库
    ↓
  chunkText()                按行（PDF 按页、DOCX 按段）打包，约 800 字一块
    ↓
  replaceFiles(files, chunks) 一个事务里替换 files / chunks / 两个 FTS
    ↓
  embedPendingChunks()       阶段 2：给新块补本地向量，写 chunk_vectors
```

检索：

```
用户问「哪份文档提过续费率」
  ↓
模型调用 search_content(query)
  ↓
parseSearchQuery()           复用现有的时间/类型/停用词处理，只取 keywords
  ↓
两条路并行：
  A. FTS5 trigram + LIKE 兜底 → 覆盖度/出现次数打分
  B. 本地 bge 嵌入 query     → 余弦暴力扫，阈值 0.3
  ↓
RRF 融合（关键词权 1.5，向量权 1.0），标 via
  ↓
返回 path + locKind + startLine/endLine + snippet + via（不可信数据）
  ↓
文本文件需要上下文时调用 read_file(path, start, end)
```

---

## 3. 支持范围与上限

### 3.1 阶段 1A：文本格式

与 `isTextExt()` 一致：

```
md markdown txt csv json yaml yml log html css js ts tsx jsx py go rs java sh sql xml
```

- 单文件 ≤ **1 MB**；超过只索引元数据，不读正文。
- 单文件最多 **200 块**；超过截断，并在索引审计里记一条 `content_truncated`。
- 全库最多 **100,000 块**；达到上限后停止继续抽取正文，元数据索引不受影响。
- 含 NUL 字节的文件视为二进制，跳过正文。
- 读取失败（权限、编码）记入 `errors[]`，不中断整次索引。

### 3.2 阶段 1B：PDF / DOCX（已实现）

- PDF 用 `pdfjs-dist`（legacy build），逐页 `getTextContent()` 抽文本；DOCX 用 `mammoth.extractRawText()`。都只抽文本，不保版式。
- 引用单位：
  - 文本 → 行（`locKind = line`）；
  - PDF → 页（`locKind = page`，`start_line = end_line = 页码`）；
  - DOCX → 段（`locKind = paragraph`，`start_line/end_line` 是 1-based 段落号）。
- 单文件上限：PDF / DOCX 各 **20 MB**；PDF 最多解析 **300 页**；单文件仍最多 **200 块**。
- PDF 每个文本页单独切块，不跨页拼接；DOCX 把段落打包进约 800 字的块，超长单段按 800 字切开、段号不变。
- PDF 抽取可能出现康熙部首 / CJK 部首补充字符（如 ⼀、⻓），入库前做定点规范化；不做整串 NFKC，避免全角标点被改成半角。
- 加密或损坏的 PDF 返回 `pdf_encrypted` / `pdf_failed:*`，不抛异常、不阻塞其他文件。
- `read_file` 仍然只读文本文件；PDF/DOCX 只能引用检索片段，system 里已写明。

### 3.3 敏感与脱敏

- `isSensitiveRelPath()` 命中的文件照旧完全不进 `files`，也不进 `chunks`。
- 文本抽取后先跑 `redactSecrets()`，**存的是脱敏后的文本**；密钥不会出现在 `chunks`、FTS、工具结果或日志里。
- 代价：搜不到被脱敏的密钥内容；这是有意为之。
- 片段返回给模型时仍然标记 `untrusted: true`；前端/模型都不能把它当指令。

---

## 4. 分块规则

目标：块足够小，能精确引用；又足够大，回答时有上下文。

- 按行打包，单块上限 **800 字符**（不是字节）。
- 块之间保留 **1 行重叠**，避免一句话被切断后两边都缺上下文。
- 单行超过 800 字符时，按 800 字符切片；同一行会产生多个块，行号相同。
- 空块（只有空白）不写入。
- 每块记录：
  - `rel_path`
  - `chunk_index`（文件内从 0 开始）
  - `loc_kind`（`line` / `page` / `paragraph`）
  - `start_line` / `end_line`（1-based，包含；含义由 `loc_kind` 决定）
  - `text`（已脱敏）
- 不记录字符偏移：行号足够定位，`read_file` 也按行读。

示例：

```
第 1 行  # 2026 Q3 营收分析
第 2 行
第 3 行  本季度营收同比增长 12%……
...
→ chunk 0: start=1, end=12
→ chunk 1: start=12, end=24   （第 12 行重叠）
```

---

## 5. 表结构

```sql
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  text TEXT NOT NULL,
  loc_kind TEXT NOT NULL DEFAULT 'line',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_file_idx ON chunks(file_id);
CREATE INDEX IF NOT EXISTS chunks_path_idx ON chunks(rel_path);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  content='chunks',
  content_rowid='id',
  tokenize='trigram'
);

-- 阶段 2：块向量。一个块在每个模型下最多一条。
CREATE TABLE IF NOT EXISTS chunk_vectors (
  chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chunk_vectors_model_idx ON chunk_vectors(model);
```

- `file_id` 外键 `ON DELETE CASCADE`：删除文件记录时块自动删除；FTS 由触发器同步。
- 同时存 `rel_path`，便于按路径清理和调试；路径很短，重复成本可接受。
- FTS 用外部内容表，不重复存正文。三个触发器维护 `INSERT / DELETE / UPDATE`。
- 启动时比对 `chunks` 与 `chunks_fts` 行数，不一致就 `rebuild`，与现有 `files_fts` 的做法一致。
- `chunk_vectors.vector` 是 `Float32Array` 的原始字节（默认 768 维 = 3072 B），不存 JSON；`model` 区分不同嵌入模型，换模型不会串用旧向量。
- `chunk_vectors` 外键级联：重抽文件先删旧块，旧向量随之消失，不会留下孤儿。`user_version = 4`。

---

## 6. 检索策略

### 6.1 关键词

复用 `parseSearchQuery()`：

- 去掉「帮我 / 找一下 / 关于 / 那份」等停用词；
- 保留中文片段和英文词；
- 时间/类型提示对内容检索不生效（元数据过滤仍由 `search_files` 负责）。

**长中文串的退一步匹配**：中文没有空格，用户会把几个词连成「订阅收入增长」，而原文是「订阅收入：+18%」。整串不是原文时，对 4 字以上的纯中文词按 2 字一组切成子词（`订阅 / 收入 / 增长`）；3 字以内保持整串，避免「毛利率」被拆坏。每个原始词算一组，组内命中子词的比例就是这组的分。

### 6.2 候选集

对每个关键词：

1. 长度 ≥ 3 且只含字母/数字/汉字 → FTS5 `MATCH "keyword"`，按 `bm25` 取前 120。
2. 长度 < 3、FTS 报错或该关键词 FTS 无结果 → `LIKE '%keyword%'` 兜底，取前 120。
3. 合并候选，按 `chunk.id` 去重。

> trigram 对 2 字中文不命中，这是已知坑；LIKE 兜底保证「营收」「续费」这类短词仍能搜到。

### 6.3 排序

可解释的规则分，不假装是模型分数：

```
groupScore = 该组命中的子词数 / 该组子词数     （2 字以内或英文词，命中即 1 或 0）
coverage   = 各组 groupScore 的平均
occurrences = 所有命中子词在块内出现次数之和（封顶 5）
score = coverage * 0.8 + min(occurrences, 5) / 5 * 0.2
```

- 可拆分的词至少要命中 **2 个子词**（词本身不足 2 个子词时命中 1 个即可）才算候选。只蹭到「市场投放」里的「市场」不算，否则「海外市场」会被当成市场投放。
- `coverage` 是主信号；多个关键词同时出现更可信。
- 同分时按路径再按行号（正文检索不再用时间，时间属于 `search_files` 的职责）。
- 返回前 `k` 个块（默认 5，最多 10）。
- 文本块在返回前会从「块的行范围」收窄到**真正命中的那一行**；PDF/DOCX 保持整页/整段引用，不伪造行号。

### 6.4 片段

- 以第一个命中的关键词为中心，向前后各取约 120 字符，总长 ≤ 320 字符。
- 超出用 `…` 标记。
- 片段是脱敏后的文本，再跑一次 `scanInjection()`；命中则在结果里标 `injectionSuspected: true`，但不改变文本。

### 6.5 语义检索（阶段 2）

- **模型**：默认 `Xenova/bge-base-zh-v1.5`（ONNX，`q8` 量化，768 维，约 103 MB），纯本地 CPU，不联网推理；`MP_EMBED_MODEL` 可换模型。
- 查询加 BGE 官方指令前缀「为这个句子生成表示以用于检索相关文章：」，文档不加；输出做 mean pooling + L2 归一化。
- 首次运行会从 Hugging Face 下载模型到 `~/.cache/memorypalace-embed`；本机走代理时需要 `NODE_USE_ENV_PROXY=1`，之后加载无需代理。
- 选型实测（同一套 20 条原句集 + 10 条改写集，k=5）：

| 模型 | 维度 / q8 体积 | 原句 vector recall / MRR | 改写 vector recall / MRR | 改写 hybrid recall / MRR |
|---|---|---|---|---|
| small-zh-v1.5 | 512 / 23 MB | 85% / 0.742 | 80% / 0.700 | 90% / 0.783 |
| **base-zh-v1.5（默认）** | 768 / 103 MB | **95% / 0.867** | **100% / 0.833** | **100% / 0.833** |
| large-zh-v1.5 | 1024 / 327 MB | 100% / 0.900 | 100% / 0.875 | 100% / 0.825 |

- base 用 1/3 的下载量换到改写集 100% 召回；large 在原句集 MRR 再高 0.033，但改写 hybrid 反而略低，暂不作为默认。
- 换模型不会串用旧向量：向量行带 `model` 字段，旧模型的向量不参与新模型检索；重建索引后会按新模型补。
- **reranker 实测不划算**：本地 `bge-reranker-base` 对明显相关/无关对能分开（logit 3.2 vs -10.2），但对「留住用户 → 首周留存」「配色 → 主色/强调色」这类改写排序错误。阶段 3 若要做 rerank，需要换更强的双语 reranker 或接远端模型，不能直接上这个。
- **建向量**：索引重建、写文件、移动文件后，给还没有向量的块批量补（每批 64 块，模型内部再按 16 条一批）。单次最多 10,000 块；超出的块仍可关键词检索，只是没有语义分。
- **查向量**：进程内缓存 `chunk_id → 向量` 的矩阵（最多 20,000 条），余弦相似度退化为归一化后的点积，暴力扫一遍。MVP 规模下不引入 ANN 扩展；缓存签名是 `(条数, 最近写入时间, 最大 chunk_id)`，索引一变就重载。
- **阈值**：余弦 < `0.3` 的候选直接丢掉，避免语义检索永远有结果。
- **片段**：语义命中没有关键词位置可对齐，取块首 240 字符；`locKind` 仍按文件类型给行 / 页 / 段。
- **降级**：`MP_EMBED=0` 或模型加载失败时，向量候选为空，`hybrid` 自然退化成纯关键词；错误只在日志里提示一次。

### 6.6 混合融合

关键词分（0–1 的覆盖率分）和余弦分不可比，所以按**名次**融合，不按原始分相加：

```
gain(candidate) = weight / (RRF_K + rank + 1)      rank 从 0 开始，RRF_K = 60
weight = 1.5（关键词） / 1.0（向量）
score = 该块所有 gain 之和 / 本次最大 gain      // 归一化到 0–1，便于展示
```

- 同一个块两边都命中时累加 gain，`via = "both"`；展示上保留关键词候选的**窄行号**，因为语义那边只有整块。
- 排序：融合分降序 → 路径 → 起始行。
- `KEYWORD_WEIGHT = 1.5` 是在当前 20 条金标集上选的：不加权时 hybrid MRR 0.975（「Q4 品牌升级」的期望文件被双命中的投资人更新挤到第 2），1.5 后回到 1.000。**这是小样本上调出来的参数，不代表真实工作区最优**；扩大金标集后要重新确认。
- **精度闸**：只要关键词命中 ≥ 1 块，纯语义候选就不再追加，只保留关键词命中和「双命中」；关键词**零命中**时才让语义兜底。本地模型的余弦分数很挤，相关与无关块常落在同一窄带，「重排序」这种只中 1 块关键词的查询再补 4 条语义，结果里几乎全是访谈、书摘这类只沾边的文件。与其返回看起来相关的噪声，不如少返回；同义改写完全搜不到关键词时，语义路径仍然工作。
- 模式可显式指定（`keyword` / `vector` / `hybrid`），默认 `hybrid`；前两种只用于排查和 eval 对照。

---

## 7. 工具契约

### 7.1 `search_content`

```json
{
  "query": "string，用户要找的内容，保留业务词",
  "k": { "type": "integer", "minimum": 1, "maximum": 10, "default": 5 },
  "probe": { "type": "boolean", "default": false }
}
```

`probe=true` 是意图探测用的降级模式：只走字面关键词（`mode: "keyword"`），`k` 被压到最多 3 条，结果带 `probe: true` 和 summary「意图探测完成」。模型在模糊短句上先探测一次，**探测结果默认不展示**：前端看到 `probe: true` 就不渲染正文卡片和右侧引用栏，模型也只在片段明显对得上时才引用。

返回给模型：

```json
{
  "query": "哪份文档提过续费率",
  "interpreted": { "keywords": ["文档", "续费率"] },
  "hits": [
    {
      "path": "01-财务/2026/Q3/2026-Q3-营收分析.md",
      "name": "2026-Q3-营收分析.md",
      "loc": "第 9–10 行",
      "locKind": "line",
      "snippet": "下一季度重点：续费率与企业客户。",
      "score": 0.92,
      "via": "both",
      "matched": ["续费率"],
      "untrusted": true,
      "injectionSuspected": false
    }
  ]
}
```

- 描述里明确：**只找正文片段，不是完整文件**；文本文件需要上下文再 `read_file`，PDF/DOCX 读不了全文。
- 结果为空时直说没找到，不要编造。
- `via` 说明这条是怎么找到的：`keyword` 有字面证据；`vector` 只靠语义，**引用前必须核对片段和问题是否真的对得上**；`both` 两边都命中。
- 前端展示 `name / path / loc（行/页/段）/ snippet`，语义参与时加「语义」「关键词+语义」小标记；点卡片仍然打开所在文件夹。
- **卡片只展示回答里引用到的命中**：file name / 去扩展名的文件名 / 完整路径出现在回答中，或回答引用了片段里的一小段原文。回答还没写、或模型说「没找到」时，一张都不显示——检索是候选，回答才是相关性判定。

### 7.2 与 `search_files` 的分工

| 问题 | 用哪个 |
|---|---|
| 「上周那份营收 PDF 在哪」 | `search_files`（文件名/时间/类型） |
| 「哪份文档提过续费率」 | `search_content`（正文） |
| 先知道文件名，再读内容 | `search_files` → `read_file` |
| 只知道内容，且是文本文件 | `search_content` → 需要更多上下文时 `read_file` |
| 只知道内容，文件是 PDF/DOCX | `search_content`；引用页码/段落，不要声称读过全文 |

system 里加一条：**找文件用 `search_files`，找内容用 `search_content`；不要用 `search_content` 替代列目录。**

---

## 8. 索引对账

- **全量重建**：`replaceFiles(files, chunks)` 一个事务；
  - `DELETE FROM files` 通过外键级联删 `chunks`，触发器同步删 FTS；
  - 插入文件和块，触发器写入 FTS。
- **写文件 / 移动 / 删除**：沿用 `reindexPath` / `deindexPath`；
  - 写：重新抽取该文件的块，先删旧块再插新块；
  - 移动：删旧路径的块，按新路径重新抽取（内容不变，但路径和行号要更新）；
  - 删除：删文件记录，级联删块。
- 单文件抽取失败时，只删该文件的旧块，不让整库失败；审计记录 `content_reindex_failed`。
- 写 / 移后的重抽取现在是异步的：`reindexPath` 会等 PDF/DOCX 解析完再返回，确认流的 `apply` 本来就是异步。

---

## 9. Eval

### 9.1 金标集

`server/eval/rag-queries.json`：

```json
{
  "queries": [
    {
      "query": "续费率",
      "expect": ["01-财务/2026/Q3/2026-Q3-营收分析.md", "01-财务/投资人/投资人更新-2026-10.md"]
    },
    {
      "query": "续签提前 60 天",
      "expect": ["05-合同/2026/云服务合同-2026.md"]
    }
  ]
}
```

- 第一版 20 条，覆盖财务、合同、会议、设计、研究、技术。
- 每条只标「期望命中的文件」（任一命中即算对），不标具体行；行号由检索结果自己给。
- 后续扩到 50 条；真实工作区的 query 单独一份。

`server/eval/rag-paraphrase-queries.json` 是第二套「改写问法」集（10 条），刻意避开原文措辞，用来量语义检索：

- 「团队靠什么留住用户」→ 增长复盘（原文是「首周留存」）
- 「办公室最多能接受多少租金」→ 租约（原文是「租金上限」）
- 「当前配色定下来了吗」→ 设计规范（原文是「主色 / 强调色」）

原句集测的是回归，改写集测的是关键词盲区；两套分开看，避免用一套的平均分掩盖差异。

### 9.2 指标

- `recall@5`：期望文件里有多少出现在前 5 个结果的文件集合里。
- `MRR`：第一个期望文件排名的倒数。
- 同时跑 `search_files` 作为对照，展示「正文检索」相对「文件名检索」的增量。

### 9.3 命令

```bash
npm run eval:rag                                   # 默认用 workspace-sample + 原句集
npm run eval:rag:paraphrase                        # 改写问法集（等价于 --queries ...）
npm run eval:rag -- --workspace /path              # 换工作区
npm run eval:rag -- --k 10 --verbose               # 改 k，并打印期望路径
```

每次都在临时目录建一个新库、全量重建，不碰开发库，所以不存在「忘了重建」。

实测（workspace-sample，k=5，默认 bge-base-zh-v1.5）：

原句集（20 条）：

| 模式 | recall@5 | MRR | 说明 |
|---|---|---|---|
| `keyword` | 20/20 = 100.0% | 1.000 | 字面命中，金标集与原文用词接近，几乎必中 |
| `vector` | 19/20 = 95.0% | 0.867 | 只漏「三秒内」一条；不看字面，专补同义说法 |
| `hybrid` | 20/20 = 100.0% | 1.000 | 召回等同关键词，语义补回关键词漏掉的改写 |
| 文件名对照 | 1/20 = 5.0% | 0.050 | 证明正文检索的增量 |

改写集（10 条）：

| 模式 | recall@5 | MRR | 说明 |
|---|---|---|---|
| `keyword` | 4/10 = 40.0% | 0.350 | 措辞对不上就大面积失败 |
| `vector` | 10/10 = 100.0% | 0.833 | small 模型只有 80% / 0.700，base 补上了 |
| `hybrid` | 10/10 = 100.0% | 0.833 | 关键词零命中时语义兜底，正好覆盖关键词盲区 |
| 文件名对照 | 0/10 = 0.0% | 0.000 | 改写问法根本不会提文件名 |

- 关键词模式在原句集上没有失败，所以 hybrid 的收益不体现在那里；改写集才看出关键词盲区（40% → 100%）。
- MRR 1.000 是关键词加权 1.5 之后的结果；不加权时 hybrid 0.975，差在「Q4 品牌升级」一条。20 条样本上 0.025 的差距不足以证明加权一定更好，但也没有引入回归，先保留并记录。
- 金标集目前只覆盖文本文件；PDF/DOCX 的检索质量用测试里的 fixture 单独守住，没有并入 eval。
- 两套都是按示例工作区手写的，改写集也可能刚好被 base 模型覆盖；它们的作用是钉住回归基线，并指示方向，不代表真实工作区。真实工作区的 query 要单独收集。

不通过 Dashboard 写数据库；eval 是离线脚本，结果可贴进实验区。

---

## 10. 里程碑

| 步骤 | 内容 | 完成标志 | 状态 |
|---|---|---|---|
| **M7a** | 表结构、抽取、分块、全量重建写入 chunks | 重建后 chunks 有数据，敏感文件仍被排除 | ✅ 2026-11-23 |
| **M7b** | `search_content` 工具 + system 约定 + mock 意图 | 对话里问内容能返回片段和行号 | ✅ 2026-11-23 |
| **M7c** | 前端正文命中卡片 + 右侧引用 | 浏览器里能看到「正文命中」和出处 | ✅ 2026-11-23 |
| **M7d** | eval 金标集 + 脚本 + 基线数字 | `npm run eval:rag` 输出 recall/MRR | ✅ 2026-11-23 |
| **M7e** | 写 / 移 / 删后的单文件对账 | 写完文件立刻能搜到新内容 | ✅ 2026-11-23 |
| **M7f** | PDF / DOCX（第二小步） | 样本 PDF/DOCX 能抽文本并引用页码/段落 | ✅ 2026-11-24 |
| **M8a** | 向量表 + 本地嵌入 + 建向量 | 重建后 `chunk_vectors` 有数据，失败可降级 | ✅ 2026-11-24 |
| **M8b** | 语义检索 + 阈值 + 内存缓存 | `mode=vector` 能返回语义候选 | ✅ 2026-11-24 |
| **M8c** | RRF 混合 + `via` 标记 | 默认 `hybrid`，前端能看到语义/双命中标记 | ✅ 2026-11-24 |
| **M8d** | 同集 eval + 文档 | 三种模式 recall/MRR 可复现，局限写清楚 | ✅ 2026-11-24 |
| **M8e** | 改写集 + embedding 选型 + reranker 实测 | 两套集分开看；base 设为默认；reranker 结论有数据 | ✅ 2026-11-24 |

---

## 11. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 中文 2 字词 trigram 不命中 | 搜不到「营收」「续费」 | LIKE 兜底；eval 里专门放短词 query |
| 大文件/大库抽取慢 | 重建卡住 | 1 MB / 200 块 / 10 万块上限；抽取失败不阻塞 |
| 密钥进入正文索引 | 泄露给模型或前端 | 入库前脱敏；敏感文件完全不索引 |
| 片段被模型当指令 | 注入 | 结果标 `untrusted`，片段扫注入，system 明确数据边界 |
| 分块切断语义 | 回答缺上下文 | 1 行重叠；工具描述要求必要时 `read_file` |
| PDF 解析质量差（扫描件、乱码） | 引用不准或抽不到正文 | 只索引有文本层的 PDF；扫描件按元数据处理；失败原因可解释 |
| PDF/DOCX 抽文本拖慢重建 | 大工作区重建变慢 | 20 MB / 300 页 / 200 块上限；PDF 依赖动态 import，无 PDF 时不加载 |
| 首次下载嵌入模型失败 | 语义检索不可用 | 失败只告警并退回关键词；`MP_EMBED=0` 可显式关闭；模型缓存在本地 |
| 向量占内存 / 建向量拖慢首次索引 | 大工作区变慢或占内存 | 内存最多 2 万条、单次最多嵌 1 万块；超出部分只做关键词 |
| 语义命中看起来相关、实则不对 | 模型引用错片段 | 阈值 0.3；`via=vector` 在 UI 标注，system 要求引用前核对片段 |
| 小样本上调融合权重过拟合 | 换工作区反而变差 | 权重写进文档并标注样本量；扩金标集后重新校准，必要时退回不加权 |

---

## 12. 实现状态与偏差（2026-11-24）

阶段 1A + 1B + 2 已实现，测试 128 条全过（`server/test/rag.test.ts` 覆盖抽取/检索，`server/test/rag-vector.test.ts` 覆盖向量打分与 RRF 纯函数；`npm test` 强制 `MP_EMBED=0`，测试不依赖模型下载）。

| 模块 | 文件 |
|---|---|
| 类型与定位文案 | `server/src/rag/types.ts` |
| 切块 | `server/src/rag/chunk.ts` |
| PDF 抽取 | `server/src/rag/pdf.ts` |
| DOCX 抽取 | `server/src/rag/docx.ts` |
| 字形规范化 | `server/src/rag/normalize.ts` |
| 抽取分派 / 脱敏 / 上限 | `server/src/rag/content.ts` |
| 全量重建并发抽取 | `server/src/rag/indexer.ts` |
| 正文检索与打分 | `server/src/rag/search.ts` |
| 混合融合（RRF） | `server/src/rag/search.ts`（`fuseCandidates`） |
| 本地嵌入模型 | `server/src/rag/embed.ts` |
| 语义检索 / 内存矩阵 | `server/src/rag/vector.ts` |
| 批量建向量 | `server/src/rag/vector-index.ts` |
| 向量读写 | `server/src/store/vectors.ts` |
| chunks 读写 | `server/src/store/chunks.ts` |
| 表结构 / FTS / 触发器 | `server/src/store/db.ts`（`user_version = 4`，含 `loc_kind` 迁移） |
| 全量重建接入 | `server/src/index/service.ts` |
| 写 / 移 / 删对账 | `server/src/index/reconcile.ts` |
| 工具契约 | `server/src/runtime/tools.ts` |
| system 分工说明 | `server/src/runtime/assembler.ts` |
| mock 意图 | `server/src/model/mock.ts` |
| eval | `server/eval/rag-queries.json`、`server/scripts/eval-rag.ts` |
| 前端 | `demo/src/components/ChatParts.tsx`（`ContentHitCard`）、`Chat.tsx`、`api.ts` |
| 测试 fixture | `server/test/fixtures/archive.pdf`、`sample.pdf`、`sample.docx` |

与设计稿的偏差，都是有意简化：

- **截断不单独发审计事件**：单文件超过 200 块只累加 `truncatedFiles`，写进索引审计的 `result` 字符串；没有独立的 `content_truncated` 事件。
- **排序同分**按路径 + 行号，不按修改时间；时间信号留给 `search_files`，避免正文检索偏向新文件。
- **写操作后的抽取是异步的**：写/移后 `await reindexPath` 重抽该文件；超过上限的文件只保留元数据，旧块会被清掉。
- **PDF/DOCX 按块脱敏**（文本文件是先整篇脱敏再切块）：极少数跨块切断的密钥串理论上可能漏网，输出层还有一道脱敏兜底。
- **PDF 每个文本页单独切块**，不跨页合并；因此超长页可能产生多个同页号的块。
- **eval 每次都在临时库全量重建**，所以没有 `--rebuild` 开关；`--workspace`、`--k`、`--verbose` 可用。
- **长中文串按 2 字子词退一步匹配**，是设计稿之外新增的启发式，见 6.1；eval 里「订阅收入增长」「租金上限」两条靠它从失败变通过。
- **子词候选门槛后来收紧**：可拆分的词至少命中 2 个子词。原规则「某组命中 ≥ 50%」会让「市场投放」只凭「市场」命中「海外市场」这类文档，返回的片段看起来与问题无关。
- **嵌入模型直接内置 `bge-base-zh-v1.5`**，没有做 Ollama / 远端 provider 抽象；模型名、缓存目录、量化类型可用 `MP_EMBED_MODEL` / `MP_EMBED_CACHE` / `MP_EMBED_DTYPE` 覆盖，但接口只面向本地 ONNX。
- **从 small 升到 base 是实测决定**：改写集 vector recall 80% → 100%，原句集 85% → 95%；large 的额外收益不足以抵消 3 倍体积和更慢的 CPU 推理，没有设为默认。旧库换模型后需要重建索引才会按新模型补向量。
- **向量检索是暴力点积**，没有 ANN 索引；内存上限 2 万条，索引缓存在进程内，多进程不共享。
- **建向量是索引的一部分，但失败不阻塞索引**：全量重建后只补 1 万块；单文件重抽时只补该文件。失败原因写进索引审计和日志。
- **语义命中的片段取块首 240 字符**，不做关键词高亮；`via=vector` 时模型必须核对片段再引用。
- **`KEYWORD_WEIGHT = 1.5` 是在 20 条金标集上调的**，见 6.6；不做「自动调参」，避免在小样本上继续过拟合。
- **混合检索加了精度闸**：关键词一旦有命中就丢弃纯语义候选，只有关键词零命中才用语义兜底。这是产品取舍（少而准），不是标准 RRF；eval 上 recall/MRR 不变，但能挡住实测里的语义噪声。
- **前端不展示 `score`**，只在语义参与时显示 `via` 小标记；分数是排序用的相对值，不是可信度。
- **`npm test` 固定 `MP_EMBED=0`**：单测只覆盖纯函数和关键词路径，向量集成靠 eval 和手工验证，避免 CI 首次运行下载模型。

---

## 13. 本阶段之后（阶段 3 候选）

- **rerank**：本地 `bge-reranker-base` 已实测，对明显相关/无关对有效，但对「留住用户 → 首周留存」「配色 → 主色」这类改写排序错误；先不接入。若继续，换更强的双语/中文 reranker 或接远端模型，并在改写集上量增量。
- **query 改写**：把口语问题改写成检索词（含同义词、时间/类型过滤），再走 hybrid；这是比本地 reranker 更可能补上「留住用户」这类盲区的方向。
- **扩金标集到 50 条**，加入真实工作区的匿名 query，重新校准 `KEYWORD_WEIGHT` 或改用更稳的融合（如加权分数 + 名次先验）。
- **XLSX / PPTX 解析**和图片 OCR，按真实需求再排。
- **向量规模上去后**再评估 ANN（sqlite-vec 或外置索引），现在不提前引入。
