# 06 · Model Adapter 深化

> 用人话说：这一层是**模型插头**。换一个模型，只换插头，其他部分都不用动。

> 所属层：ACTION　｜　依赖：无　｜　被依赖：Agent Runtime、Context Assembler
> 运行环境：MVP 只有 DeepSeek V4 Flash

---

## 0. 为什么需要 Adapter

Harness 的其余模块只应该关心：

- 消息数组长什么样
- 工具怎么调用
- 结果怎么回来

不应该关心：

- 是哪家模型
- 要不要 `cache_control`
- 思考参数叫什么
- 流式事件怎么命名

把这些差异关进 Adapter，换来两个好处：

1. 以后接第二个模型，只写一个 Adapter
2. 调试时能明确知道"这是供应商行为还是我的 bug"

---

## 1. 统一协议

内部统一使用 **OpenAI Chat Completions 形状**，因为它最通用。

```ts
interface ChatRequest {
  model: string;
  messages: Message[];
  tools?: ToolDef[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  maxTokens: number;          // 必须显式设置
  stream: boolean;
  thinking?: "on" | "off";
  signal: AbortSignal;
}

type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; reasoning_content?: string }
  | { role: "tool"; tool_call_id: string; content: string };

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
```

所有模块只说这套话，不出现 `deepseek`、`openai` 字样。

---

## 2. Provider 接口

```ts
interface ModelProvider {
  readonly id: string;
  readonly capabilities: {
    tools: boolean;
    parallelToolCalls: boolean;
    streaming: boolean;
    prefixCache: boolean;
    reasoning: boolean;
    maxContext: number;
    maxOutput: number;
  };

  chat(req: ChatRequest): Promise<ChatResult>;
  stream(req: ChatRequest): AsyncIterable<StreamEvent>;
}

type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_call_delta"; index: number; id?: string; name?: string; argsDelta?: string }
  | { type: "usage"; usage: Usage }
  | { type: "finish"; reason: FinishReason };

interface ChatResult {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: Usage;
}
```

> 注意：Adapter 输出的是**归一化事件**，Runtime 不需要知道 DeepSeek 的 `chunk.choices[0].delta` 长什么样。

---

## 3. DeepSeek Adapter

| 项 | 值 |
|---|---|
| SDK | OpenAI SDK（`openai`） |
| baseURL | `https://api.deepseek.com` |
| 模型 | `deepseek-v4-flash` |
| 上下文 / 输出 | 1,048,576 / 384,000 |
| 函数调用 | 支持；并行调用支持 |
| 思考 | 默认开启；可用 `thinking: {type:"disabled"}` 关闭 |
| 缓存 | 自动前缀缓存，256-token 块 |
| 端点 | **不要用 `/beta`** |

### 请求映射

```ts
const body = {
  model: "deepseek-v4-flash",
  messages: req.messages,
  tools: req.tools,
  tool_choice: req.toolChoice ?? "auto",
  max_tokens: req.maxTokens,
  stream: req.stream,
  ...(req.thinking === "off" ? { thinking: { type: "disabled" } } : {}),
};
```

- `max_tokens` **必须设置**
- 保证 `prompt_tokens + max_tokens ≤ 1,048,576`
- `thinking` 按需显式设置，不要依赖默认值

### 流式归一化

```ts
async function* stream(req) {
  const s = await client.chat.completions.create({ ...body, stream: true });
  for await (const chunk of s) {
    if (chunk.usage) yield { type: "usage", usage: mapUsage(chunk.usage) };
    if (!chunk.choices?.length) continue;

    const d = chunk.choices[0].delta;
    if (d?.content) yield { type: "text_delta", text: d.content };
    if (d?.reasoning_content) yield { type: "reasoning_delta", text: d.reasoning_content };

    for (const tc of d?.tool_calls ?? []) {
      yield {
        type: "tool_call_delta",
        index: tc.index,
        id: tc.id,
        name: tc.function?.name,
        argsDelta: tc.function?.arguments,
      };
    }

    if (chunk.choices[0].finish_reason) {
      yield { type: "finish", reason: mapFinish(chunk.choices[0].finish_reason) };
    }
  }
}
```

Runtime 负责把 `tool_call_delta` **按 index 聚合**。

### usage 映射

```ts
function mapUsage(u) {
  return {
    promptTokens: u.prompt_tokens,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    cacheHitTokens: u.prompt_cache_hit_tokens ?? 0,
    completionTokens: u.completion_tokens,
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}
```

### 错误映射

| DeepSeek / OpenAI 错误 | 归一化 |
|---|---|
| 401 | `auth_error` |
| 400 + 含 `reasoning_content` | `harness_bug_reasoning` |
| 400 + 含 `max_tokens` / context | `context_exceeded` |
| 400 其他 | `invalid_request` |
| 429 | `rate_limited` |
| 5xx | `upstream_error` |
| 网络 | `network_error` |

**`harness_bug_reasoning` 不重试**——这是我们的 bug，不是网络问题。

---

## 4. 思考模式的约束

- 工具路由默认 `thinking: "off"`
- 只有推理密集型任务才开
- 开启后，assistant 带 `tool_calls` 的消息**必须带回 `reasoning_content`**
- 新一轮用户消息时，可以丢弃旧的 `reasoning_content` 以减小请求体积

这条约束由 Adapter 和 Runtime 共同保证：

- Adapter 负责把 `reasoning_content` 原样放进响应
- Runtime 负责在构造 assistant 消息时带上它

---

## 5. 能力标志

```ts
capabilities = {
  tools: true,
  parallelToolCalls: true,
  streaming: true,
  prefixCache: true,
  reasoning: true,
  maxContext: 1_048_576,
  maxOutput: 384_000,
};
```

Harness 只根据这些标志做决策，不写 `if (provider === "deepseek")`。

---

## 6. 接第二个模型

1. 新建 `providers/<name>.ts`，实现 `ModelProvider`
2. 映射请求、响应、流式事件、错误、usage
3. 在 Router 里注册
4. 补能力标志
5. 跑同一套金标集，比较结果

**不要**在主循环里中途换模型——缓存按模型隔离。

---

## 7. 接口

```ts
interface ProviderRouter {
  get(modelId: string): ModelProvider;
  chat(req: ChatRequest): Promise<ChatResult>;
  stream(req: ChatRequest): AsyncIterable<StreamEvent>;
}
```

---

## 8. 验收标准

- [ ] 其余模块代码里不出现供应商名
- [ ] 流式事件归一化后，Runtime 不需要解析 `chunk.choices`
- [ ] 思考关闭时，请求里明确带 `thinking: disabled`
- [ ] 思考开启时，`reasoning_content` 能原样往返
- [ ] `max_tokens` 永远被设置
- [ ] 错误被归一化，`harness_bug_reasoning` 不重试
- [ ] usage 四项映射正确

---

## 9. 练习

1. 把 `thinking` 打开跑一次工具调用，确认 `reasoning_content` 往返成功。
2. 故意把 `max_tokens` 设为超过上下文，确认得到 `context_exceeded` 而不是 500。
3. 用一个假的 provider 实现同一接口，确认 Runtime 无改动也能跑。

---

## 10. 下一步

所有模块文档写完。回到 [README](README.md) 看全局图和 P0 实现顺序。
