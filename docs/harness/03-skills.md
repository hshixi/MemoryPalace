# 03 · Skills 深化

> 用人话说：这一层负责**把"怎么干某件事"的说明书按需递给模型**。平时只放一行目录，真要用时才展开全文。

> 所属层：CONTEXT　｜　依赖：无　｜　被依赖：Context Assembler、Tool Layer
> 目标：在不撑爆上下文的前提下，让模型获得复杂流程的指导。

---

## 0. 为什么需要 Skills

有些任务不是"调一个工具"能完成的，而是一套流程：

- 整理建议：先聚类 → 出方案 → 预览变更 → 等确认
- 批量重命名：先扫描 → 生成命名 → 预览 → 分批执行
- 周复盘：汇总本周变动 → 对比上周 → 输出摘要

把整套流程都写进 system，上下文会越来越重，而且大部分时间用不上。

**Skills = 渐进式披露**：目录常驻，正文按需加载。

---

## 1. 一个 Skill 是什么

```markdown
---
name: organize
description: 把文件按主题归组，生成整理建议
when: 用户说"整理一下""太乱了""帮我归类"时
version: 1
---

# 整理建议

1. 先用 search_files 或索引统计，了解文件分布
2. 按主题聚类，给出 3–5 个建议分组
3. 每组给出：组名、包含文件、建议目标目录
4. **不要直接移动**；先用 move_file 生成确认预览
5. 用户确认后再分批执行，每批最多 5 个
6. 最后汇报：移动了哪些、还剩哪些
```

- 前半部分是 **metadata**（进目录）
- 后半部分是 **正文**（按需加载）
- 正文可以引用工具、约定输出格式、写清禁止事项

---

## 2. 目录如何进入上下文

在 `system` 的 L3，每个 skill 压成**一行**：

```markdown
## 可用技能（相关时调用 load_skill）
- organize：把文件按主题归组，生成整理建议（触发：整理、归类、太乱）
- batch-rename：按统一命名规范批量重命名（触发：重命名、改名、统一命名）
- weekly-review：汇总本周文件变动与检索记录（触发：周报、复盘、这周）
```

**只放 `name + description + when`**，绝不放正文。

---

## 3. 加载路径

```
用户："帮我把这些文件整理一下"
  → 模型看到目录里有 organize
  → 调用 load_skill({ name: "organize" })
  → Tool Layer 读取 skills/organize.md 正文
  → 作为 role:"tool" 结果返回（≤ 8K 字符）
  → 模型按正文流程继续调用其他工具
```

`load_skill` 只是一个普通工具，不动态增删工具列表。

**为什么不动工具列表**：工具定义在请求最前面，增删会让整个前缀缓存失效。skills 只加载文本，安全。

---

## 4. 触发策略

MVP 由**模型自己判断**：目录在上下文里，模型认为相关就调用。

可选增强（不是 MVP）：

- 关键词预筛：命中触发词时，在该轮用户消息里加一句提示
- 分类器：用一个便宜的离线调用判断"该加载哪个 skill"

不要做的：

- 每轮自动加载所有 skill（等于没做渐进披露）
- 用语义相似度强行匹配（容易误触发，且难解释）

---

## 5. 约束

| 项 | 约束 |
|---|---|
| 正文长度 | ≤ 8K 字符 |
| 格式 | 纯 markdown |
| 副作用 | 只能通过工具发生，skill 本身不执行代码 |
| 工具依赖 | 只能调用已注册的工具 |
| 版本 | metadata 里带 `version` |

**改动 skill 目录 = 改 system 前缀 = 缓存失效。** 所以：

- skill 的增删改名放在会话之间做，不要中途改
- 正文修改不影响缓存（正文不在 system 里）

---

## 6. 示例 skills

### `skills/organize.md`

见上文。

### `skills/batch-rename.md`

```markdown
---
name: batch-rename
description: 按统一命名规范批量重命名文件
when: 用户说"统一命名""批量改名"时
version: 1
---

1. 先 list_folder 或 search_files 拿到目标文件
2. 推断命名规范（日期_主题_版本）
3. 生成 old → new 的完整预览
4. 用 rename_file 逐个生成确认，不要一次提交
5. 每批不超过 10 个
6. 汇报成功/失败清单
```

### `skills/weekly-review.md`

```markdown
---
name: weekly-review
description: 汇总本周文件变动与检索记录
when: 用户说"周报""复盘本周""这周都做了什么"时
version: 1
---

1. 读取本周新增/修改文件（索引元数据）
2. 读取本周检索记录（trace）
3. 按主题归组
4. 输出：本周重点、反复查找的内容、建议归档项
5. 不要编造未出现过的文件
```

---

## 7. 与工具、记忆的区别

| | Tool | Skill | Memory |
|---|---|---|---|
| 是什么 | 一个动作 | 一套流程说明 | 关于用户的事实 |
| 谁执行 | 代码 | 模型按说明行动 | 注入上下文 |
| 何时进上下文 | 始终（定义） | 按需（正文） | 会话开始（快照） |
| 例子 | `search_files` | `organize` | "月报 = 季度财报" |

---

## 8. 接口

```ts
interface SkillManifest {
  name: string;
  description: string;
  when: string;
  version: number;
}

interface SkillStore {
  list(): SkillManifest[];              // 进 system 目录
  load(name: string): string | null;    // 正文，≤ 8K
}
```

---

## 9. 与其它模块的契约

| 模块 | 契约 |
|---|---|
| **Assembler** | 读 `list()` 生成 L3 目录 |
| **Tool Layer** | `load_skill` 工具调用 `load()`，结果按普通工具结果处理 |
| **Policy** | skill 正文视为可信配置（不是文件内容），但仍限制长度 |
| **Observability** | 记录 skill 加载次数与后续工具序列 |

---

## 10. 验收标准

- [ ] system 里只有目录，没有正文
- [ ] `load_skill` 返回正文 ≤ 8K 字符
- [ ] 加载 skill 后，后续工具调用符合正文流程
- [ ] 中途增删 skill 会使缓存失效（有文档说明，不在会话中做）
- [ ] skill 无法绕过 Policy 直接产生副作用

---

## 11. 练习

1. 写一个 `organize` skill，观察模型是否在"整理一下"时加载它。
2. 写一个触发条件很模糊的 skill，观察误触发。
3. 把正文改长到 10K，确认被截断并给出提示。

---

## 12. 下一步

**06 Model Adapter**：把 DeepSeek 的请求/响应/流式/错误关进一个盒子，其余模块不感知供应商。
