# 04 · Agent Runtime 深化

> 所属层：ACTION　｜　依赖：Context Assembler、Tool Layer、Policy、Provider Adapter
> 运行环境：DeepSeek V4 Flash（OpenAI 兼容，流式函数调用）
> 目标：把"一次请求"变成一个**可循环、可暂停、可恢复、可取消、可观测**的对话回合。

---

## 0. 职责边界

Runtime **不**决定检索什么、**不**决定工具怎么实现、**不**决定权限。
它只回答一个问题：**这一轮从用户消息到最终回答，中间的状态怎么流转。**

具体负责：

1. 调用 Assembler 生成请求（**每个用户回合只装配一次**）
2. 流式调用模型并聚合结果
3. 追加 assistant 消息与 tool 结果
4. 在危险动作前暂停，等待确认后恢复
5. 守住轮数、预算、超时、取消
6. 把每个状态写进 trace

---

## 1. 一轮的完整时序

```
用户消息
  │
  ├─[Assembler] 装配一次：system + 历史 + 检索块 + 用户消息
  │
  ▼
┌─ CALL_MODEL（流式） ─────────────────────────────┐
│  聚合 content / reasoning / tool_calls / usage   │
└──────────────────────────────────────────────────┘
  │
  ├─ finish_reason="stop"  → 追加 assistant 文本 → 结束
  │
  ├─ finish_reason="length"→ 输出被截断 → 报错
  │
  └─ finish_reason="tool_calls"
        │
        ├─ 追加 assistant 消息（含 tool_calls，思考模式含 reasoning_content）
        │
        ├─[Tool Layer] 校验参数 → [Policy] 权限判定
        │     ├─ read       → 执行（可并行），结果先暂存
        │     ├─ write/delete→ 生成 pending（不执行）
        │     └─ 越界/敏感   → 错误结果
        │
        ├─ 有 pending？
        │     ├─ 是 → 持久化状态 → 返回 awaiting_confirmation → 暂停
        │     └─ 否 → 按序追加所有 role:"tool" 消息 → 回到 CALL_MODEL
        │
        └─ 超过轮数/预算 → 终止
```

**关键约束：Assembler 只在用户回合开始时调用一次。**
后续工具循环只**追加**消息，不重新装配、不重新检索。否则用户轮内容会变，前缀缓存失效。

---

## 2. 流式聚合（DeepSeek 的坑集中在这里）

```ts
interface ToolCallAcc { id: string; name: string; args: string }

async function consume(stream, signal): Promise<AssistantTurn> {
  const textParts: string[] = [];          // 用数组拼接，不用 += 字符串
  const slots = new Map<number, ToolCallAcc>();
  let reasoning = "";
  let finish: string | null = null;
  let usage: Usage | null = null;

  for await (const chunk of stream) {
    if (signal.aborted) throw new CancelledError();

    if (chunk.usage) usage = chunk.usage;   // 末尾 usage 块的 choices 可能为空
    if (!chunk.choices?.length) continue;

    const choice = chunk.choices[0];
    const d = choice.delta;

    if (d?.content) textParts.push(d.content);
    if (d?.reasoning_content) reasoning += d.reasoning_content;

    for (const tc of d?.tool_calls ?? []) {
      const slot = slots.get(tc.index) ?? { id: "", name: "", args: "" };
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.name = tc.function.name;
      if (tc.function?.arguments) slot.args += tc.function.arguments;
      slots.set(tc.index, slot);
    }

    if (choice.finish_reason) finish = choice.finish_reason;
  }

  return {
    content: textParts.join(""),
    reasoning,
    toolCalls: [...slots.entries()]
      .sort((a, b) => a[0] - b[0])          // 按 index 排序，不按到达顺序
      .map(([, v]) => v),
    finishReason: finish,
    usage,
  };
}
```

**四条必须记住的规则：**

1. 并行 `tool_calls` **按 `tc.index` 聚合**——DeepSeek 会交错下发
2. `choices` 为空的块**不要丢**，里面可能有 `usage`
3. 文本用数组收集后 `join`，避免长流式的字符串拼接开销
4. **流式失败时不提交部分 assistant 消息**——要么整轮重试，要么丢弃

---

## 3. 循环主体

```ts
async function runTurn(input: RunTurnInput): Promise<RunTurnResult> {
  const { params } = assemble(input);            // 只装配一次
  const history = params.messages;
  const state = { turns: 0, outputTokens: 0 };

  while (state.turns++ < MAX_TURNS) {
    const turn = await provider.streamChat(
      { ...params, messages: history },
      input.signal,
    );

    // 1) 正常结束
    if (turn.finishReason === "stop") {
      history.push({ role: "assistant", content: turn.content });
      return done(turn.content, turn.usage);
    }

    // 2) 输出被截断
    if (turn.finishReason === "length") {
      return fail("output_truncated", turn.usage);
    }

    // 3) 工具调用
    if (turn.finishReason === "tool_calls") {
      history.push({
        role: "assistant",
        content: turn.content ?? "",
        tool_calls: serializeToolCalls(turn.toolCalls),
        // 思考模式开启时，必须原样带回，否则下一轮 400
        ...(thinkingEnabled ? { reasoning_content: turn.reasoning } : {}),
      });

      const plan = await planTools(turn.toolCalls);   // 校验 + 权限分类
      const outcomes = await executeSafely(plan);     // 读操作真执行，写操作变 pending

      if (outcomes.some(o => o.pending)) {
        persistRuntimeState(input.sessionId, { history, outcomes, usage: turn.usage });
        return awaitingConfirmation(outcomes, turn.usage);
      }

      for (const o of outcomes) {
        history.push({
          role: "tool",
          tool_call_id: o.toolCallId,
          content: JSON.stringify(o.result),
        });
      }
      continue;
    }

    return fail(`unexpected_finish:${turn.finishReason}`, turn.usage);
  }

  return fail("max_turns", null);
}
```

---

## 4. 状态机

```
IDLE
 └→ ASSEMBLE
     └→ CALL_MODEL
         ├─ stop ──────────────────────→ DONE
         ├─ length ────────────────────→ ERROR(output_truncated)
         ├─ tool_calls ─→ PLAN_TOOLS
         │                 ├─ 含 pending ─→ PERSIST → AWAITING_CONFIRMATION
         │                 │                    ├─ 确认 ─→ EXECUTE → OBSERVE → CALL_MODEL
         │                 │                    └─ 拒绝 ─→ OBSERVE(rejected) → CALL_MODEL
         │                 └─ 全部完成 ─→ OBSERVE → CALL_MODEL
         └─ error ──→ RETRY（有限）→ 仍失败则 ERROR
```

**状态必须可序列化。** 暂停时保存的是一份完整快照：`history + outcomes + usage + pending`。恢复时从快照继续，而不是从"用户消息"重来。

---

## 5. 确认暂停与恢复（最难的部分）

### 暂停时保存什么

```ts
interface RuntimeSnapshot {
  sessionId: string;
  history: Message[];          // 已追加 assistant(tool_calls)
  resolved: ToolOutcome[];     // 已执行完的读结果（按原顺序）
  pending: PendingAction[];    // 待确认的写/删
  usage: Usage;
  createdAt: number;
  expiresAt: number;           // 如 10 分钟
}
```

### 为什么要保存"已执行的读结果"

一次模型响应可能同时调：
- `search_files`（读，可立即执行）
- `delete_file`（删，需确认）

如果立即把读结果追加进 `history`，而删除结果要等用户——就会出现"部分 tool 消息已写入、另一部分还没写"的中间态。恢复时再补写，容易乱序、也可能重复。

**做法**：读操作**执行但不追加**，结果暂存在 `resolved`；等所有 pending 都处理完，再**按原调用顺序一次性追加**全部 `role:"tool"` 消息。

### 恢复流程

```ts
async function resume(sessionId, actionId, approved, signal) {
  const snap = loadSnapshot(sessionId);
  const idx = snap.pending.findIndex(a => a.id === actionId);

  snap.resolved[idx] = approved
    ? await executeAction(snap.pending[idx])
    : { toolCallId: snap.pending[idx].toolCallId,
        result: { ok: false, error: { code: "rejected_by_user" } } };

  snap.pending.splice(idx, 1);

  // 还有待确认的，继续暂停
  if (snap.pending.length) return persistAndPause(snap);

  // 全部处理完：按序追加，然后继续循环
  for (const o of snap.resolved) {
    snap.history.push({
      role: "tool",
      tool_call_id: o.toolCallId,
      content: JSON.stringify(o.result),
    });
  }
  clearSnapshot(sessionId);
  return continueLoop(snap, signal);
}
```

### 硬性要求

- `actionId` **幂等**：重复确认只执行一次
- 过期快照：恢复时返回 `expired` 并结束该轮
- 恢复必须走**同一条**代码路径继续循环，不能另写一套
- 用户如果在暂停期间关闭应用，快照仍在 SQLite 里，下次能恢复

---

## 6. 停止条件与预算

| 条件 | 阈值 | 行为 |
|---|---|---|
| `finish_reason="stop"` | — | 正常结束 |
| 最大轮数 | 20 | 终止并提示 |
| 输出 token 累计 | 每轮 `max_tokens` 内，总上限可配 | 终止 |
| `prompt_tokens + max_tokens` | ≤ 1,048,576 | 装配阶段就保证 |
| 用户取消 | — | Abort，丢弃本轮未提交内容 |
| 重复调用 | 同一工具 + 相同参数连续 2 次 | 终止并提示 |
| 破坏性操作 | 单轮 ≤ N 个 | 拒绝并提示 |

> **重复调用检测**很重要：模型卡在"再搜一次"的循环里，是 agent 最常见的失败模式。

---

## 7. 错误处理

| 类型 | 处理 |
|---|---|
| 429 / 5xx / 网络 | 指数退避重试（最多 2 次） |
| 400 `reasoning_content` 缺失 | **不要重试**——这是 harness bug，记录并报错 |
| 400 参数非法 | 记录请求 hash，终止 |
| 流中断 | 丢弃本轮未提交内容，整轮重试一次 |
| 工具错误 | 作为 `role:"tool"` 结果回填，**不中断循环** |
| 工具连续失败 | 同一工具失败 2 次后，把错误升级到最终回答里 |

**工具错误是输入，不是异常。** 模型需要看到 `not_found` 才能改路径重试。

---

## 8. 取消与部分结果

- 每个请求带 `AbortSignal`
- 取消时：**不提交**部分 assistant 消息；不执行未开始的工具
- 已经执行的只读工具没有副作用，直接丢弃
- 已经执行的写操作不能"取消"，只能靠审计日志与废纸篓兜底

**原则：副作用只能发生在"已确认且已提交"之后，绝不随流式增量发生。**

---

## 9. 上下文增长

- 历史**只追加**
- 单 tool 结果 ≤ 8K chars，单轮总量 ≤ 16K
- 达到阈值（如 200K prompt tokens）时，做一次**清理**：把很旧的 `role:"tool"` 内容替换成 `[已清理]`
- 清理会改写历史 → 从改写点起缓存失效 → **罕见、可接受**
- 不做每轮摘要；DeepSeek 有 1M 上下文，够撑很久

---

## 10. 接口

```ts
interface RunTurnInput {
  sessionId: string;
  userText: string;
  signal: AbortSignal;
}

type RunTurnResult =
  | { status: "done"; text: string; usage: Usage; traceId: string }
  | { status: "awaiting_confirmation"; pending: PendingAction[]; usage: Usage }
  | { status: "cancelled" }
  | { status: "error"; code: string; message: string };

interface Provider {
  streamChat(params: ChatParams, signal: AbortSignal): AsyncIterable<Chunk>;
}
```

---

## 11. 与其它模块的契约

| 模块 | 契约 |
|---|---|
| **Assembler** | 每回合调用一次；Runtime 之后只追加，不再装配 |
| **Tool Layer** | 提供 `planTools()`、`executeSafely()`；pending 由 Runtime 转成暂停态 |
| **Policy** | 在 `planTools()` 阶段判定权限；Runtime 不自行放行 |
| **Session & State** | 提供 `persistSnapshot()` / `loadSnapshot()` / `clearSnapshot()` |
| **Observability** | 每个状态转换写 trace；记录 usage、工具耗时、轮数 |

---

## 12. 验收标准

- [ ] 并行 `tool_calls` 按 `index` 聚合，结果按原顺序回填
- [ ] 思考模式开启时，`reasoning_content` 原样带回，无 400
- [ ] 流中断不会留下半条 assistant 消息
- [ ] 暂停后重开应用，仍能恢复并继续该轮
- [ ] 重复确认同一 `actionId` 不重复执行
- [ ] 取消后历史里没有未完成的工具调用
- [ ] 同一工具同参数连续 2 次即终止
- [ ] `prompt_tokens + max_tokens` 永不超 1,048,576

---

## 13. 练习

1. **造一个三工具并行响应**（两个读、一个删），走完"执行读 → 暂停 → 确认 → 按序回填"。
2. **在流式中间取消**，检查历史里没有半条消息。
3. **开启思考模式跑一次工具调用**，然后故意删掉 `reasoning_content`，复现 400——这是最值钱的一课。
4. **让模型连续两次调用同一个 `search_files`**，确认循环检测触发。

---

## 14. 下一步

**07 Policy & Guardrail**：Runtime 已经在调用它，现在把它写实——路径白名单、敏感文件、确认状态机、不可信内容边界、审计日志。
