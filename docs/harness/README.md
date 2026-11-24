# Harness 设计文档 · 总目录

> 这个目录回答一个问题：**MemoryPalace 的 harness 是怎么搭的，为什么这么搭。**
> 现在不需要全看懂。先看这张表，测试时再按需翻具体文档。

---

## 1. 九个模块（用人话说）

| # | 模块 | 用人话说 | 文档 |
|---|---|---|---|
| 1 | Context Assembler | 每次跟模型说话前，决定**给它看什么、看多少、按什么顺序** | [01](01-context-assembler.md) |
| 2 | Memory | 记住**你这个人**：称呼、偏好、上次找什么 | [02](02-memory.md) |
| 3 | Skills | 把"怎么干某件事"的说明书写成小册子，**用到才翻开** | [03](03-skills.md) |
| 4 | Agent Runtime | 引擎：请求 → 调工具 → 再请求，**能循环、能暂停、能恢复** | [04](04-agent-runtime.md) |
| 5 | Tool Layer | 模型能做哪些动作，参数怎么查，结果怎么压缩 | [05](05-tool-layer.md) |
| 6 | Model Adapter | 模型插头：换模型只换这一层 | [06](06-model-adapter.md) |
| 7 | Policy & Guardrail | 护栏：能做什么、不能做什么、危险动作先问一句 | [07](07-policy-guardrail.md) |
| 8 | Session & State | 记事本：聊到哪了、谁在等确认、关掉再开能接上 | [08](08-session-state.md) |
| 9 | Observability & Eval | 仪表盘：花了多少钱、做了什么、找得准不准 | [09](09-observability-eval.md) |

---

## 2. 三层结构

```
CONTEXT   看见什么    1 上下文  2 记忆  3 技能
ACTION    能做什么    4 运行时  5 工具  6 插头
CONTROL   被允许吗    7 护栏    8 状态  9 观测
```

记住三个问题就够了：

- **给模型看什么？**
- **让它做什么？**
- **怎么约束它、怎么知道它做对了？**

---

## 3. 现在不用读的部分

如果你接下来只想**体验**，不需要读设计文档。测试时我会用一个具体场景带你走：

1. 问一句"上次那份财报在哪"
2. 看它怎么检索、怎么调用工具
3. 看它在危险动作前怎么停下来问你
4. 看 trace 里记录了什么

到时只需要知道这几个词：

| 词 | 大白话 |
|---|---|
| system prompt | 每次开场前给模型的一页"工作须知" |
| tool | 模型可以按的一个按钮 |
| memory | 助手记住的关于你的事 |
| skill | 一页"操作手册"，用到才展开 |
| guardrail | 危险按钮前的确认框 |
| trace | 一行行车记录仪 |
| RAG | 先从文件里找相关片段，再让模型回答 |
| chunk | 把长文件切成的小段 |
| eval | 用一批标准题给检索打分 |
| embedding | 把文字变成一串数字，方便算"像不像" |

---

## 4. 建议的阅读顺序（等你真想看时）

1. [01 Context Assembler](01-context-assembler.md) —— 一切从这里开始
2. [05 Tool Layer](05-tool-layer.md) —— 模型能按哪些按钮
3. [04 Agent Runtime](04-agent-runtime.md) —— 按钮怎么串成一轮
4. [07 Policy](07-policy-guardrail.md) —— 哪些按钮要确认
5. [08 Session](08-session-state.md) —— 停下来之后怎么继续
6. [09 Observability](09-observability-eval.md) —— 怎么知道做得好不好
7. [02 Memory](02-memory.md) / [03 Skills](03-skills.md) —— P1 再读
8. [06 Model Adapter](06-model-adapter.md) —— 换模型时再读

---

## 5. P0 实现顺序（只读版本）

```
索引（FTS5）
  → 01 上下文装配
  → 06 模型插头
  → 05 工具层（只读工具）
  → 04 运行时（循环 + 流式）
  → 07 护栏（只读路径安全）
  → 08 会话（内存版先跑）
  → 09 trace
```

P1 再加：写/删确认、废纸篓、审计、热记忆、skills、金标评估。

---

## 6. 设计里最重要的三条

1. **指令和数据分两个通道**：文件内容永远是数据，不取得指令权限。
2. **危险动作先确认，删除只进废纸篓**：安全靠结构，不靠检测。
3. **历史只追加**：这样缓存能命中、暂停能恢复、问题能回放。

---

## 7. 相关文档

- [../../BRIEF.md](../../BRIEF.md) —— 产品 brief
- [../../HARNESS.md](../../HARNESS.md) —— 模块总图与决策摘要
