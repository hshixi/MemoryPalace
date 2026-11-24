# 05 · Tool Layer 深化

> 所属层：ACTION　｜　依赖：Policy、Provider Adapter　｜　被依赖：Agent Runtime
> 运行环境：DeepSeek V4 Flash，OpenAI 兼容函数调用
> 目标：把"模型想做的动作"翻译成**可校验、可拦截、可并行、可审计**的执行单元。

---

## 0. 职责边界

Tool Layer **不做**决定"该不该调用"——那是模型的事。
它负责：

1. 向模型暴露**准确的工具定义**
2. 校验模型给的参数
3. 按权限分类分发
4. 执行并压缩结果
5. 把失败变成**模型能读懂的**工具结果
6. 维护 `tool_call_id` 的对应关系

Runtime 负责循环，Policy 负责放行，Tool Layer 负责"把动作安全地做完"。

---

## 1. 工具定义格式（OpenAI 兼容）

```ts
{
  type: "function",
  function: {
    name: "search_files",
    description: "…何时用 / 何时不用…",
    parameters: {
      type: "object",
      properties: { … },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,          // DeepSeek 可用；但仍要自己校验
  },
}
```

四条硬规则：

1. **`description` 写"何时用 / 何时不用"**，不只写参数含义。模型选错工具，九成是描述没写清。
2. **`additionalProperties: false` + 全部必填字段进 `required`**。
3. **工具列表在会话内固定、按 `name` 排序**——增删或乱序会让前缀缓存失效。
4. **参数里不出现绝对路径**；路径一律相对工作区。

> `strict: true` 在 DeepSeek V4 上报告可用，但**不要信任它**：返回值仍用 schema 校验一遍，尤其 `arguments` 是 JSON 字符串，先 `JSON.parse` 再校验。

---

## 2. P0 工具清单（只读）

| 工具 | 权限 | 可并行 | 作用 |
|---|---|---|---|
| `search_files` | read | ✅ | 在索引里检索文件名/路径/时间，只回元数据 |
| `read_file` | read | ✅ | 读单个文本文件，支持行范围 |
| `list_folder` | read | ✅ | 列出目录项 |
| `get_file_info` | read | ✅ | 单文件元数据 |
| `reveal_in_finder` | read | ❌ | 让用户在 Finder 中定位；UI 副作用 |
| `load_skill` | meta | ✅ | 按需加载技能正文 |

P1 再开放：`save_memory`（write）、`move_file`（write）、`delete_file`（delete）。

P2 阶段 1A/1B 新增 `search_content`（read，✅ 可并行）：在正文块里搜关键词，返回 `path / loc / locKind / snippet`（文本按行、PDF 按页、DOCX 按段）。它和 `search_files` 的分工是**找文件 vs 找内容**——工具描述和 system 都要把这条写清楚，否则模型会拿正文检索去找文件名，或反过来拿元数据检索回答「哪份文件提过 X」。返回的片段是不可信数据，标 `untrusted: true`。

阶段 2 把 `search_content` 升级为混合检索：默认关键词 + 本地向量，RRF 融合，结果多一个 `via`（`keyword` / `vector` / `both`）。关键词一旦有命中就只返回关键词/双命中，纯语义候选只在关键词零命中时兜底——本地模型的语义噪声太大。工具描述要提醒模型：`via=vector` 是语义相近，**引用前先核对片段**；语义检索不可用时会退回纯关键词，`via` 全是 `keyword`，不需要特别说明。

**意图路由也是 Tool Layer 的边界。** 实测发现：如果不写规则，模型会对「为什么死记硬背不能举一反三」直接开聊，对「情况一多就爆炸了」用 `list_folder` 扫全库猜意图。现在 system 里明确三种处理：文件问题先检索；明确闲聊先确认是否直接聊；模糊短句先做一次 `search_content(probe=true)`，无命中再问。`list_folder` 的描述也收紧为「只在用户明确要求浏览目录时使用」。这类规则不能只靠工具描述，system 里必须写清「什么时候不要调用工具」。

**探测结果要从渲染层藏掉。** 光在 system 里写「探测结果不要展示」不够：第一版探测走的是默认混合检索，语义相似度会捞回 3 条八竿子打不着的片段，前端照常渲染成正文卡片，用户看到的就是「它说没关系，却给我推了 3 个文件」。修法是让探测在工具层就自我约束：`probe=true` 只走字面关键词、最多 3 条、结果带 `probe: true` 标记，前端看到标记就不进正文卡片和右侧引用栏。工具层负责「产出可判定的标记」，渲染层负责「尊重这个标记」，两边都不能省。

**能力升级后，要回头改 system 里的旧事实。** 写操作走查时，模型在成功写入后补了一句「索引是手动重建的，这个新文件大概要重建索引后才能被检索到」——但 `write_file` 的 `apply()` 早就会 `reindexPath`，确认卡上也写着「索引已同步更新」。旧 system 描述的是 M0 的事实，M5 加写操作时没同步改，结果模型对用户说了错话。改成「工具改动的文件会立刻更新索引；用户在 Finder/其他程序里改过的才可能需要重建」。这类错误的特征是**代码对了、提示词过时**，走查时只盯代码和测试发现不了。

**正常路径不该穿错误的外衣。** 用户在确认卡上点「取消」，工具结果 `ok:false, code:"rejected"`，前端原来按 `ok:false` 一律显示红色「失败：用户取消了这个操作……」，还把给模型看的「不要声称已经执行」漏给了用户。现在 `rejected` 单独处理：chip 保持中性、文案「已取消 · 没有改动任何文件」。**同一个 `ok:false` 里混着「真失败」和「按设计没执行」，渲染层必须区分。**

**卡片展示要以模型的回答为准，而不是工具的原始返回。** 探针只解决了「模糊短句」，但明确问内容时同样会踩坑：「哪份文件里提到过宇宙大爆炸」关键词零命中，语义兜底返回 5 条量子论文参考文献，模型判断「没有找到」，前端却照样渲染 5 张「语义」卡片。根因是渲染层把「检索到了」当成「确认相关」。修正后的分工是：检索结果只是候选，回答才是相关性判定——前端只展示回答里真正引用到的命中（文件名、去扩展名的文件名、完整路径，或片段里的一小段原文），回答为空或没引用就一张都不显示；工具的 model note 也同步告诉模型「没引用的命中不会展示，别用『上面这些』指代」。这类问题的通用修法：**不要让 UI 直接消费工具的原始输出，先让它消费一个包含模型判断的产物。**

### 定义示例

```json
{
  "type": "function",
  "function": {
    "name": "search_files",
    "description": "在工作区索引中按关键词或自然语言描述查找文件。返回按相关度排序的候选片段，不含完整文件内容。用户问『哪里有…』『找一下…』『上次那个…』时优先使用；已知确切路径时改用 read_file。",
    "parameters": {
      "type": "object",
      "properties": {
        "query": { "type": "string", "description": "检索词或自然语言描述" },
        "k": { "type": "integer", "minimum": 1, "maximum": 20, "default": 8 },
        "type": { "type": "string", "enum": ["document", "image", "any"], "default": "any" }
      },
      "required": ["query"],
      "additionalProperties": false
    },
    "strict": true
  }
}
```

```json
{
  "type": "function",
  "function": {
    "name": "read_file",
    "description": "读取工作区内单个文本文件的指定范围。文件过大时只返回截断内容并标注。不要用它遍历大量文件；先 search_files 缩小范围。",
    "parameters": {
      "type": "object",
      "properties": {
        "path": { "type": "string", "description": "相对工作区根目录的路径" },
        "start": { "type": "integer", "description": "起始行号（1-based，可选）" },
        "end": { "type": "integer", "description": "结束行号（含，可选）" }
      },
      "required": ["path"],
      "additionalProperties": false
    },
    "strict": true
  }
}
```

---

## 3. 参数校验

每次调用都过四道关：

```ts
function validate(name: string, rawArgs: string) {
  const args = JSON.parse(rawArgs);                 // 1. 解析
  const schema = SCHEMAS[name];
  const parsed = schema.parse(args);                // 2. schema 校验
  if ("path" in parsed) {
    parsed.path = normalizeRelative(parsed.path);   // 3. 路径规范化
    assertInsideWorkspace(parsed.path);             // 4. 越界检查
  }
  return parsed;
}
```

- `JSON.parse` 失败 → `invalid_arguments`
- schema 不匹配 → 指出具体字段
- 路径含 `..`、绝对路径、符号链接逃逸 → `path_escape`
- 未知工具名 → `unknown_tool`

---

## 4. 分发与执行

```ts
interface Tool {
  name: string;
  permission: "read" | "write" | "delete" | "meta";
  parallelSafe: boolean;
  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

const registry = new Map<string, Tool>();
```

执行规则：

- **只读工具**：并行执行，设单工具超时（如 10s）
- **写/删工具**：串行，且先走确认（见第 8 节）
- **`reveal_in_finder`**：串行，因为它是 UI 副作用
- **结果顺序**：即使并发执行，回填时**按原 `tool_calls` 顺序**

---

## 5. 结果格式与压缩

每个工具结果对应一条消息：

```ts
history.push({
  role: "tool",
  tool_call_id: call.id,
  content: JSON.stringify(result),
});
```

### 统一结果形状

```ts
type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: ToolError }
  | { ok: false; pending: { actionId: string; preview: Preview } };
```

### 压缩规则

- 单个结果 **≤ 8K 字符**，单轮总量 **≤ 16K 字符**
- 超限时截断，并置 `truncated: true`，附 `notice`
- `search_files` 只回片段，不回整篇
- 二进制、超大文件不读原文，只回元数据
- 文件内容必须带 `untrusted: true`

```json
{
  "ok": true,
  "path": "docs/report.md",
  "untrusted": true,
  "content": "……",
  "truncated": false
}
```

> 工具结果里**永远不要**直接放原始文件字节或 base64；需要时走单独的附件通道（P2）。

---

## 6. 错误分类

错误不是异常——**它也是模型可以读懂的输入**。绝不吞掉。

| code | 含义 | 模型应该怎么做 |
|---|---|---|
| `invalid_arguments` | 参数解析/schema 失败 | 修正参数重试 |
| `unknown_tool` | 工具名不存在 | 换一个工具 |
| `not_found` | 路径/文件不存在 | 先 list/search |
| `permission_denied` | 敏感文件或越界路径 | 告知用户，不要绕过 |
| `path_escape` | `..` / 符号链接逃逸 | 停止，报告 |
| `too_large` | 超过读取上限 | 用行范围重试 |
| `unsupported_type` | 非文本/不支持解析 | 改为元数据 |
| `parse_failed` | 文档解析失败 | 告知用户 |
| `io_error` | 磁盘/权限错误 | 报告，可重试一次 |
| `needs_confirmation` | 等待用户确认 | 等待，不要重复调用 |
| `rejected_by_user` | 用户拒绝 | 停止该动作，说明 |
| `rate_limited` | 破坏性操作超限 | 停止并提示 |

---

## 7. 并行工具调用

DeepSeek 会**交错**下发并行调用，必须按 `tc.index` 聚合（Runtime 的流式解析负责），Tool Layer 负责执行与回填：

```ts
const calls = msg.tool_calls;                       // 已按 index 聚合
const results = await Promise.all(
  calls.map(call => runOne(call))                   // 只读并行；写/删串行
);

for (let i = 0; i < calls.length; i++) {
  history.push({
    role: "tool",
    tool_call_id: calls[i].id,                      // 必须一一对应
    content: JSON.stringify(results[i]),
  });
}
```

- 一个调用失败**不影响**其他调用
- `tool_call_id` 错配会导致下一轮 400
- 不要把多个结果合并成一条 `role:"tool"` 消息

---

## 8. 写/删工具与确认

写/删工具**不直接执行**，而是返回 `pending`：

```ts
// delete_file 的 execute
return {
  ok: false,
  pending: {
    actionId: "act_01H...",
    preview: {
      action: "delete",
      path: "finance/2026-Q3-report.pdf",
      sizeBytes: 248_120,
      reversible: true,        // 进废纸篓
      warning: null,
    },
  },
};
```

流程：

```
模型调用 delete_file
  → Tool Layer 校验通过、权限为 delete
  → 返回 pending（不执行）
  → Runtime 暂停，前端弹确认卡
  → 用户确认 → 后端按 actionId 执行 → 生成最终 ToolResult
  → 用户拒绝 → { ok:false, error:{ code:"rejected_by_user" } }
  → 两种情况都把结果回填给模型
```

约束：

- `actionId` 幂等，重复确认不重复执行
- pending 有过期时间（如 10 分钟）
- 破坏性操作限速：单轮 ≤ N 个、单次调用只处理一个文件
- 删除永远进废纸篓，不 `unlink`

---

## 9. 与其它模块的契约

| 模块 | 契约 |
|---|---|
| **Runtime** | 传入解析后的 `tool_calls`；Tool Layer 返回按序的 `ToolResult[]`；`pending` 由 Runtime 转成暂停态 |
| **Policy** | 提供敏感清单、路径白名单、脱敏规则；Tool Layer 在返回前调用 |
| **Retrieval** | `search_files` 背后的实现；Tool Layer 只负责格式化 |
| **Observability** | 每次调用记 `name / args / duration / ok / error.code` |

---

## 10. 验收标准

- [ ] 工具列表在会话内逐字节不变（排序 + hash 测试）
- [ ] 非法 JSON、缺字段、多余字段都被拦下，返回结构化错误
- [ ] `../`、绝对路径、符号链接逃逸全部返回 `path_escape`
- [ ] 单个结果 ≤ 8K chars；超限有 `truncated` 标记
- [ ] 并行调用的结果按原顺序回填，`tool_call_id` 一一对应
- [ ] 写/删工具只返回 `pending`，未确认前不产生副作用
- [ ] 文件内容结果带 `untrusted: true`

---

## 11. 练习

1. **加一个只读工具** `get_file_info`，跑通 schema → 分发 → 结果压缩整条链路。
2. **故意传 `../../etc/passwd`**，确认被 `path_escape` 拦下，且错误信息能被模型读懂。
3. **一次调用 5 个 `search_files`**，验证并行执行 + 结果顺序 + `tool_call_id` 对应。
4. **把 `read_file` 的上限调到 500 字符**，观察模型是否会改用行范围重试。

---

## 12. 下一步

**04 Agent Runtime**：把 Assembler 产出的请求、Tool Layer 的执行结果、确认暂停态串成一个可恢复的循环。
