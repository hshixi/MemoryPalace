# 02 · Memory 深化

> 用人话说：这一层负责记住**你这个人**——你怎么称呼东西、你的偏好、上次找过什么——而不是记住你的文件。文件由 RAG 管。

> 所属层：CONTEXT　｜　依赖：Session　｜　被依赖：Context Assembler
> 目标：用很小的常驻成本，让助手"越用越像认识你"。
>
> **实现状态（2026-11-22，M6）**：已落地显式写入、确认、去重合并、50 条上限、context 30 天过期、会话快照注入、Dashboard 列表与删除。**未落地**：从对话自动提炼候选、置信度过滤、人工编辑 / 手动新增 / 合并操作、`<control type="memory">` 增量注入（当前靠工具结果留在历史里）。

---

## 0. 两种记忆，别混

| | 热（会话记忆） | 冷（语料记忆） |
|---|---|---|
| 记什么 | 用户偏好、称呼、历史意图 | 文件内容 |
| 谁产生 | 对话 + 用户确认 | 索引器自动 |
| 放哪 | `system`（会话快照） | 检索后进用户轮 |
| 规模 | 几十条 | 上万文件 |
| 本文档 | ✅ | ❌（见 RAG 文档） |

**热记忆是经过策展的；冷语料是未经策展的。** 同一套"文件 + 索引"机制，区别只在谁被提升进常驻区。

---

## 1. 记忆的类型

| kind | 例子 | 来源 |
|---|---|---|
| `preference` | "我喜欢按时间而不是目录看文件" | 用户明说 / 提炼 |
| `alias` | "『月报』= 季度财报" | 用户明说 |
| `context` | "上周在找投资相关的 PDF" | 会话提炼 |
| `correction` | "刚才那个不是我要的，是 Q2 那份" | 用户纠正 |

不同类型用途不同：

- `alias` 直接提升检索命中率
- `preference` 改变回答风格与工具选择
- `correction` 可用于修正检索排序
- `context` 主要是"接着上次"的线索

---

## 2. 写入策略

MVP 只做**显式写入**，避免"助手擅自记住奇怪的东西"。

### 允许

1. 用户说"记住……" → 直接写，回显确认
2. 对话结束后，离线任务提炼候选 → **用户确认**后写入
3. 用户在 Dashboard 手动新增/编辑

### 禁止

- 每轮自动写入
- 从文件内容里提炼"关于用户"的记忆（文件是不可信输入）
- 未经确认覆盖已有记忆

### 候选提炼

离线任务（独立请求，不进主循环）：

```text
输入：最近一轮对话
输出：JSON 数组
[{ "kind": "alias", "fact": "月报 = 季度财报", "confidence": 0.9 }]
```

只保留 `confidence ≥ 0.8` 的，其余丢弃。候选进入"待确认"列表。

---

## 3. 注入方式

### 会话开始

把热记忆快照拼进 `system` 的 L3：

```markdown
## 关于用户
- [alias] 「月报」指代季度财报。
- [preference] 偏好用文件名而不是日期描述文件。
- [context] 上次在找投资相关的 PDF。
```

### 会话中新增

不改写 `system`，改用用户轮里的 `<control>` 块：

```markdown
<control type="memory" action="add">
- [alias] 「周会」指代每周一 10 点的会议记录。
</control>
```

这样前缀缓存不失效。

---

## 4. 规模控制

- 热记忆上限 **50 条**
- 超出时按"最近使用 + 置信度"淘汰，转入冷存储
- 每条 ≤ 100 字
- 同义/重复的合并

### 去重

写入前做两步：

1. 归一化（去空格、统一标点）
2. 与现有条目做关键词相似度比对；相似度 > 0.85 视为重复，提示合并而不是新增

---

## 5. 衰减与删除

- `context` 类默认 30 天后降权，不再注入
- `correction` 影响检索排序，保留 90 天
- 用户可在 Dashboard 一键删除
- 删除是硬删除（记忆不是文件，不需要废纸篓），但写审计

---

## 6. 数据表

```sql
memory(
  id TEXT PRIMARY KEY,
  fact TEXT NOT NULL,
  kind TEXT NOT NULL,
  confidence REAL,
  source_session TEXT,
  hit_count INTEGER DEFAULT 0,
  last_used_at INTEGER,
  created_at INTEGER,
  updated_at INTEGER
);
```

`hit_count` / `last_used_at` 用于淘汰与排序。

---

## 7. 用户管理

Dashboard 的"助手记忆"区：

- 列表：类型、内容、使用次数（当前已接）
- 操作：删除（当前已接）；编辑、合并（设计保留，未实现）
- 新增：聊天里说「记住……」（当前已接）；手动添加（设计保留，未实现）
- 待确认：离线提炼的候选（P2，未实现）

原则：**用户永远能看见并纠正助手记住了什么。**

---

## 8. 接口

```ts
interface MemoryStore {
  list(filter?: { kind?: MemoryKind }): MemoryEntry[];
  add(entry: Omit<MemoryEntry, "id">): MemoryEntry;
  update(id: string, patch: Partial<MemoryEntry>): MemoryEntry;
  remove(id: string): void;
  merge(ids: string[]): MemoryEntry;

  snapshotForPrompt(limit?: number): MemoryEntry[];   // 会话开始时
  pendingCandidates(): MemoryCandidate[];
}
```

---

## 9. 与其它模块的契约

| 模块 | 契约 |
|---|---|
| **Assembler** | 会话开始读 `snapshotForPrompt()`；增量走 `<control type="memory">` |
| **Session** | 记忆变更写审计 |
| **Observability** | 记录哪些记忆被注入、是否影响命中 |
| **Policy** | 记忆写入属于 `write`，需确认（显式"记住"除外） |

---

## 10. 验收标准

- [x] 热记忆 ≤ 50 条，超出按规则淘汰
- [x] 会话中新记忆不改写 `system`，不影响缓存
- [x] 相似条目提示合并，不重复新增
- [x] 用户能查看、删除每一条（编辑 / 合并 UI 暂缓）
- [x] 不从文件内容提炼用户记忆（system 明令 + 只接受显式「记住」）
- [x] 删除写审计

---

## 11. 练习

1. 说一句"记住：月报就是季度财报"，确认它出现在下一次会话的 system 里。
2. 再说一次同样的话，确认触发合并而不是新增。
3. 在 Dashboard 删除这条记忆，确认下一次会话不再注入。

---

## 12. 下一步

**03 Skills**：把"怎么干某件事"的说明书按需加载，而不是常驻上下文。
