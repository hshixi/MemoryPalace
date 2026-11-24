# 09 · Observability & Eval 深化

> 用人话说：这一层负责**看清楚它做了什么、花了多少钱、找得准不准**。没有它，调 prompt 和检索全靠感觉。

> 所属层：CONTROL　｜　依赖：Session　｜　被依赖：Dashboard、开发流程
> 目标：每次运行都能回答"为什么答成这样"。

---

## 0. 职责边界

1. **记录**：每次模型调用、工具调用、决策
2. **计量**：token、延迟、成本
3. **回放**：用保存的请求重跑某一轮
4. **评估**：用金标集量化检索与端到端效果

---

## 1. Trace

### 每次模型调用一条

```json
{
  "trace_id": "tr_01H...",
  "session_id": "sess_01H...",
  "turn": 3,
  "call_index": 2,
  "model": "deepseek-v4-flash",
  "thinking": false,
  "prompt_hash": "sha256:...",
  "usage": {
    "prompt_tokens": 12846,
    "cached_tokens": 12034,
    "cache_hit_tokens": 12034,
    "completion_tokens": 431,
    "reasoning_tokens": 0
  },
  "finish_reason": "tool_calls",
  "latency_ms": 2410,
  "cost_usd": 0.00091
}
```

### 每次回合一条汇总

```json
{
  "turn_id": "turn_01H...",
  "session_id": "...",
  "turns": 3,
  "tool_calls": [
    { "name": "search_files", "duration_ms": 38, "ok": true },
    { "name": "read_file", "duration_ms": 4, "ok": true }
  ],
  "decisions": [
    { "tool": "delete_file", "decision": "confirm" }
  ],
  "total_cost_usd": 0.0034,
  "status": "done"
}
```

**prompt_hash** 是排查缓存的第一线索：两轮 hash 相同、但 `cached_tokens` 为 0，说明问题在服务端或网络，不在你的装配。

---

## 2. 成本计量

按 DeepSeek 公开价（以官方为准）：

| 项 | 单价 |
|---|---|
| 未缓存输入 | ~$0.14 / M |
| 缓存命中输入 | ~$0.0028 / M |
| 输出 | ~$0.28 / M |

```ts
function costOf(u: Usage): number {
  const uncached = u.prompt_tokens - u.cached_tokens;
  return (
    (uncached / 1e6) * 0.14 +
    (u.cached_tokens / 1e6) * 0.0028 +
    (u.completion_tokens / 1e6) * 0.28
  );
}
```

账本按会话、按天汇总，Dashboard 实验区展示。

---

## 3. 回放

### 两种模式

| 模式 | 存什么 | 用途 |
|---|---|---|
| 轻量（默认） | prompt_hash、消息引用、usage | 看趋势、查成本 |
| 完整（显式开启） | 完整请求体（本地加密） | 精确复现某次错误 |

### 回放步骤

1. 从 trace 取出完整请求体
2. 重新发给同一模型、同一参数
3. 比较工具调用序列与最终文本
4. 记录差异

> 完整请求体包含文件内容，属于隐私数据：默认关闭、仅本地、可随时清除。

---

## 4. 金标集

一个 JSON 文件即可：

```json
[
  {
    "id": "q001",
    "query": "上周那份讲营收的 PDF",
    "expected": ["finance/2026-Q3-report.pdf"],
    "type": "retrieval"
  },
  {
    "id": "q002",
    "query": "找一下设计稿的截图",
    "expected": ["design/mockups/home.png", "design/mockups/list.png"],
    "type": "retrieval"
  },
  {
    "id": "q003",
    "query": "第三季度营收多少",
    "expected": ["finance/2026-Q3-report.pdf"],
    "type": "end_to_end"
  }
]
```

构建原则：

- 20–50 条起步
- 覆盖：精确文件名、模糊描述、时间线索、目录线索、无结果查询
- 每条至少一个人工确认过的期望文件
- 随项目增长补充，不删除失败样本

---

## 5. 指标

| 指标 | 定义 | 看什么 |
|---|---|---|
| `recall@k` | 期望文件出现在前 k 条的比例 | 检索够不够 |
| `MRR` | 第一个正确结果的倒数排名均值 | 排得准不准 |
| `hit@1` | 第一条就正确的比例 | 最好情况 |
| `e2e_success` | 端到端是否返回/定位到期望文件 | 整体好不好 |
| `avg_turns` | 平均工具轮数 | 是否绕路 |
| `avg_cost` | 每条查询平均成本 | 是否划算 |

**分层看**：检索差 → 改分词/索引；检索好但端到端差 → 改工具描述/prompt。

---

## 6. 评估 runner

```bash
npm run eval -- --set eval/golden.json --k 5
```

输出：

```
recall@5  0.86
MRR       0.64
hit@1     0.52
e2e       0.71
avg_cost  $0.0021
fails:
  q007  expected finance/Q2.pdf, got notes/q2.md
  q014  no results
```

**评估必须能离线跑**，不依赖 UI。每次改分词、分块、prompt、工具描述后都跑一遍。

已落地的是**检索层** eval（RAG 阶段 1–2，金标集目前只覆盖文本文件）：

```bash
cd server && npm run eval:rag
```

- 金标：`server/eval/rag-queries.json`（20 条，期望文件任一命中即算对）
- 每次在临时库全量重建，不碰开发库
- 同一套 query 跑 `keyword` / `vector` / `hybrid` 三种模式，再跑 `search_files` 对照，看清每种检索补上了什么
- 示例工作区基线（k=5）：原句集 keyword 100% / 1.000，vector 95% / 0.867，hybrid 100% / 1.000，文件名 5%；改写集 keyword 40% / 0.350，vector 100% / 0.833，hybrid 100% / 0.833，文件名 0%
- `--queries eval/rag-paraphrase-queries.json` 切换到改写集；两套分开看，原句集守回归，改写集量语义盲区
- 关键词权重 1.5 是在这 20 条上调的（不加权 hybrid MRR 0.975），扩集后要重新确认
- 这是按样本工作区手写的小集，query 与原文用词接近，**不能当作真实工作区指标**；它的价值是回归基线和分层定位

端到端（`e2e_success`、`avg_cost`）仍需要真实模型和 API key，尚未接入。

---

## 7. 与 Dashboard 的关系

Dashboard 的"实验区"（折叠）读取：

- 最近 7 天 recall@k 趋势
- 最近查询与命中情况
- 最近失败样本
- 成本曲线

默认折叠，避免干扰普通用户。

---

## 8. 隐私

- trace 默认不存 prompt 原文
- 完整回放数据本地加密、默认关闭
- 评估集里的文件路径可脱敏（只保留相对路径）
- 导出账本前提醒用户检查敏感信息

---

## 9. 接口

```ts
interface Tracer {
  recordCall(t: CallTrace): void;
  recordTurn(t: TurnTrace): void;
  costOf(u: Usage): number;
}

interface EvalRunner {
  run(setPath: string, k: number): Promise<EvalReport>;
}
```

---

## 10. 验收标准

- [ ] 每次模型调用都有 trace，usage 四项齐全
- [ ] `prompt_hash` 可用于比对两轮前缀
- [ ] 成本按会话/按天可汇总
- [ ] 金标集 runner 可离线运行，输出 recall@k / MRR / e2e
- [ ] 默认不保存 prompt 原文
- [ ] Dashboard 实验区能读到最近评估结果

---

## 11. 练习

1. 跑一次原句集（20 条）和改写集（10 条），记录基线。
2. 故意把 system 前缀改一个字符，观察 `cached_tokens` 归零、成本上升。
3. 把 `search_files` 的 `k` 从 8 调到 3，看 recall@k 怎么变。

---

## 12. 下一步

**02 Memory**：热记忆的写入、注入、去重与用户管理。
