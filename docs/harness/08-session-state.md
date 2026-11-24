# 08 · Session & State 深化

> 用人话说：这一层负责**把该记的记下来**——聊到哪了、哪些操作在等确认、关掉应用再打开还能接上。

> 所属层：CONTROL　｜　依赖：无　｜　被依赖：Agent Runtime、Policy、Observability
> 目标：让循环**可恢复、可回放、不重复执行**。

---

## 0. 职责边界

1. 保存会话与消息历史
2. 保存运行时快照（暂停时）
3. 保存待确认操作
4. 保证写操作幂等
5. 提供审计与 trace 的持久化

**不负责**：决定存什么记忆（那是 Memory 模块）。

---

## 1. 数据表

```sql
sessions(
  id TEXT PRIMARY KEY,
  workspace_root TEXT NOT NULL,
  title TEXT,
  status TEXT,              -- active | closed
  created_at INTEGER,
  updated_at INTEGER
);

messages(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn INTEGER,
  role TEXT NOT NULL,       -- system | user | assistant | tool
  content_json TEXT NOT NULL,
  created_at INTEGER
);

tool_calls(
  id TEXT PRIMARY KEY,      -- 对应 tool_calls.id
  session_id TEXT,
  turn INTEGER,
  name TEXT,
  args_json TEXT,
  result_json TEXT,
  ok INTEGER,
  error_code TEXT,
  duration_ms INTEGER,
  created_at INTEGER
);

pending_actions(
  id TEXT PRIMARY KEY,
  session_id TEXT,
  tool_call_id TEXT,
  tool TEXT,
  args_json TEXT,
  preview_json TEXT,
  status TEXT,              -- pending | approved | executing | done | rejected | expired
  created_at INTEGER,
  expires_at INTEGER,
  resolved_at INTEGER
);

runtime_snapshots(
  session_id TEXT PRIMARY KEY,
  history_json TEXT,        -- 完整消息数组
  resolved_json TEXT,       -- 已执行但未追加的读结果
  pending_json TEXT,        -- 待确认动作
  usage_json TEXT,
  turn INTEGER,
  created_at INTEGER,
  expires_at INTEGER
);

audit_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER,
  session_id TEXT,
  turn INTEGER,
  tool TEXT,
  args_json TEXT,
  decision TEXT,
  result TEXT,
  duration_ms INTEGER
);

memory(
  id TEXT PRIMARY KEY,
  fact TEXT NOT NULL,
  kind TEXT,                -- preference | alias | context | correction
  source_session TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

traces(
  id TEXT PRIMARY KEY,
  session_id TEXT,
  turn INTEGER,
  model TEXT,
  prompt_hash TEXT,
  usage_json TEXT,
  latency_ms INTEGER,
  cost_usd REAL,
  created_at INTEGER
);
```

---

## 2. 会话生命周期

```
创建会话
  → 保存 workspace_root
  → 写入首条 system 的 hash（便于发现前缀被改）
  → active

进行中
  → 每条消息追加 message 行
  → 每次工具调用写 tool_calls 行
  → 每次决策写 audit_log 行
  → 每次模型调用写 traces 行

暂停
  → 写 runtime_snapshots + pending_actions

恢复
  → 读 snapshot，校验 expiresAt
  → 读 pending，按 actionId 继续

关闭
  → status = closed
  → 快照保留，直到过期
```

---

## 3. 快照持久化

Runtime 在进入 `AWAITING_CONFIRMATION` 时必须原子地写入：

```ts
function persistSnapshot(s: RuntimeSnapshot) {
  db.transaction(() => {
    db.upsert("runtime_snapshots", {
      session_id: s.sessionId,
      history_json: JSON.stringify(s.history),
      resolved_json: JSON.stringify(s.resolved),
      pending_json: JSON.stringify(s.pending),
      usage_json: JSON.stringify(s.usage),
      turn: s.turn,
      created_at: Date.now(),
      expires_at: s.expiresAt,
    });
    for (const p of s.pending) db.upsert("pending_actions", p);
  });
}
```

**原子性很重要**：快照与 pending 必须一起成功或一起失败，否则恢复时会出现"有动作没快照"或"有快照没动作"。

---

## 4. 幂等

```ts
function resolveAction(id: string, approved: boolean) {
  return db.transaction(() => {
    const a = db.get("pending_actions", id);
    if (!a) throw new NotFound();
    if (a.status === "done") return a.result;      // 已执行，直接返回
    if (a.status === "rejected") return rejected();
    if (a.expires_at < Date.now()) {
      db.update("pending_actions", { id, status: "expired" });
      return expired();
    }

    db.update("pending_actions", { id, status: "executing" });
    const result = execute(a);
    db.update("pending_actions", { id, status: "done", result_json: result });
    return result;
  });
}
```

- 双击确认、网络重试、多标签页同时点击，都只执行一次
- `executing` 状态用于防止并发重复执行（真正的锁靠事务或单写者）

---

## 5. 恢复

应用启动时：

1. 查找未过期的 `runtime_snapshots`
2. 对应 `pending_actions` 中 status = `pending` 的
3. 在界面上提示"有 N 个操作等待确认"
4. 用户处理后，走 `resolveAction` → 继续 Runtime 循环

**恢复必须复用与在线时相同的代码路径**（见 04），不能另写一套"恢复专用"逻辑。

---

## 6. 并发

MVP 假设单用户、单窗口。仍然要做最低限度的防护：

- 每个 `session_id` 一个写锁（进程内 `Map<sessionId, Mutex>`）
- 同一会话同时只允许一个进行中的回合
- 第二个请求返回 `session_busy`
- 多标签页场景交给前端串行化

---

## 7. 数据保留与隐私

| 数据 | 保留 |
|---|---|
| messages / tool_calls | 默认永久，可手动清空会话 |
| runtime_snapshots | 过期即清（定时任务） |
| audit_log | 永久，只追加 |
| traces | 可配置保留期（如 30 天） |
| prompt 原文 | **默认不存**；只存 hash。需要回放时显式开启"存完整请求" |

> 文件内容属于用户隐私。回放所需的完整请求体，只在本地加密存储，且默认关闭。

---

## 8. 接口

```ts
interface SessionStore {
  create(workspaceRoot: string): Session;
  appendMessage(sessionId: string, msg: Message): void;
  loadMessages(sessionId: string): Message[];

  persistSnapshot(s: RuntimeSnapshot): void;
  loadSnapshot(sessionId: string): RuntimeSnapshot | null;
  clearSnapshot(sessionId: string): void;

  resolveAction(id: string, approved: boolean): ActionResult;

  recordToolCall(call: ToolCallRecord): void;
  recordAudit(entry: AuditEntry): void;
  recordTrace(trace: Trace): void;
}
```

---

## 9. 与其它模块的契约

| 模块 | 契约 |
|---|---|
| **Runtime** | 每轮 appendMessage；暂停时 persistSnapshot；恢复时 loadSnapshot |
| **Policy** | pending action 由 Session 落库；`resolveAction` 保证幂等 |
| **Observability** | trace / audit 由 Session 持久化 |
| **Dashboard** | 读取 sessions、audit、traces、快照状态 |

---

## 10. 验收标准

- [ ] 暂停后重启应用，能恢复并继续同一轮
- [ ] 重复调用 `resolveAction` 只执行一次
- [ ] 快照与 pending 写入是原子的
- [ ] 过期动作恢复时返回 `expired`，不执行
- [ ] 同一会话并发回合返回 `session_busy`
- [ ] 默认不保存 prompt 原文
- [ ] 审计只追加，不可修改

---

## 11. 练习

1. 在确认卡出现后直接杀掉进程，重启，确认能恢复。
2. 对同一个 `actionId` 连点两次确认，确认只产生一次副作用。
3. 把系统时间调到快照过期后，确认返回 `expired` 而不是执行。

---

## 12. 下一步

**09 Observability & Eval**：把 trace、成本账本、回放和金标评估补齐。
