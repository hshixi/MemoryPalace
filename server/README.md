# MemoryPalace 后端（M0–M8）

P0 是**元数据索引 + 只读对话循环**，P1 补上需要确认的**写操作**与**长期记忆**，P2 阶段 1 补上**文本 / PDF / DOCX 正文索引**，阶段 2 补上**本地向量 + 关键词混合检索**。

- 索引存文件名、相对路径、类型、大小、修改时间、所在目录；文本、PDF、DOCX 另存脱敏后的正文块（`chunks` + FTS5 trigram），阶段 2 再给块存本地 `bge-base-zh-v1.5` 向量（`chunk_vectors`）。
- 对话可以调用只读工具检索元数据、搜正文、看元数据、列目录、读文本文件、在 Finder 中定位。
- 写入、移动、删除也能做，但模型只能「申请」：后端先发确认卡，用户点允许之后才执行。删除只进系统废纸篓。
- 长期记忆只在用户明确说「记住……」时写入，同样先确认；相似内容合并，会话开始时定格注入。
- 模型只拿到工具返回的数据；文件正文永远走 `tool` 消息，不进入 system/instruction 通道。

## 运行

```bash
cd server
npm install
npm start
```

默认地址：`http://127.0.0.1:4310`。
如果端口被别的程序占用（本机就可能遇到），换一个：

```bash
MP_PORT=4311 npm start
```

不配 API key 时，用假模型把整条 runtime / 工具 / SSE / 落库链路跑通：

```bash
MP_PROVIDER=mock MP_PORT=4311 npm start
```

接真实模型：

```bash
DEEPSEEK_API_KEY=sk-... MP_PROVIDER=deepseek MP_PORT=4311 npm start
```

MVP 只接 `deepseek-v4-flash`。没有 key 时 `/api/chat` 返回 `503 missing_api_key`。

默认工作区是仓库里的 `workspace-sample/`，不会扫描你的桌面。
要指向真实文件夹，必须显式设置：

```bash
MP_WORKSPACE=/Users/you/Documents/你的文件夹 MP_PORT=4311 npm start
```

也可以在 `server/.env` 里写（参考 `.env.example`）。`MP_WORKSPACE` 必须是绝对路径。

## 常用命令

```bash
npm run typecheck   # TypeScript 类型检查
npm test            # node:test，128 个用例（强制 MP_EMBED=0，不下载模型）
npm run eval:rag    # 正文检索 eval：临时库全量重建，对照 keyword / vector / hybrid
npm run eval:rag:paraphrase  # 改写问法集（10 条），量语义检索补关键词盲区
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 服务、模型、工作区、索引状态、是否配了 key |
| GET | `/api/overview` | Dashboard 首屏全部数据：统计、主题、边、8 周活动、类型分布、最近查询、上次索引 |
| GET | `/api/topics` | 只取主题地图与边 |
| GET | `/api/search?q=&k=&type=&modifiedAfter=&modifiedBefore=` | 元数据搜索；`q` 支持简单自然语言时间/类型提示 |
| GET | `/api/files?parent=&kind=&limit=` | 按**直接父目录**列文件，不递归 |
| GET | `/api/browse?path=&offset=&limit=` | 目录下钻：直接子文件夹、直接文件、面包屑、分页总数 |
| GET | `/api/file?path=` | 单文件元数据，`path` 是工作区相对路径 |
| POST | `/api/index/rebuild` | 后台重建索引，返回 `runId` |
| GET | `/api/index/runs/:id` | 查索引进度 |
| POST | `/api/reveal` | 在 Finder 中定位文件，body：`{"path":"..."}` |
| GET | `/api/audit` | 最近审计事件 |
| GET | `/api/skills` | 内置技能清单 |
| GET | `/api/memories` | 长期记忆列表，按最近使用/更新排序 |
| DELETE | `/api/memories/:id` | 删除一条记忆并写审计；不存在返回 404 |
| GET | `/api/sessions` | 会话列表 |
| POST | `/api/sessions` | 新建空会话，body 可带 `title` |
| GET | `/api/sessions/:id/messages` | 会话消息；`tool` 消息只留名字，正文对前端隐藏 |
| GET | `/api/traces` | 最近模型调用 trace、token、成本 |
| POST | `/api/chat` | 一轮对话，SSE 流式返回 |
| POST | `/api/confirm` | 允许或拒绝一个等待确认的写操作，body：`{"actionId":"...","decision":"allow"}` |

### 对话

```bash
curl -N -X POST http://127.0.0.1:4311/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"营收文件在哪"}'
```

事件顺序：

| 事件 | 内容 |
|---|---|
| `session` | `sessionId`，新会话时由后端创建 |
| `usage` | 累计 token 与估算成本，每轮模型调用后更新 |
| `tool_start` / `tool_result` | 工具名、参数、结果卡片、失败信息 |
| `confirm_required` | 写操作准备好了，等前端 POST `/api/confirm`；SSE 保持打开 |
| `text_delta` | 流式文本片段 |
| `done` | `messageId`、`traceId`、总 usage、状态 |
| `error` | 运行时或上游错误，带稳定 `code` |

`POST /api/chat` 可以带 `sessionId` 继续同一会话；会话属于另一个工作区时返回 `409`，同一会话并发请求也返回 `409`。

## 写操作边界

- 写工具：`write_file`（新建/整体覆盖文本，≤200 KB）、`move_file`、`delete_file`。
- 三者都不能直接执行：`tool_start` 之后先 `prepare`，发 `confirm_required`，用户允许才 `apply`。
- 单轮最多 3 次破坏性动作（`MP_MAX_DESTRUCTIVE`）；等待确认默认 120 秒（`MP_CONFIRM_TIMEOUT_MS`）。
- 删除只走 `rename` 移入废纸篓（默认 `~/.Trash`，`MP_TRASH_DIR` 可改），从不用 `rm` / `unlink`；跨磁盘直接报错，不「复制再删」。
- 确认期间文件被改动，`apply` 比对大小与修改时间后报 `stale_target`，不覆盖。
- 写/移/删成功后就地更新索引并重建 FTS；整库重建仍是最终真相。
- `MP_ALLOW_WRITES=0` 时写工具（包括 `save_memory`）不注册，模型连 schema 都看不到。

## 正文索引与检索（RAG 阶段 1A + 1B + 2）

- 文本（md/txt/csv/json/代码等）单文件 ≤ 1 MB；PDF / DOCX 各 ≤ 20 MB；PDF 最多 300 页；单文件 ≤ 200 块、全库 ≤ 10 万块。
- 入库前先 `redactSecrets()`：密钥不会出现在 `chunks`、FTS 或工具结果里；敏感文件仍然完全不进索引。
- 引用单位由 `loc_kind` 决定：文本按行（约 800 字一块，重叠 1 行）、PDF 按页、DOCX 按段。
- PDF 用 `pdfjs-dist`，DOCX 用 `mammoth`，都只抽文本、不保版式；加密/损坏文件记原因后跳过，不阻塞重建。
- 模型用 `search_content` 搜正文，拿到「文件 + 行/页/段 + 片段」；文本文件需要上下文再 `read_file(path, start, end)`，PDF/DOCX 只能引用片段。
- 返回片段标 `untrusted: true`；片段会跑注入扫描，命中时前端提示「文件里有可疑指令」。
- 写 / 移 / 删后就地重抽该文件的块；全量重建仍是最终真相。
- 阶段 2 默认 `hybrid`：关键词 + 语义，RRF 融合（关键词权 1.5）；关键词一旦有命中就不再追加纯语义候选，只有关键词零命中时才用语义兜底，避免本地模型带来的只沾边结果。每条命中带 `via`（`keyword` / `vector` / `both`），语义命中在 UI 有小标记。
- 嵌入模型是本地 ONNX `Xenova/bge-base-zh-v1.5`（768 维、q8、约 103 MB，CPU）：首次需要下载到 `~/.cache/memorypalace-embed`（本机走代理时加 `NODE_USE_ENV_PROXY=1`），之后离线可用；`MP_EMBED_MODEL` 可换 small / large。
- 建向量：重建/写/移后补，单次最多 1 万块；查询时全量载入内存暴力点积，最多 2 万条；余弦 < 0.3 丢弃。
- `MP_EMBED=0` 或模型加载失败时自动退回纯关键词；`MP_EMBED_MODEL` / `MP_EMBED_CACHE` / `MP_EMBED_DTYPE` 可覆盖模型、缓存目录、量化类型。
- eval：`server/eval/rag-queries.json`（原句 20 条）和 `server/eval/rag-paraphrase-queries.json`（改写 10 条）+ `npm run eval:rag [-- --queries <file>]`，默认在临时库重建，不碰开发库。示例工作区原句集：keyword 100%/MRR 1.000、vector 95%/0.867、hybrid 100%/1.000，文件名 5%；改写集：keyword 40%/0.350、vector 100%/0.833、hybrid 100%/0.833，文件名 0%。这是手写小集，关键词权重也是在这上面调的，不代表真实工作区指标。
- 详细设计见 [../docs/backend/RAG.md](../docs/backend/RAG.md)。rerank 和 query 改写留到阶段 3。
- MVP 验收标准与已知限制见 [../docs/backend/CONVERGENCE.md](../docs/backend/CONVERGENCE.md)：范围冻结在 M0–M8，收口后只修验收暴露的问题。

## 长期记忆

- 只在用户明确说「记住……」时调用 `save_memory`；system 明确禁止从文件内容提炼关于用户的记忆，也不主动记。
- `save_memory` 和文件写工具一样走 `prepare` → `confirm_required` → `/api/confirm`；不能绕过确认直接执行。
- 每条 ≤ 100 字；归一化后用字符二元组相似度去重，≥ 0.85 视为同一条，更新原记录而不是新增。
- 最多 50 条；超出先淘汰最久没用的 `context`，且不会淘汰刚写入的那条。
- `context` 类记忆超过 30 天不再注入 system，但不会自动删除。
- 会话创建时把当时的记忆写进 `memory_snapshot_json`，之后本会话的 system 不再变化；会话中途新增的记忆靠工具结果留在历史里，下一次会话才进 system。
- 仪表盘「助手记忆」通过 `GET /api/memories` 读真实列表，删除走 `DELETE /api/memories/:id`。

## 运行时边界

- 对话先做意图路由：明确问文件先检索；明确闲聊先说明「和工作区无关」并确认是否直接聊，确认后同一会话不再反复追问；模糊短句先做一次 `search_content(probe=true)`（只查字面、最多 3 条），探测结果不渲染成卡片，模型只在明显相关时才引用，否则直接问用户。`list_folder` 只在用户明确要求浏览目录时使用，不能拿来猜意图。
- 正文卡片只展示回答里真正引用到的命中：检索是「可能相关」，回答才是「确认相关」。纯语义兜底捞回的不相关片段，如果模型回答「没找到」，前端一张都不显示（回答为空时也不显示）。
- 单轮最多 12 次模型调用（`MP_MAX_TURNS`）。
- 同一个工具 + 同一组参数连续调用两次，判定为原地打转，直接停止。
- 单轮工具结果总长超过 16K 字符后，后续结果压缩成摘要，避免撑爆上下文。
- 模型输出被 `length` 截断时报 `output_truncated`，不把半截答案当完整答案落库。
- 工具结果永远标记为不可信数据；`read_file` 和 `search_content` 的文本都会做密钥脱敏和提示注入扫描。
- 每轮都写 `messages`、`tool_calls`、`traces`、`audit_log`；审计参数先脱敏再落库。

## 安全边界

- 服务只允许绑定回环地址（`127.0.0.1` / `localhost` / `::1`）。
- HTTP 的 `Origin` 必须在白名单里；默认放行本地前端 `5173` / `4173`。
- 所有文件路径先做词法检查，再 `realpath`，拒绝 `..`、绝对路径、符号链接逃逸。
- 符号链接一律不跟随、不索引。
- 敏感文件完全不进索引，也拒绝读取：`.env*`、`*.pem`、`*.key`、`id_rsa`、`*credential*`、`*secret*`、`.ssh/**`、`.aws/**`。
- 敏感文件被拦截时，只返回“敏感文件已拦截”，不回显路径。

## 索引与数据

- SQLite：`server/data/mp.sqlite`（由 `MP_DB` 覆盖）。
- 索引是整体替换：扫描完成后一次性替换旧记录，扫描期间旧索引仍可查。
- 默认索引为空时自动建一次；之后按产品决定**手动重建**。
- 如果同一个数据库被指向另一个工作区，启动时会清空旧索引，避免串数据。
- 演示模式里的 `1,284 个文件` 是假数据；前端设置 `VITE_MP_LIVE=1` 后，`/api/overview` 返回的全部来自真实扫描。

## 当前限制

- `read_file` 只支持文本扩展名；PDF、DOCX 只能通过 `search_content` 引用片段，不能读全文；XLSX、图片只有元数据。
- 只能改文本文件；PDF / DOCX / XLSX / 图片不能写入。
- 删除不提供程序内「恢复」；恢复由用户在废纸篓里手动完成，不承诺 30 天保留。
- 正文索引覆盖文本、PDF、DOCX；XLSX / PPTX / 图片仍只有元数据，扫描件 PDF 没有文本层也抽不到。
- 没有 rerank 或 query 改写；混合检索的排序仍可能不如人工期望，语义命中需要模型核对片段后再引用。
- 语义检索用本地 base 模型（768 维），效果仍弱于大模型 embedding；向量全量在内存里暴力扫，超过 2 万块的部分不参与语义检索。
- 关键词路径依赖 FTS5 trigram + LIKE 兜底，2 字中文和生僻写法仍可能漏。
- 记忆只支持显式写入，不做自动提炼、自动遗忘或向量召回。
- 记忆没有「恢复」；删除即从数据库移除。
- 目录结构没有单独建表，`/api/browse` 从已索引文件的相对路径实时聚合；因此只能看到至少含一个已索引文件的目录。
- `/api/files` 只列直接子文件；需要子文件夹和面包屑时用 `/api/browse`。

## 目录

```
src/
  config.ts          配置与 .env
  index.ts           进程入口
  http/              HTTP 路由、SSE chat 与错误映射
  index/             扫描、索引服务、搜索、主题、总览
  model/             Provider 接口、DeepSeek、Mock
  policy/            敏感文件、路径、脱敏、注入扫描
  runtime/           上下文装配、工具注册、工具循环、SSE writer
  skills/            技能加载
  store/             SQLite schema 与读写
  util/              时间与格式化
skills/              内置技能 Markdown
test/                node:test 用例
```
