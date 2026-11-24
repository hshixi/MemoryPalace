# MemoryPalace · MVP 收敛验收

> 状态：已收口 · 2026-11-24
> 范围：M0–M8（P0 只读 + P1 写操作与长期记忆 + P2 RAG 阶段 1–2）
> 用途：把「什么算完成」写死。收口后**不再新增功能**，只修本文验收暴露的问题。

---

## 0. 一句话结论

MemoryPalace 的 MVP 到此为止：本地索引、只读对话、确认式写入、显式长期记忆、文本 / PDF / DOCX 正文检索、本地向量混合检索，全部跑通并有测试与 eval 覆盖。剩下的都是「需要真实 key 才能量」或「换实现才能质变」的事，放进 backlog，不在这一版里做。

---

## 1. 交付清单

| 能力 | 落地位置 | 状态 |
|---|---|---|
| 工作区扫描与索引（文件名、路径、类型、大小、修改时间） | `server/src/index/` | 完成 |
| Dashboard 真实数据（统计、主题、类型、活动、最近查询） | `/api/overview` + `demo/` | 完成 |
| 流式对话 + 手写 agent loop（最多 12 次模型调用） | `server/src/runtime/` | 完成 |
| 对话意图路由：文件 / 闲聊 / 模糊短句三种处理（模糊短句走 `probe=true`，探测结果不渲染） | `server/src/runtime/assembler.ts`、`tools.ts`、`demo/` | 完成（走查后补） |
| 正文卡片按回答引用过滤：模型说没找到就不出卡片 | `demo/src/api.ts` + `Chat.tsx` | 完成（走查后补） |
| 只读工具：搜索、文件信息、列目录、读文本、Finder 定位、技能 | `server/src/runtime/tools.ts` | 完成 |
| 确认式写入：新建 / 覆盖、移动、删除（只进废纸篓） | 同上 + `/api/confirm` | 完成 |
| 显式长期记忆（先确认、去重、会话内定格注入） | `server/src/store/` + `save_memory` | 完成 |
| 正文索引：文本按行、PDF 按页、DOCX 按段 | RAG 1A/1B | 完成 |
| 混合检索：FTS5 trigram + 本地 `bge-base-zh-v1.5` 向量，RRF 融合 | RAG 2 | 完成 |
| 安全边界：路径、敏感文件、脱敏、注入扫描、不可信标记 | `server/src/policy/` | 完成 |
| 可观测：trace、usage、成本、审计 | `traces` / `audit_log` | 完成 |
| 检索 eval：原句集 20 条 + 改写集 10 条 | `server/eval/` + `server/scripts/eval-rag.ts` | 完成 |
| 前端：Dashboard + Chat + 确认卡 + 记忆管理，浅色 / 深色 | `demo/` | 完成 |

---

## 2. 验收标准（可复跑）

全部在 `server/` 下执行。

### 2.1 静态与测试

```bash
npm run typecheck      # 0 error
npm test               # 128 passed，强制 MP_EMBED=0，不下载模型
```

通过标准：类型检查零错误；测试全绿。测试覆盖索引、搜索、路径、脱敏、注入、写操作确认、记忆、分块、PDF/DOCX、向量排序与融合。

### 2.2 检索质量

```bash
npm run eval:rag              # 原句集 20 条
npm run eval:rag:paraphrase   # 改写集 10 条
```

基线（示例工作区，k=5，任一期望文件命中即算对）：

| 集 | keyword | vector | hybrid | 文件名 |
|---|---|---|---|---|
| 原句 20 条 | 100% / MRR 1.000 | 95% / 0.867 | 100% / 1.000 | 5% |
| 改写 10 条 | 40% / 0.350 | 100% / 0.833 | 100% / 0.833 | 0% |

通过标准：hybrid 在两套集上都不低于 keyword；改写集上 hybrid 明显高于 keyword（证明语义补盲区有效）。这是手写小集，只作回归基线，**不外推为真实工作区指标**。

### 2.3 运行时冒烟

```bash
MP_PORT=4311 MP_PROVIDER=mock npm start
```

| 检查 | 通过标准 |
|---|---|
| `GET /api/health` | `ok:true`，`index.files > 0`，`embedding` 状态可用（配了模型时） |
| `GET /api/overview` | 统计、主题、类型、活动全部来自真实索引，无 mock 数字 |
| `GET /api/search?q=营收` | 返回元数据命中，不是正文片段 |
| `POST /api/chat` | SSE 依次出现 `session` → `tool_start` → `tool_result` → `text_delta` → `done` |
| Dashboard「最近问过」 | 正文检索命中的查询显示真实条数，不是 0；元数据检索同样计入 |
| 写操作 | `confirm_required` 后不落盘；`/api/confirm` 允许后才执行；拒绝后模型收到 `rejected_by_user` |
| `POST /api/index/rebuild` | 返回 `runId`，进度可查，完成后 `lastIndexedAt` 更新 |
| 前端（`VITE_MP_LIVE=1`） | Dashboard 数字与 `/api/overview` 一致；Chat 能显示工具卡片、确认卡、语义命中标记 |

### 2.4 安全回归

| 检查 | 通过标准 |
|---|---|
| 路径越界 | `../`、绝对路径、符号链接逃逸均返回 `path_escape`，无文件泄露 |
| 敏感文件 | `.env`、`*.pem`、`id_rsa` 等不进索引、不可读；错误信息不回显路径 |
| 密钥 | 文件正文里的密钥在入库和工具返回前已被脱敏 |
| 提示注入 | 文件里的可疑指令只产生提示，不进入 system 通道 |
| 网络边界 | 只绑定回环地址；非白名单 `Origin` 被拒绝 |

---

## 3. 已知限制（明说不做）

- **没有 rerank、没有 query 改写。** rerank 用 `bge-reranker-base` 实测在改写集上判错（见 [RAG.md](RAG.md) §12），已否决；query 改写需要真实 DeepSeek key 才能量效果，key 未配置，不做自欺式实现。
- **embedding 是本地 base 模型（768 维）。** 效果弱于大模型 embedding；向量全量载入内存暴力扫描，超过 2 万块的部分不参与语义检索。
- **语义命中只作兜底。** 关键词一旦有命中，纯语义候选就被丢弃。宁可少返回，不带只沾边的结果。
- **正文覆盖有限。** XLSX / PPTX / 图片只有元数据；扫描件 PDF 没有文本层抽不到；PDF / DOCX 不能读全文，只能引用片段。
- **写操作只支持文本。** PDF / DOCX / XLSX / 图片不能写入。
- **删除没有程序内恢复。** 只进系统废纸篓，由用户手动恢复，不承诺保留期。
- **记忆只支持显式写入。** 不自动提炼、不自动遗忘、不做向量召回。
- **端到端 eval 未接。** `e2e_success`、`avg_cost` 需要真实模型与 API key，目前只有检索层 eval。
- **没有打包。** 现在是 Node 单进程 + Vite 前端，Tauri 留到确定要交付桌面版时再做。

---

## 4. 收口后的 backlog（按触发条件，不按优先级）

| 事项 | 触发条件 |
|---|---|
| query 改写 | 配了真实 DeepSeek key，能跑端到端 eval 并量出增益 |
| 更强的 reranker / 远程 embedding | 真实工作区上出现可复现的排序错误，且本地手段改不动 |
| 金标集扩到 50 条 | 有真实工作区样本；扩集后必须重调关键词权重并重跑基线 |
| XLSX / PPTX / OCR | 用户真实文件里这类占比高，且明确要求检索正文 |
| Tauri 打包 | 要脱离浏览器交付给非技术用户 |
| 语义检索规模化（ANN / 分片） | 单工作区正文块稳定超过 2 万 |

---

## 5. 判定规则

1. 验收全部通过即视为 MVP 完成，**不再新增功能**。
2. 收口后只允许两类改动：修验收暴露的缺陷；改文档 / 注释使其与实现一致。
3. 任何新功能先写进第 4 节并说明触发条件，不在收口期顺手做。
4. 换 embedding 模型或改分块参数，必须重跑两套 eval 并更新基线，否则视为回归。
