import { useState } from "react";
import type { ActivityDatum, RecentQuery, TypeDatum } from "../types";
import { IconArrowUpRight, IconLock, IconSearch } from "./Icons";
import { TypeIcon } from "./ui";

const W = 560;
const H = 172;
const PAD = { l: 30, r: 8, t: 22, b: 26 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;

function barPath(x: number, y: number, w: number, h: number, r = 4) {
  const rr = Math.min(r, h);
  return [
    `M${x},${y + h}`,
    `L${x},${y + rr}`,
    `Q${x},${y} ${x + rr},${y}`,
    `L${x + w - rr},${y}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `L${x + w},${y + h}`,
    "Z",
  ].join(" ");
}

/** 把坐标轴上界抬到一个好读的整数，避免出现 187 这种刻度。 */
function niceCeil(value: number): number {
  if (value <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = power / 2;
  return Math.ceil(value / step) * step;
}

function EmptyPanel({ title, sub }: { title: string; sub: string }) {
  return (
    <section className="card panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">{title}</div>
          <div className="panel-sub">{sub}</div>
        </div>
      </div>
      <div className="empty-line">还没有数据。索引完成后会出现在这里。</div>
    </section>
  );
}

export function ActivityPanel({ data }: { data: ActivityDatum[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return <EmptyPanel title="索引活动" sub="过去 8 周 · 新增或修改的文件" />;
  }

  const maxValue = Math.max(...data.map((d) => d.value));
  const MAX_V = niceCeil(maxValue);
  const band = PLOT_W / data.length;
  const barW = Math.min(24, band * 0.46);
  const baseY = PAD.t + PLOT_H;
  const last = data.length - 1;
  const hovered = hover === null ? null : data[hover];
  const tipLeft =
    hover === null ? 0 : ((PAD.l + hover * band + band / 2) / W) * 100;
  const tipTop =
    hover === null
      ? 0
      : ((baseY - (data[hover].value / MAX_V) * PLOT_H) / H) * 100;

  const lastValue = data[last]?.value ?? 0;
  const prevValue = last > 0 ? data[last - 1].value : 0;
  const deltaPct =
    prevValue > 0 ? Math.round(((lastValue - prevValue) / prevValue) * 100) : null;
  // 基数很小时百分比会失真（1 → 12 显示 +1100%），直接说新增几个。
  const deltaLabel =
    prevValue >= 5 && deltaPct !== null
      ? `${deltaPct >= 0 ? "+" : ""}${deltaPct}%`
      : `${lastValue - prevValue >= 0 ? "+" : ""}${lastValue - prevValue}`;
  const deltaUp = lastValue >= prevValue;
  const peak = data.reduce(
    (best, d, index) => (d.value > best.value ? { ...d, index } : best),
    { ...data[0], index: 0 },
  );
  const labelIndices = [...new Set([0, Math.floor(last / 2), last])];

  return (
    <section className="card panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">索引活动</div>
          <div className="panel-sub">过去 8 周 · 新增或修改的文件</div>
        </div>
        <div className="panel-meta">
          较上周{" "}
          <span className={deltaUp ? "delta-up" : "delta-down"}>
            {deltaLabel}
          </span>
        </div>
      </div>

      <div className="chart-wrap" onMouseLeave={() => setHover(null)}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="chart-svg"
          role="img"
          aria-label={`过去 ${data.length} 周每周新增或修改的文件数，最后一周为 ${lastValue}`}
        >
          {[MAX_V / 2, MAX_V].map((tick) => {
            const y = baseY - (tick / MAX_V) * PLOT_H;
            return (
              <g key={tick}>
                <line
                  x1={PAD.l}
                  x2={PAD.l + PLOT_W}
                  y1={y}
                  y2={y}
                  className="grid-line"
                />
                <text
                  x={PAD.l - 7}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="axis-text"
                >
                  {Math.round(tick)}
                </text>
              </g>
            );
          })}
          <line
            x1={PAD.l}
            x2={PAD.l + PLOT_W}
            y1={baseY}
            y2={baseY}
            className="baseline"
          />
          <text
            x={PAD.l - 7}
            y={baseY}
            textAnchor="end"
            dominantBaseline="middle"
            className="axis-text"
          >
            0
          </text>

          {data.map((d, i) => {
            const h = Math.max(1, (d.value / MAX_V) * PLOT_H);
            const x = PAD.l + i * band + (band - barW) / 2;
            const y = baseY - h;
            const isLast = i === last;
            return (
              <g key={`${d.label}-${i}`}>
                <path
                  d={barPath(x, y, barW, h)}
                  className={`bar-mark${isLast ? " emphasis" : ""}${
                    hover !== null && hover !== i ? " faded" : ""
                  }`}
                />
                <rect
                  x={PAD.l + i * band}
                  y={PAD.t}
                  width={band}
                  height={PLOT_H}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${d.label}，${d.value} 个文件`}
                />
                {isLast && (
                  <text
                    x={x + barW / 2}
                    y={y - 7}
                    textAnchor="middle"
                    className="direct-label"
                  >
                    {d.value}
                  </text>
                )}
              </g>
            );
          })}

          {labelIndices.map((i) => (
            <text
              key={`${data[i].label}-${i}`}
              x={PAD.l + i * band + band / 2}
              y={H - 7}
              textAnchor="middle"
              className="axis-text"
            >
              {data[i].label}
            </text>
          ))}
        </svg>

        {hovered && (
          <div
            className="chart-tip"
            style={{ left: `${tipLeft}%`, top: `${tipTop}%` }}
          >
            <span className="chart-tip-label">{hovered.label}</span>
            <span className="chart-tip-value">{hovered.value} 个文件</span>
          </div>
        )}

        <table className="sr-only">
          <caption>过去 8 周新增或修改的文件数</caption>
          <thead>
            <tr>
              <th>周</th>
              <th>文件数</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={`${d.label}-${i}`}>
                <td>{d.label}</td>
                <td>{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel-foot">
        峰值 {peak.label} · {peak.value} 个文件 · 悬停查看每周
      </div>
    </section>
  );
}

export function TypesPanel({
  data,
  fileCount,
}: {
  data: TypeDatum[];
  fileCount: number;
}) {
  if (data.length === 0) {
    return <EmptyPanel title="文件构成" sub="按类型" />;
  }

  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <section className="card panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">文件构成</div>
          <div className="panel-sub">
            按类型 · {fileCount.toLocaleString()} 个文件
          </div>
        </div>
      </div>

      <div className="type-rows">
        {data.map((d) => {
          const pct = fileCount > 0 ? Math.round((d.value / fileCount) * 100) : 0;
          return (
            <div className="type-row" key={d.label}>
              <span className="type-label">
                <TypeIcon label={d.label} />
                {d.label}
              </span>
              <span className="type-track">
                <span
                  className="type-fill"
                  style={{ width: `${(d.value / max) * 100}%` }}
                />
              </span>
              <span className="type-value">{d.value}</span>
              <span className="type-pct">{pct}%</span>
            </div>
          );
        })}
      </div>

      <div className="panel-foot">按扩展名归类，未识别的归入「其他」。</div>
    </section>
  );
}

export function RecentPanel({
  data,
  onAsk,
}: {
  data: RecentQuery[];
  onAsk: (query: string) => void;
}) {
  return (
    <section className="card panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">最近问过</div>
          <div className="panel-sub">点一条，接着问</div>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="empty-line">还没有提问记录。去对话里问一句试试。</div>
      ) : (
        <div className="recent-list">
          {data.map((q) => (
            <button
              type="button"
              className="recent-row"
              key={q.id}
              onClick={() => onAsk(q.query)}
            >
              <span className="recent-icon">
                <IconSearch size={13} />
              </span>
              <span className="recent-main">
                <span className="recent-query">{q.query}</span>
                <span className="recent-meta">
                  {q.results} 个结果 · {q.time}
                </span>
              </span>
              <IconArrowUpRight size={13} className="recent-arrow" />
            </button>
          ))}
        </div>
      )}

      <div className="panel-foot lock-foot">
        <IconLock size={11} />
        对话记录只保存在本地
      </div>
    </section>
  );
}
