import { useState } from "react";
import type { ReactNode } from "react";
import {
  deleteMemory,
  getMemories,
  type BackendMemory,
} from "../api";
import {
  auditEvents as mockAuditEvents,
  evalFails,
  evalMetrics,
  evalTrend,
  memories as seedMemories,
} from "../data";
import type {
  AuditEvent,
  LastRunSummary,
  MemoryKind,
  WorkspaceSummary,
} from "../types";
import {
  IconActivity,
  IconAlert,
  IconBrain,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconFlask,
  IconPlus,
  IconRefresh,
  IconShield,
  IconTrash,
} from "./Icons";

const MEMORY_KIND: Record<MemoryKind, string> = {
  alias: "称呼",
  preference: "偏好",
  context: "上下文",
  correction: "纠正",
};

interface AccItemProps {
  id: string;
  icon: ReactNode;
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

function AccItem({
  id,
  icon,
  title,
  summary,
  open,
  onToggle,
  children,
}: AccItemProps) {
  return (
    <div className={`acc-item${open ? " open" : ""}`}>
      <button
        type="button"
        className="acc-trigger"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`acc-${id}`}
      >
        <span className="acc-icon">{icon}</span>
        <span className="acc-title">{title}</span>
        <span className="acc-summary">{summary}</span>
        <IconChevronDown size={16} className="acc-chevron" />
      </button>
      <div className="acc-body" id={`acc-${id}`}>
        <div className="acc-body-inner">
          <div className="acc-content">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 132;
  const h = 38;
  const pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [x, y] as const;
  });
  const line = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`)
    .join(" ");
  const area = `${line} L${pts[pts.length - 1][0]},${h} L${pts[0][0]},${h} Z`;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="spark"
      aria-hidden="true"
    >
      <path d={area} className="spark-area" />
      <path d={line} className="spark-line" />
      <circle
        cx={pts[pts.length - 1][0]}
        cy={pts[pts.length - 1][1]}
        r="3"
        className="spark-dot"
      />
    </svg>
  );
}

interface AccordionsProps {
  onToast: (title: string, detail?: string) => void;
  live?: boolean;
  audit?: AuditEvent[];
  workspace?: WorkspaceSummary;
  lastRun?: LastRunSummary | null;
}

export default function Accordions({
  onToast,
  live = false,
  audit = mockAuditEvents,
  workspace,
  lastRun = null,
}: AccordionsProps) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [memories, setMemories] = useState(seedMemories);
  const [liveMemories, setLiveMemories] = useState<BackendMemory[] | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [evalRan, setEvalRan] = useState(false);
  const [running, setRunning] = useState(false);

  const blocked = audit.filter((event) => event.tone === "critical").length;
  const success = live
    ? lastRun
      ? lastRun.errorCount === 0
        ? "100%"
        : `${lastRun.filesIndexed} 个成功`
      : "—"
    : "100%";
  const lastIndexed = workspace?.lastIndexedLabel ?? "2 小时前";

  const refreshMemories = () => {
    if (!live) return;
    setMemoryLoading(true);
    getMemories()
      .then((list) => setLiveMemories(list))
      .catch((error: Error) => onToast("读取记忆失败", error.message))
      .finally(() => setMemoryLoading(false));
  };

  const toggle = (id: string) => {
    const willOpen = !open.has(id);
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (id === "memory" && willOpen && live) refreshMemories();
  };

  const removeMemory = (id: string) => {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    onToast("记忆已删除", "助手不会再使用这条信息");
  };

  const removeLiveMemory = (id: string) => {
    deleteMemory(id)
      .then(() => {
        setLiveMemories((prev) => prev?.filter((m) => m.id !== id) ?? null);
        onToast("记忆已删除", "助手不会再使用这条信息");
      })
      .catch((error: Error) => onToast("删除失败", error.message));
  };

  const runEval = () => {
    if (running) return;
    setRunning(true);
    window.setTimeout(() => {
      setRunning(false);
      setEvalRan(true);
      onToast("评估完成", "recall@5 从 0.86 升到 0.87");
    }, 1300);
  };

  return (
    <div className="accordion-stack">
      <AccItem
        id="memory"
        icon={<IconBrain size={16} />}
        title="助手记忆"
        summary={
          live
            ? liveMemories === null
              ? "点开查看 · 会话开始时注入"
              : `${liveMemories.length} 条 · 会话开始时注入`
            : `${memories.length} 条 · 「月报」= 季度经营分析报告`
        }
        open={open.has("memory")}
        onToggle={() => toggle("memory")}
      >
        <div className="memory-head">
          <span className="muted-small">
            {live
              ? "只有你对助手说「记住……」并确认过的信息，才会留在这里。"
              : "只有你明确说过、或确认过的信息，才会留在这里。"}
          </span>
          {live ? (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={refreshMemories}
              disabled={memoryLoading}
            >
              <IconRefresh size={12} />
              {memoryLoading ? "读取中…" : "刷新"}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => onToast("演示版", "真实版本里可在这里手动新增记忆")}
            >
              <IconPlus size={12} />
              新增
            </button>
          )}
        </div>
        <div className="memory-list">
          {live
            ? (liveMemories ?? []).map((m) => (
                <div className="memory-row" key={m.id}>
                  <span className={`memory-kind ${m.kind}`}>
                    <span className="kind-dot" />
                    {MEMORY_KIND[m.kind]}
                  </span>
                  <span className="memory-text">{m.fact}</span>
                  <span className="memory-meta">用过 {m.hitCount} 次</span>
                  <button
                    type="button"
                    className="row-icon-btn"
                    aria-label={`删除记忆：${m.fact}`}
                    onClick={() => removeLiveMemory(m.id)}
                  >
                    <IconTrash size={13} />
                  </button>
                </div>
              ))
            : memories.map((m) => (
                <div className="memory-row" key={m.id}>
                  <span className={`memory-kind ${m.kind}`}>
                    <span className="kind-dot" />
                    {MEMORY_KIND[m.kind]}
                  </span>
                  <span className="memory-text">{m.text}</span>
                  <span className="memory-meta">
                    {m.source} · 用过 {m.uses} 次
                  </span>
                  <button
                    type="button"
                    className="row-icon-btn"
                    aria-label={`删除记忆：${m.text}`}
                    onClick={() => removeMemory(m.id)}
                  >
                    <IconTrash size={13} />
                  </button>
                </div>
              ))}
          {live && liveMemories === null && (
            <div className="empty-line">
              {memoryLoading ? "正在读取…" : "还没有读取，点「刷新」试试。"}
            </div>
          )}
          {live && liveMemories !== null && liveMemories.length === 0 && (
            <div className="empty-line">
              还没有记忆。对助手说「记住……」即可添加。
            </div>
          )}
          {!live && memories.length === 0 && (
            <div className="empty-line">
              还没有记忆。对助手说「记住……」即可添加。
            </div>
          )}
        </div>
      </AccItem>

      <AccItem
        id="health"
        icon={<IconActivity size={16} />}
        title="健康与审计"
        summary={`索引 ${success} · ${live ? blocked : 1} 次已拦截 · 0 个待确认`}
        open={open.has("health")}
        onToggle={() => toggle("health")}
      >
        <div className="health-stats">
          <div className="health-stat">
            <span className="health-label">索引成功率</span>
            <b>{success}</b>
          </div>
          <div className="health-stat">
            <span className="health-label">越界读取</span>
            <b>{live ? blocked : 1} 次已拦截</b>
          </div>
          <div className="health-stat">
            <span className="health-label">待确认动作</span>
            <b>0</b>
          </div>
          <div className="health-stat">
            <span className="health-label">最近索引</span>
            <b>{lastIndexed}</b>
          </div>
        </div>
        <div className="audit-list">
          {audit.length === 0 && (
            <div className="empty-line">还没有工具调用记录。</div>
          )}
          {audit.map((a) => (
            <div className="audit-row" key={a.id}>
              <span className={`audit-dot ${a.tone}`}>
                {a.tone === "critical" ? (
                  <IconShield size={11} />
                ) : a.tone === "warn" ? (
                  <IconClock size={11} />
                ) : (
                  <IconCheck size={11} />
                )}
              </span>
              <span className="audit-action">{a.action}</span>
              <span className="audit-detail">{a.detail}</span>
              <span className="audit-time">{a.time}</span>
            </div>
          ))}
        </div>
        <div className="panel-foot">
          所有危险动作都会写进审计日志；删除只进废纸篓，不直接抹掉。
        </div>
      </AccItem>

      <AccItem
        id="eval"
        icon={<IconFlask size={16} />}
        title="实验区 · 检索评估"
        summary={
          live
            ? "未接入 · 计划 P2"
            : `recall@5 ${evalRan ? "0.87" : "0.86"} · 最近 6 次`
        }
        open={open.has("eval")}
        onToggle={() => toggle("eval")}
      >
        {live ? (
          <div className="empty-line">
            检索评估计划在 P2 和向量检索一起接入。现在这里没有真实指标可展示。
          </div>
        ) : (
          <>
        <div className="eval-top">
          <div className="eval-metrics">
            {evalMetrics.map((m) => {
              const value =
                m.label === "recall@5" && evalRan ? "0.87" : m.value;
              const up = !m.delta.startsWith("−");
              return (
                <div className="eval-metric" key={m.label}>
                  <span className="eval-label">{m.label}</span>
                  <span className="eval-value">{value}</span>
                  <span className={`eval-delta ${up ? "up" : "down"}`}>
                    {m.delta}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="eval-spark">
            <span className="muted-small">最近 6 次</span>
            <Sparkline values={evalTrend} />
          </div>
        </div>

        <div className="eval-fails">
          <div className="eval-fails-title">
            <IconAlert size={12} />
            失败样本
          </div>
          {evalFails.map((f) => (
            <div className="fail-row" key={f.id}>
              <code>{f.id}</code>
              <span>期望 {f.expected}</span>
              <span className="fail-got">得到 {f.got}</span>
            </div>
          ))}
        </div>

        <div className="eval-actions">
          <button
            type="button"
            className="btn btn-soft btn-xs"
            onClick={runEval}
            disabled={running}
          >
            {running ? (
              <>
                <span className="spinner" />
                运行中…
              </>
            ) : (
              <>
                <IconRefresh size={12} />
                运行评估
              </>
            )}
          </button>
          <span className="muted-small">
            默认折叠，避免干扰。真实版本里这里还有趋势、失败样本与成本曲线。
          </span>
        </div>
          </>
        )}
      </AccItem>
    </div>
  );
}
