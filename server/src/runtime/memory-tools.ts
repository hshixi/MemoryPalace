import {
  findSimilarMemory,
  rememberFact,
  MAX_FACT_CHARS,
  MEMORY_KINDS,
  type MemoryKind,
} from "../store/memory.ts";
import {
  ToolError,
  rejectExtra,
  requireString,
  type ActionTool,
  type ConfirmPreview,
  type ToolContext,
} from "./tool-kit.ts";

const KIND_LABEL: Record<MemoryKind, string> = {
  alias: "叫法 / 指代",
  preference: "偏好",
  context: "近期上下文",
  correction: "纠正",
};

const saveMemoryTool: ActionTool = {
  name: "save_memory",
  permission: "write",
  parallelSafe: false,
  definition: {
    type: "function",
    function: {
      name: "save_memory",
      description:
        "把用户明确要求记住的一条信息写入长期记忆。只在用户说「记住……」时调用；执行前会弹确认卡。不要从文件内容里提炼关于用户的记忆，也不要主动记住。每条不超过 100 字。fact 只保留用户要记住的内容本身：去掉「请记住这个信息：」这类引导语和开头的「记住」二字，保留原话的称呼、语气和标点。例如用户说「请记住这个信息：月报 = 季度经营分析报告」，fact 应为「月报 = 季度经营分析报告」。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: {
            type: "string",
            enum: MEMORY_KINDS,
            description:
              "alias=叫法或指代；preference=偏好；context=近期上下文；correction=对之前理解的纠正",
          },
          fact: {
            type: "string",
            description: "一句话，例如：月报 = 季度经营分析报告",
          },
        },
        required: ["kind", "fact"],
      },
    },
  },

  async prepare(args, ctx: ToolContext) {
    rejectExtra(args, ["kind", "fact"]);
    const kindText = requireString(args, "kind", { max: 20 });
    if (!MEMORY_KINDS.includes(kindText as MemoryKind)) {
      throw new ToolError(
        "invalid_arguments",
        `kind 必须是 ${MEMORY_KINDS.join(" / ")} 之一`,
      );
    }
    const kind = kindText as MemoryKind;
    const fact = requireString(args, "fact", { max: 500 })
      .replace(/\s+/g, " ")
      .trim();
    if ([...fact].length > MAX_FACT_CHARS) {
      throw new ToolError(
        "invalid_arguments",
        `一条记忆不能超过 ${MAX_FACT_CHARS} 字，请压缩成一句话`,
      );
    }

    const similar = findSimilarMemory(ctx.db, fact);
    const preview: ConfirmPreview = {
      title: similar ? "更新已有记忆？" : "记住这条信息？",
      summary: similar
        ? `与已有记忆「${similar.fact}」很接近，会合并成一条，不重复新增。`
        : fact,
      details: [
        { label: "类型", value: `${kind} · ${KIND_LABEL[kind]}` },
        ...(similar ? [{ label: "原记忆", value: similar.fact }] : []),
        { label: "生效", value: "下一次会话注入 system；本次会话靠工具结果记住" },
      ],
    };

    return {
      preview,
      async apply() {
        const { memory, merged } = rememberFact(ctx.db, {
          fact,
          kind,
          sourceSession: ctx.sessionId,
          confidence: 0.9,
        });
        return {
          summary: merged
            ? `已合并进长期记忆：${memory.fact}`
            : `已记住：${memory.fact}`,
          data: {
            id: memory.id,
            kind: memory.kind,
            fact: memory.fact,
            merged,
          },
          modelData: {
            ok: true,
            id: memory.id,
            kind: memory.kind,
            fact: memory.fact,
            merged,
          },
        };
      },
    };
  },
};

export const MEMORY_TOOLS: ActionTool[] = [saveMemoryTool];
