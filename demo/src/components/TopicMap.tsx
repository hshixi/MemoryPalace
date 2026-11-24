import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { isUnsortedTopic, toneForCount } from "../data";
import type { Topic } from "../types";
import { IconMaximize, IconZoomIn, IconZoomOut } from "./Icons";

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const BASE: ViewBox = { x: 0, y: 0, w: 1000, h: 520 };
const MIN_W = 360;
const MAX_W = 1200;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function edgePath(a: Topic, b: Topic) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = Math.min(46, len * 0.14);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const cx = mx - (dy / len) * off;
  const cy = my + (dx / len) * off;
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}

interface TopicMapProps {
  topics: Topic[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  query: string;
  emptyText?: string;
}

export default function TopicMap({
  topics,
  selectedId,
  onSelect,
  query,
  emptyText = "还没有可以展示的主题。",
}: TopicMapProps) {
  const [view, setView] = useState<ViewBox>(BASE);
  const [hover, setHover] = useState<{ topic: Topic; x: number; y: number } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; view: ViewBox } | null>(null);
  const movedRef = useRef(false);

  // 窄屏改用 meet，避免左右两侧的主题被裁掉。
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = e.deltaY > 0 ? 1.12 : 0.89;
      setView((v) => {
        const nw = clamp(v.w * factor, MIN_W, MAX_W);
        const nh = nw * (BASE.h / BASE.w);
        const px = v.x + ((e.clientX - rect.left) / rect.width) * v.w;
        const py = v.y + ((e.clientY - rect.top) / rect.height) * v.h;
        const nx = px - (px - v.x) * (nw / v.w);
        const ny = py - (py - v.y) * (nh / v.h);
        return { x: nx, y: ny, w: nw, h: nh };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const edges = useMemo(() => {
    const seen = new Set<string>();
    const out: { a: Topic; b: Topic }[] = [];
    for (const t of topics) {
      for (const rel of t.related) {
        const key = [t.id, rel.topicId].sort().join("|");
        if (seen.has(key)) continue;
        const b = topics.find((x) => x.id === rel.topicId);
        if (!b) continue;
        seen.add(key);
        out.push({ a: t, b });
      }
    }
    return out;
  }, [topics]);

  const focusIds = useMemo(() => {
    if (!selectedId) return null;
    const t = topics.find((x) => x.id === selectedId);
    if (!t) return null;
    return new Set([t.id, ...t.related.map((r) => r.topicId)]);
  }, [selectedId, topics]);

  const maxCount = useMemo(
    () => topics.reduce((max, t) => Math.max(max, t.count), 1),
    [topics],
  );

  const q = query.trim();
  const isDim = (t: Topic) => {
    const bySearch = Boolean(q) && !t.name.includes(q);
    const byFocus = Boolean(focusIds) && !focusIds?.has(t.id);
    return bySearch || byFocus;
  };

  const handleHover = (e: ReactMouseEvent, topic: Topic) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({
      topic,
      x: clamp(e.clientX - rect.left, 100, rect.width - 100),
      y: Math.max(e.clientY - rect.top, 96),
    });
  };

  const zoomBy = (factor: number) => {
    setView((v) => {
      const nw = clamp(v.w * factor, MIN_W, MAX_W);
      const nh = nw * (BASE.h / BASE.w);
      const cx = v.x + v.w / 2;
      const cy = v.y + v.h / 2;
      return { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
    });
  };

  const startDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY, view };
    movedRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const moveDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) {
      movedRef.current = true;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - d.x) * (d.view.w / rect.width);
    const dy = (e.clientY - d.y) * (d.view.h / rect.height);
    setView({ ...d.view, x: d.view.x - dx, y: d.view.y - dy });
  };

  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div className="map-canvas" ref={wrapRef}>
      <svg
        ref={svgRef}
        className={`map-svg${dragging ? " dragging" : ""}`}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio={narrow ? "xMidYMid meet" : "xMidYMid slice"}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={() => {
          if (!movedRef.current) onSelect(null);
        }}
        role="img"
        aria-label="主题地图：圆的大小代表文件数，连线代表文件类型接近或最近都在改"
      >
        <defs>
          <pattern
            id="mp-dots"
            width="26"
            height="26"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r="1" className="map-dot" />
          </pattern>
        </defs>
        <rect
          x="-3000"
          y="-3000"
          width="8000"
          height="8000"
          fill="url(#mp-dots)"
        />

        <g className="topic-edges">
          {edges.map(({ a, b }) => {
            const active =
              Boolean(selectedId) &&
              (a.id === selectedId || b.id === selectedId);
            const dim = Boolean(focusIds) && !active;
            return (
              <path
                key={`${a.id}-${b.id}`}
                d={edgePath(a, b)}
                className={`topic-edge${active ? " active" : ""}${
                  dim ? " dim" : ""
                }`}
              />
            );
          })}
        </g>

        <g className="topic-nodes">
          {topics.map((t) => {
            const r = 18 + Math.sqrt(t.count / maxCount) * 26;
            const tone = isUnsortedTopic(t)
              ? "other"
              : `tone-${toneForCount(t.count, maxCount)}`;
            const selected = t.id === selectedId;
            const dim = isDim(t);
            return (
              <g
                key={t.id}
                className={`topic-node${dim ? " dim" : ""}`}
                role="button"
                tabIndex={0}
                aria-label={`${t.name}，${t.count} 个文件`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(t.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(t.id);
                  }
                }}
                onMouseMove={(e) => handleHover(e, t)}
                onMouseLeave={() => setHover(null)}
              >
                {selected && (
                  <circle
                    cx={t.x}
                    cy={t.y}
                    r={r + 10}
                    className="node-halo"
                  />
                )}
                <circle
                  cx={t.x}
                  cy={t.y}
                  r={r}
                  className={`node-circle ${tone}${
                    selected ? " selected" : ""
                  }`}
                />
                <text
                  x={t.x}
                  y={t.y + r + 18}
                  textAnchor="middle"
                  className="node-label"
                >
                  {t.name}
                </text>
                <text
                  x={t.x}
                  y={t.y + r + 32}
                  textAnchor="middle"
                  className="node-count"
                >
                  {t.count} 个文件
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {topics.length === 0 && (
        <div className="map-empty">
          <span className="map-empty-title">地图还是空的</span>
          <span className="map-empty-sub">{emptyText}</span>
        </div>
      )}

      {hover && (
        <div
          className="map-tooltip"
          style={{ left: hover.x, top: hover.y }}
          role="tooltip"
        >
          <div className="map-tooltip-name">{hover.topic.name}</div>
          <div className="map-tooltip-meta">
            {hover.topic.count} 个文件 · 点击展开
          </div>
        </div>
      )}

      <div className="map-tools" role="group" aria-label="地图缩放">
        <button type="button" onClick={() => zoomBy(0.82)} aria-label="放大">
          <IconZoomIn size={15} />
        </button>
        <button type="button" onClick={() => zoomBy(1.22)} aria-label="缩小">
          <IconZoomOut size={15} />
        </button>
        <button
          type="button"
          onClick={() => setView(BASE)}
          aria-label="重置视图"
        >
          <IconMaximize size={15} />
        </button>
      </div>

      <div className="map-hint">滚轮缩放 · 拖动平移</div>
    </div>
  );
}
