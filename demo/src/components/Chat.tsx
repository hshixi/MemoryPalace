import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  confirmAction,
  contentHitsFromToolData,
  filesFromToolData,
  filterCitedContentHits,
  getOverview,
  hitsFromSearchData,
  LIVE,
  revealFile,
  streamChat,
  toFileItem,
  type BackendConfirmRequired,
  type BackendToolResult,
} from "../api";
import { getScenario } from "../chatData";
import { folderOf, recentQueries, WORKSPACE } from "../data";
import type {
  ChatMessage,
  ChatSeed,
  ConfirmSpec,
  ContentHitItem,
  FileItem,
  MetadataHit,
  RailState,
  ToolChip,
  Usage,
} from "../types";
import { ConfirmCard, ContentHitCard, FileCard } from "./ChatParts";
import {
  IconActivity,
  IconAlert,
  IconCheck,
  IconFolder,
  IconPaperclip,
  IconPlus,
  IconSearch,
  IconSend,
  IconShield,
  IconSparkle,
  IconTrash,
} from "./Icons";
import { LogoMark } from "./ui";

interface ChatProps {
  seed: ChatSeed | null;
  onToast: (title: string, detail?: string) => void;
}

interface HomeInfo {
  fileCount: number;
  indexed: string;
  status: "empty" | "indexing" | "ready";
  recent: Array<{ id: string; query: string }>;
  error?: string;
}

function msOf(detail: string) {
  const m = detail.match(/(\d+)\s*ms/);
  return m ? Number(m[1]) : 0;
}

/** 后端的 confirm_required 事件 → 聊天里的确认卡。 */
function confirmFromEvent(event: BackendConfirmRequired): ConfirmSpec {
  const kind =
    event.tool === "delete_file"
      ? "delete"
      : event.tool === "move_file"
        ? "move"
        : event.tool === "save_memory"
          ? "memory"
          : "write";
  const rows = Array.isArray(event.rows) ? event.rows : [];
  return {
    kind,
    title: event.title,
    description: event.summary,
    rows,
    total: rows.length > 0 ? rows.length : 1,
    status: "pending",
    actionId: event.actionId,
    toolCallId: event.toolCallId,
    diff: event.diff,
  };
}

/** 执行失败里哪些算「用户没让做」，其余算执行失败。 */
function settledStatus(result: BackendToolResult): ConfirmSpec["status"] {
  if (result.ok) return "done";
  const code = result.error?.code;
  return code === "rejected" || code === "confirm_timeout"
    ? "cancelled"
    : "failed";
}

function shortValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 46 ? `${value.slice(0, 46)}…` : value;
  }
  const text = JSON.stringify(value);
  return text.length > 46 ? `${text.slice(0, 46)}…` : text;
}

function formatToolArgs(args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  return Object.entries(args as Record<string, unknown>)
    .map(([key, value]) => `${key}=${shortValue(value)}`)
    .join(" · ");
}

function toolDetail(result: BackendToolResult): string {
  const suffix = result.durationMs > 0 ? ` · ${result.durationMs} ms` : "";
  if (result.ok) return `${result.summary}${suffix}`;
  // 用户在确认卡上点取消是正常路径，不该显示成红色「失败」。
  if (result.error?.code === "rejected") return "已取消 · 没有改动任何文件";
  return `失败：${result.error?.message ?? result.summary}${suffix}`;
}

function mergeFiles(current: FileItem[], incoming: FileItem[]): FileItem[] {
  const seen = new Set(current.map((file) => file.path));
  return [...current, ...incoming.filter((file) => !seen.has(file.path))];
}

function mergeHits(current: MetadataHit[], incoming: MetadataHit[]): MetadataHit[] {
  const seen = new Set(current.map((hit) => hit.path));
  return [...current, ...incoming.filter((hit) => !seen.has(hit.path))];
}

/** 正文命中只需要路径就能打开所在文件夹；元信息由卡片自己展示。 */
function pathToFileItem(path: string): FileItem {
  return {
    id: path,
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    kind: "md",
    size: "",
    modified: "",
  };
}

function mergeContentHits(
  current: ContentHitItem[],
  incoming: ContentHitItem[],
): ContentHitItem[] {
  const seen = new Set(current.map((hit) => hit.id));
  return [...current, ...incoming.filter((hit) => !seen.has(hit.id))];
}

const MATCH_LABEL: Record<string, string> = {
  filename: "文件名",
  path: "路径",
  time: "时间",
  type: "类型",
};

const ZERO_USAGE: Usage = { prompt: 0, cached: 0, completion: 0, cost: 0 };

function Welcome({
  onSend,
  home,
}: {
  onSend: (text: string) => void;
  home: HomeInfo | null;
}) {
  const prompts = LIVE
    ? [
        {
          query: "上周那份讲营收的文件",
          title: "上周那份讲营收的文件",
          hint: "文件名 + 时间",
          icon: <IconSearch size={16} />,
          danger: false,
        },
        {
          query: "RAG 相关的笔记在哪",
          title: "RAG 相关的笔记",
          hint: "按主题回忆",
          icon: <IconFolder size={16} />,
          danger: false,
        },
        {
          query: "01-财务 里最近改过什么",
          title: "01-财务 最近改过什么",
          hint: "按目录浏览",
          icon: <IconSparkle size={16} />,
          danger: false,
        },
      ]
    : [
        {
          query: "上周那份讲营收的 PDF",
          title: "上周那份讲营收的 PDF",
          hint: "模糊时间 + 内容",
          icon: <IconSearch size={16} />,
          danger: false,
        },
        {
          query: "帮我整理工作区里的设计截图",
          title: "帮我整理设计截图",
          hint: "先给预览，再动手",
          icon: <IconFolder size={16} />,
          danger: false,
        },
        {
          query: "删掉重复的旧合同",
          title: "删掉重复的旧合同",
          hint: "一定先问你",
          icon: <IconTrash size={16} />,
          danger: true,
        },
      ];

  const files = LIVE ? (home?.fileCount ?? 0) : WORKSPACE.files;
  const indexed = LIVE ? (home?.indexed ?? "读取中…") : WORKSPACE.indexed;
  const recent = LIVE ? (home?.recent ?? []) : recentQueries.slice(0, 3);

  return (
    <div className="welcome">
      <span className="welcome-kicker">
        <IconSparkle size={12} />
        MEMORY PALACE
      </span>
      <h2>不用记得文件在哪。</h2>
      <p>
        {LIVE && home?.error
          ? `后端还没连上：${home.error}`
          : `问一句就行。工作区已经索引了 ${files.toLocaleString()} 个文件，最后索引于 ${indexed}。`}
      </p>

      <div className="welcome-cards">
        {prompts.map((prompt) => (
          <button
            type="button"
            className="welcome-card"
            key={prompt.query}
            onClick={() => onSend(prompt.query)}
          >
            <span className={`welcome-icon${prompt.danger ? " danger" : ""}`}>
              {prompt.icon}
            </span>
            <b>{prompt.title}</b>
            <span>{prompt.hint}</span>
          </button>
        ))}
      </div>

      {recent.length > 0 && (
        <div className="welcome-recent">
          <span className="muted-small">或者接着上次：</span>
          {recent.slice(0, 3).map((q) => (
            <button
              type="button"
              className="mini-chip"
              key={q.id}
              onClick={() => onSend(q.query)}
            >
              {q.query}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Chat({ seed, onToast }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [rail, setRail] = useState<RailState | null>(null);
  const [thinking, setThinking] = useState(false);
  const [home, setHome] = useState<HomeInfo | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const timers = useRef<number[]>([]);
  const busyRef = useRef(false);
  const idRef = useRef(0);
  const lastSeed = useRef(0);
  const sessionRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const nextId = () => {
    idRef.current += 1;
    return `m${idRef.current}`;
  };

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const schedule = (fn: () => void, ms: number) => {
    const t = window.setTimeout(fn, ms);
    timers.current.push(t);
    return t;
  };

  const appendMessage = (msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  };

  const patchMessage = (id: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );
  };

  const streamText = (id: string, full: string, done: () => void) => {
    let i = 0;
    const step = () => {
      i = Math.min(full.length, i + 2);
      patchMessage(id, { text: full.slice(0, i), streaming: i < full.length });
      if (i >= full.length) {
        done();
        return;
      }
      schedule(step, 16);
    };
    schedule(step, 50);
  };

  const sendLive = (text: string) => {
    const controller = new AbortController();
    abortRef.current = controller;
    busyRef.current = true;
    setBusy(true);
    setInput("");
    clearTimers();

    appendMessage({ id: nextId(), role: "user", text });
    const assistantId = nextId();
    appendMessage({
      id: assistantId,
      role: "assistant",
      text: "",
      streaming: true,
      tools: [],
    });
    setRail(null);

    let answer = "";
    let files: FileItem[] = [];
    let hits: MetadataHit[] = [];
    let contentHits: ContentHitItem[] = [];
    let tools: ToolChip[] = [];
    let usage: Usage = ZERO_USAGE;
    let confirmSpec: ConfirmSpec | undefined;

    const paint = () => {
      patchMessage(assistantId, {
        text: answer,
        tools: [...tools],
        files: [...files],
        contentHits: filterCitedContentHits(answer, contentHits),
        streaming: true,
      });
    };
    const paintRail = () => {
      setRail({
        hits,
        contentHits: filterCitedContentHits(answer, contentHits),
        tools: tools.map((tool) => ({
          name: tool.name,
          detail: tool.detail ?? (tool.status === "running" ? "执行中" : ""),
          ms: msOf(tool.detail ?? ""),
        })),
        usage,
        pending: false,
      });
    };
    const finish = () => {
      if (abortRef.current === controller) abortRef.current = null;
      busyRef.current = false;
      setBusy(false);
    };

    void streamChat(
      text,
      sessionRef.current,
      {
        onSession: (sessionId) => {
          sessionRef.current = sessionId;
        },
        onUsage: (next) => {
          usage = next;
          paintRail();
        },
        onToolStart: (call) => {
          tools = [
            ...tools,
            {
              id: call.toolCallId,
              name: call.name,
              args: formatToolArgs(call.args),
              status: "running",
            },
          ];
          paint();
          paintRail();
        },
        onToolResult: (result) => {
          tools = tools.map((tool) =>
            tool.id === result.toolCallId
              ? {
                  ...tool,
                  status: result.ok
                    ? ("done" as const)
                    : result.error?.code === "rejected"
                      ? ("done" as const)
                      : ("error" as const),
                  detail: toolDetail(result),
                }
              : tool,
          );
          if (result.ok && result.name === "search_files") {
            const incoming = filesFromToolData(result.data).map(toFileItem);
            files = mergeFiles(files, incoming);
            hits = mergeHits(hits, hitsFromSearchData(result.data));
          }
          const probeResult =
            result.data !== null &&
            typeof result.data === "object" &&
            (result.data as { probe?: boolean }).probe === true;
          if (result.ok && result.name === "search_content" && !probeResult) {
            contentHits = mergeContentHits(contentHits, contentHitsFromToolData(result.data));
          }
          if (confirmSpec && result.toolCallId === confirmSpec.toolCallId) {
            confirmSpec = { ...confirmSpec, status: settledStatus(result) };
            patchMessage(assistantId, { confirm: confirmSpec });
          }
          paint();
          paintRail();
        },
        onConfirmRequired: (request) => {
          confirmSpec = confirmFromEvent(request);
          patchMessage(assistantId, { confirm: confirmSpec });
        },
        onTextDelta: (delta) => {
          answer += delta;
          paint();
        },
        onDone: (done) => {
          usage = done.usage;
          paintMessageFinal(
            assistantId,
            answer,
            files,
            filterCitedContentHits(answer, contentHits),
            tools,
          );
          paintRail();
          finish();
        },
      },
      controller.signal,
    ).catch((error: unknown) => {
      if (controller.signal.aborted) {
        patchMessage(assistantId, {
          text: answer || "已停止。",
          streaming: false,
        });
        finish();
        return;
      }
      const message =
        error instanceof ApiError
          ? error.message
          : "连接不上后端，检查 127.0.0.1:4311 是否在运行。";
      patchMessage(assistantId, {
        text: answer ? `${answer}\n\n（没有完成：${message}）` : `这次没有完成：${message}`,
        streaming: false,
      });
      onToast("对话失败", message);
      finish();
    });
  };

  const paintMessageFinal = (
    id: string,
    text: string,
    files: FileItem[],
    contentHits: ContentHitItem[],
    tools: ToolChip[],
  ) => {
    patchMessage(id, {
      text: text || "已完成。",
      streaming: false,
      files,
      contentHits,
      tools,
    });
  };

  const sendScripted = (raw: string) => {
    const text = raw.trim();
    if (!text || busyRef.current) return;

    const scenario = getScenario(text);
    busyRef.current = true;
    setBusy(true);
    setInput("");
    clearTimers();

    appendMessage({ id: nextId(), role: "user", text });
    const assistantId = nextId();

    schedule(() => {
      appendMessage({
        id: assistantId,
        role: "assistant",
        text: "",
        streaming: true,
        tools: scenario.tools.map((t) => ({
          ...t,
          status: "running" as const,
        })),
      });
    }, 320);

    schedule(() => {
      patchMessage(assistantId, {
        tools: scenario.tools.map((t) => ({
          ...t,
          status: "done" as const,
        })),
      });
      setRail({
        chunks: scenario.chunks,
        tools: scenario.tools.map((t) => ({
          name: t.name,
          detail: t.detail,
          ms: msOf(t.detail),
        })),
        usage: scenario.usage,
        pending: Boolean(scenario.confirm),
      });

      streamText(assistantId, scenario.text, () => {
        patchMessage(assistantId, {
          files: scenario.files,
          confirm: scenario.confirm
            ? { ...scenario.confirm, status: "pending" as const }
            : undefined,
        });
        busyRef.current = false;
        setBusy(false);
      });
    }, 880);
  };

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || busyRef.current) return;
    if (LIVE) sendLive(text);
    else sendScripted(text);
  };

  /** 异步确认落地时只改还在执行中的卡，避免盖掉已经到达的 tool_result。 */
  const settleConfirm = (
    msgId: string,
    from: ConfirmSpec["status"],
    status: ConfirmSpec["status"],
  ) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.confirm?.status === from
          ? { ...m, confirm: { ...m.confirm, status } }
          : m,
      ),
    );
  };

  const handleConfirm = (msgId: string) => {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg?.confirm) return;
    const spec = msg.confirm;
    if (spec.status !== "pending" && spec.status !== "armed") return;

    if (spec.kind === "delete" && spec.status === "pending") {
      patchMessage(msgId, {
        confirm: { ...spec, status: "armed" as const },
      });
      return;
    }

    if (spec.actionId) {
      patchMessage(msgId, {
        confirm: { ...spec, status: "running" as const },
      });
      void confirmAction(spec.actionId, "allow").catch((error: unknown) => {
        const message =
          error instanceof ApiError ? error.message : "确认请求没有发出去";
        settleConfirm(msgId, "running", "failed");
        onToast("确认没有送达", message);
      });
      return;
    }

    patchMessage(msgId, {
      confirm: { ...spec, status: "done" as const },
    });
    setRail((r) => (r ? { ...r, pending: false } : r));

    if (spec.kind === "delete") {
      onToast(`已移入废纸篓 ${spec.total} 个文件`, "可在废纸篓里手动恢复");
    } else {
      onToast(`已移动 ${spec.total} 个文件`, "目标：08-素材/截图");
    }
  };

  const handleCancel = (msgId: string) => {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg?.confirm) return;
    const spec = msg.confirm;
    if (spec.status !== "pending" && spec.status !== "armed") return;

    if (spec.actionId) {
      patchMessage(msgId, {
        confirm: { ...spec, status: "running" as const },
      });
      void confirmAction(spec.actionId, "deny")
        .then(() => {
          settleConfirm(msgId, "running", "cancelled");
          onToast("已取消", "没有改动任何文件");
        })
        .catch((error: unknown) => {
          const message =
            error instanceof ApiError ? error.message : "取消请求没有发出去";
          // 取消没送达时把卡片放回可操作状态，让用户还能再点一次。
          settleConfirm(msgId, "running", spec.status);
          onToast("取消失败", message);
        });
      return;
    }

    patchMessage(msgId, {
      confirm: { ...spec, status: "cancelled" as const },
    });
    setRail((r) => (r ? { ...r, pending: false } : r));
    onToast("已取消", "没有改动任何文件");
  };

  const handleUndo = (msgId: string) => {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg?.confirm) return;
    onToast(
      "演示版",
      msg.confirm.kind === "delete"
        ? "真实版本里可从废纸篓恢复"
        : "真实版本里可撤销这次移动",
    );
  };

  const openFile = (file: FileItem) => {
    if (!LIVE) {
      onToast("已打开所在文件夹", folderOf(file.path));
      return;
    }
    void revealFile(file.path)
      .then(() => onToast("已打开所在文件夹", folderOf(file.path)))
      .catch((error: unknown) => {
        const message =
          error instanceof ApiError ? error.message : "没能打开 Finder";
        onToast("打开失败", message);
      });
  };

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    clearTimers();
    busyRef.current = false;
    setBusy(false);
    setMessages([]);
    setRail(null);
    setInput("");
    sessionRef.current = null;
    lastSeed.current = 0;
  };

  const toggleThinking = () => {
    setThinking((v) => !v);
    onToast(
      thinking ? "已关闭思考模式" : "已开启思考模式",
      "演示版不会真的改模型参数",
    );
  };

  useEffect(() => {
    if (!LIVE) return;
    const controller = new AbortController();
    getOverview(controller.signal)
      .then((overview) => {
        setHome({
          fileCount: overview.workspace.fileCount,
          indexed: overview.workspace.lastIndexedLabel,
          status: overview.workspace.status,
          recent: overview.recentQueries
            .slice(0, 3)
            .map((query) => ({ id: query.id, query: query.query })),
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setHome({
          fileCount: 0,
          indexed: "未连接",
          status: "empty",
          recent: [],
          error:
            error instanceof ApiError
              ? error.message
              : "无法连接后端，请确认 MP_PORT 对应的服务在运行。",
        });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    if (!seed || seed.id === lastSeed.current) return;
    lastSeed.current = seed.id;
    send(seed.query);
  }, [seed]);

  return (
    <div className="chat-layout">
      <section className="chat-main">
        <div className="chat-topbar">
          <h1>对话</h1>
          <span className="topbar-sub">会话 · 本地</span>
          <div className="chat-top-actions">
            <span className="model-chip">deepseek-v4-flash</span>
            {LIVE ? (
              <span className="think-toggle">P1 · 可写</span>
            ) : (
              <button
                type="button"
                className={`think-toggle${thinking ? " on" : ""}`}
                onClick={toggleThinking}
                title="演示开关：真实版本里按任务复杂度决定"
              >
                <IconSparkle size={12} />
                思考 {thinking ? "开" : "关"}
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              onClick={reset}
              aria-label="新对话"
              title="新对话"
            >
              <IconPlus size={15} />
            </button>
          </div>
        </div>

        <div className="chat-scroll" ref={scrollRef}>
          <div className="chat-inner">
            {messages.length === 0 ? (
              <Welcome onSend={send} home={home} />
            ) : (
              messages.map((m) =>
                m.role === "user" ? (
                  <div className="msg user" key={m.id}>
                    <div className="msg-body">{m.text}</div>
                  </div>
                ) : (
                  <div className="msg assistant" key={m.id}>
                    <span className="msg-avatar">
                      <LogoMark size={24} />
                    </span>
                    <div className="msg-body">
                      {m.tools && (
                        <div className="tool-stack">
                          {m.tools.map((t, i) => (
                            <div
                              className={`tool-chip${t.status === "error" ? " error" : ""}`}
                              key={`${t.name}-${i}`}
                            >
                              <span className="tool-status">
                                {t.status === "running" ? (
                                  <span className="spinner" />
                                ) : t.status === "error" ? (
                                  <IconAlert size={12} />
                                ) : (
                                  <IconCheck size={12} />
                                )}
                              </span>
                              <span className="tool-name">{t.name}</span>
                              <span className="tool-args">{t.args}</span>
                              {t.detail && (
                                <span className="tool-detail">{t.detail}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {m.text ? (
                        <div className="msg-text">
                          {m.text}
                          {m.streaming && <span className="caret" />}
                        </div>
                      ) : (
                        m.streaming && (
                          <div className="thinking-line" aria-label="正在生成">
                            <span />
                            <span />
                            <span />
                          </div>
                        )
                      )}

                      {m.files && m.files.length > 0 && (
                        <div className="file-cards">
                          {m.files.map((f) => (
                            <FileCard key={f.id} file={f} onOpen={openFile} />
                          ))}
                        </div>
                      )}

                      {m.contentHits && m.contentHits.length > 0 && (
                        <div className="content-hits">
                          {m.contentHits.map((hit) => (
                            <ContentHitCard
                              key={hit.id}
                              hit={hit}
                              onOpen={(hitPath) => openFile(pathToFileItem(hitPath))}
                            />
                          ))}
                        </div>
                      )}

                      {m.confirm && (
                        <ConfirmCard
                          spec={m.confirm}
                          onCancel={() => handleCancel(m.id)}
                          onPrimary={() => handleConfirm(m.id)}
                          onUndo={() => handleUndo(m.id)}
                        />
                      )}
                    </div>
                  </div>
                ),
              )
            )}
          </div>
        </div>

        <div className="composer-wrap">
          {messages.length > 0 && !busy && (
            <div className="quick-row">
              {LIVE ? (
                <>
                  <button
                    type="button"
                    className="quick-chip"
                    onClick={() => send("最近改过什么文件")}
                  >
                    最近改过什么
                  </button>
                  <button
                    type="button"
                    className="quick-chip"
                    onClick={() => send("上个月的营收文件")}
                  >
                    上个月营收
                  </button>
                  <button
                    type="button"
                    className="quick-chip"
                    onClick={() => send("01-财务 里有哪些文件")}
                  >
                    看 01-财务
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="quick-chip"
                    onClick={() => send("再找几张设计截图")}
                  >
                    再找设计截图
                  </button>
                  <button
                    type="button"
                    className="quick-chip"
                    onClick={() => send("帮我整理一下截图")}
                  >
                    整理截图
                  </button>
                  <button
                    type="button"
                    className="quick-chip"
                    onClick={() => send("删掉重复的旧合同")}
                  >
                    删除重复合同
                  </button>
                </>
              )}
            </div>
          )}

          <div className="composer">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="问一句：上次那份……"
              rows={1}
              aria-label="输入消息"
            />
            <div className="composer-bottom">
              <button
                type="button"
                className="composer-icon"
                aria-label="添加线索（演示版）"
                onClick={() =>
                  onToast("演示版", "真实版本里可附加文件作为线索")
                }
              >
                <IconPaperclip size={15} />
              </button>
              <span className="composer-mode">
                deepseek-v4-flash · {LIVE ? "P1 可写" : `思考${thinking ? "开" : "关"}`}
              </span>
              <span className="composer-hint">
                Enter 发送 · Shift+Enter 换行
              </span>
              <button
                type="button"
                className="send-btn"
                disabled={!input.trim() || busy}
                onClick={() => send(input)}
                aria-label="发送"
              >
                <IconSend size={15} />
              </button>
            </div>
          </div>
        </div>
      </section>

      <aside className="chat-rail" aria-label="本轮运行信息">
        {rail ? (
          <>
            {(rail.contentHits?.length ?? 0) > 0 && (
              <div className="rail-card">
                <div className="rail-title">
                  <IconSearch size={12} /> 正文命中
                </div>
                <div className="chunk-list">
                  {rail.contentHits?.map((hit) => (
                    <div className="chunk" key={hit.id}>
                      <div className="chunk-top">
                        <span className="chunk-file">{hit.name}</span>
                        <span className="chunk-score">{hit.score.toFixed(2)}</span>
                      </div>
                      <div className="chunk-section">
                        {hit.path} · 第 {hit.startLine}
                        {hit.endLine !== hit.startLine ? `–${hit.endLine}` : ""}{" "}
                        {hit.locKind === "page" ? "页" : hit.locKind === "paragraph" ? "段" : "行"}
                      </div>
                      <div className="chunk-match">{hit.snippet}</div>
                      <div className="score-track">
                        <span
                          className="score-fill"
                          style={{
                            width: `${Math.min(100, Math.max(0, hit.score * 100))}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rail-card">
              <div className="rail-title">
                <IconSearch size={12} /> {LIVE ? "元数据命中" : "本轮检索"}
              </div>
              {(rail.hits?.length ?? 0) > 0 ? (
                <div className="chunk-list">
                  {rail.hits?.map((hit) => (
                    <div className="chunk" key={hit.id}>
                      <div className="chunk-top">
                        <span className="chunk-file">{hit.name}</span>
                        <span className="chunk-score">
                          {hit.score > 0 ? hit.score.toFixed(2) : "—"}
                        </span>
                      </div>
                      <div className="chunk-section">{hit.path}</div>
                      <div className="chunk-match">
                        {(hit.match.length > 0
                          ? hit.match.map((key) => MATCH_LABEL[key] ?? key)
                          : ["索引命中"]
                        ).join(" · ")}
                      </div>
                      <div className="score-track">
                        <span
                          className="score-fill"
                          style={{
                            width: `${Math.min(100, Math.max(0, hit.score * 100))}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (rail.chunks?.length ?? 0) > 0 ? (
                <div className="chunk-list">
                  {rail.chunks?.map((c) => (
                    <div className="chunk" key={`${c.file}-${c.section}`}>
                      <div className="chunk-top">
                        <span className="chunk-file">{c.file}</span>
                        <span className="chunk-score">
                          {c.score.toFixed(2)}
                        </span>
                      </div>
                      <div className="chunk-section">{c.section}</div>
                      <div className="score-track">
                        <span
                          className="score-fill"
                          style={{ width: `${c.score * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rail-empty">
                  {!LIVE
                    ? "本轮以工具结果为主，没有使用语料检索。"
                    : (rail.contentHits?.length ?? 0) > 0
                      ? "本轮没有元数据命中，正文命中见上。"
                      : "本轮没有命中索引。目前按文件名、路径、类型、时间和文本正文检索。"}
                </div>
              )}
            </div>

            <div className="rail-card">
              <div className="rail-title">
                <IconActivity size={12} /> 工具调用
              </div>
              <div className="rail-tools">
                {rail.tools.map((t, i) => (
                  <div className="rail-tool" key={`${t.name}-${i}`}>
                    <span className="rail-tool-icon">
                      <IconCheck size={11} />
                    </span>
                    <div className="rail-tool-main">
                      <code>{t.name}</code>
                      <span>{t.detail}</span>
                    </div>
                    <span className="rail-tool-ms">
                      {t.ms ? `${t.ms} ms` : ""}
                    </span>
                  </div>
                ))}
              </div>
              {rail.pending && (
                <div className="rail-pending">
                  <IconAlert size={12} /> 1 个动作等待确认
                </div>
              )}
            </div>

            <div className="rail-card">
              <div className="rail-title">
                <IconSparkle size={12} /> 用量
              </div>
              <div className="usage-head">
                <span>缓存命中</span>
                <b>
                  {Math.round((rail.usage.cached / rail.usage.prompt) * 100)}%
                </b>
              </div>
              <div className="usage-meter">
                <span
                  style={{
                    width: `${(rail.usage.cached / rail.usage.prompt) * 100}%`,
                  }}
                />
              </div>
              <div className="usage-row">
                <span>输入</span>
                <span>{rail.usage.prompt.toLocaleString()}</span>
              </div>
              <div className="usage-row">
                <span>命中缓存</span>
                <span>{rail.usage.cached.toLocaleString()}</span>
              </div>
              <div className="usage-row">
                <span>输出</span>
                <span>{rail.usage.completion}</span>
              </div>
              <div className="usage-cost">${rail.usage.cost.toFixed(5)}</div>
            </div>

            <div className="rail-policy">
              <IconShield size={13} />
              <span>危险动作会在这里暂停，等你确认。</span>
            </div>
          </>
        ) : (
          <>
            <div className="rail-card">
              <div className="rail-title">
                <IconActivity size={12} /> 运行轨迹
              </div>
              <div className="rail-empty">
                发一条消息后，这里会显示
                {LIVE ? "本轮命中的文件" : "本轮检索到的片段"}
                、调用的工具和成本。
              </div>
              <div className="rail-steps">
                <div>
                  <span>1</span> {LIVE ? "从元数据索引里找文件" : "从索引里找相关片段"}
                </div>
                <div>
                  <span>2</span> 按需调用工具
                </div>
                <div>
                  <span>3</span> 生成回答，危险动作先暂停
                </div>
              </div>
            </div>
            <div className="rail-card rail-guide">
              <div className="rail-title">
                <IconShield size={12} /> 安全边界
              </div>
              <div className="rail-empty">
                文件内容只作为数据进入上下文，不会变成指令。删除只进废纸篓。
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
