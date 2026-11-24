import { folderOf, isUnsortedTopic, toneForCount } from "../data";
import type { FileItem, Topic, WorkspaceSummary } from "../types";
import {
  IconArrowRight,
  IconArrowUpRight,
  IconChevronRight,
  IconExternal,
  IconMap,
  IconSparkle,
} from "./Icons";
import FolderBrowser from "./FolderBrowser";
import { FileGlyph } from "./ui";

interface MapRailProps {
  topics: Topic[];
  workspace: WorkspaceSummary;
  selected: Topic | null;
  onSelect: (id: string | null) => void;
  onAsk: (query: string) => void;
  onOpenFile: (file: FileItem) => void;
  live?: boolean;
}

export default function MapRail({
  topics,
  workspace,
  selected,
  onSelect,
  onAsk,
  onOpenFile,
  live = false,
}: MapRailProps) {
  const maxCount = topics.reduce((max, t) => Math.max(max, t.count), 1);
  const toneClass = (topic: Topic) =>
    isUnsortedTopic(topic)
      ? "other"
      : `tone-${toneForCount(topic.count, maxCount)}`;

  if (selected) {
    return (
      <aside className="map-rail" aria-label="主题详情">
        <button
          type="button"
          className="back-btn"
          onClick={() => onSelect(null)}
        >
          <IconArrowRight size={13} className="flip-x" />
          返回全图
        </button>

        <div className="rail-topic-head">
          <span className={`topic-dot ${toneClass(selected)}`} />
          <div>
            <h3 className="rail-topic-name">{selected.name}</h3>
            <div className="rail-topic-meta">
              {selected.count} 个文件 · 主题 #{topics.indexOf(selected) + 1}
            </div>
          </div>
        </div>
        <p className="rail-blurb">{selected.blurb}</p>

        <div className="rail-section">
          <div className="rail-kicker">构成</div>
          <div className="kind-bars">
            {selected.kinds.map((k) => (
              <div className="kind-bar-row" key={k.label}>
                <span>{k.label}</span>
                <span className="kind-bar-track">
                  <span
                    className="kind-bar-fill"
                    style={{ width: `${k.pct}%` }}
                  />
                </span>
                <span className="kind-bar-pct">{k.pct}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rail-section">
          <div className="rail-kicker">关联主题</div>
          <div className="related-chips">
            {selected.related.map((r) => {
              const t = topics.find((x) => x.id === r.topicId);
              if (!t) return null;
              return (
                <button
                  type="button"
                  className="related-chip"
                  key={r.topicId}
                  title={r.reason}
                  onClick={() => onSelect(r.topicId)}
                >
                  <span className={`mini-dot ${toneClass(t)}`} />
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          className="btn btn-soft rail-ask"
          onClick={() =>
            onAsk(`帮我看看「${selected.name}」里最近改过的文件`)
          }
        >
          <IconSparkle size={14} />
          问助手这个主题
        </button>

        {live ? (
          <FolderBrowser
            key={selected.id}
            topic={selected}
            onOpenFile={onOpenFile}
          />
        ) : (
          <div className="rail-section">
            <div className="rail-kicker">文件</div>
            <div className="file-list">
              {selected.files.map((f) => (
                <button
                  type="button"
                  className="file-row"
                  key={f.id}
                  onClick={() => onOpenFile(f)}
                  title={`打开所在文件夹：${folderOf(f.path)}`}
                >
                  <FileGlyph kind={f.kind} small />
                  <span className="file-row-main">
                    <span className="file-row-name">{f.name}</span>
                    <span className="file-row-path">{f.path}</span>
                  </span>
                  <IconExternal size={12} className="file-row-open" />
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>
    );
  }

  const ranked = [...topics].sort((a, b) => b.count - a.count).slice(0, 4);
  const unsorted = topics.find((t) => isUnsortedTopic(t));

  return (
    <aside className="map-rail" aria-label="地图说明">
      <div className="rail-kicker">
        <IconMap size={12} />
        THE MAP
      </div>
      <h3 className="rail-h3">这张图怎么读</h3>

      <div className="legend-list">
        <div className="legend-row">
          <span className="legend-circles" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>圆的大小 = 主题里的文件数</span>
        </div>
        <div className="legend-row">
          <span className="legend-line" aria-hidden="true" />
          <span>连线 = 文件类型接近，或最近都在改</span>
        </div>
        <div className="legend-row">
          <span className="legend-icon" aria-hidden="true">
            <IconArrowUpRight size={13} />
          </span>
          <span>点一个主题，就能展开里面的文件</span>
        </div>
      </div>

      <div className="rail-section">
        <div className="rail-kicker">主题排行</div>
        {ranked.length === 0 && (
          <div className="empty-line">还没有主题。索引完成后会出现在这里。</div>
        )}
        <div className="rank-list">
          {ranked.map((t) => (
            <button
              type="button"
              className="rank-row"
              key={t.id}
              onClick={() => onSelect(t.id)}
            >
              <span className={`mini-dot ${toneClass(t)}`} />
              <span className="rank-name">{t.name}</span>
              <span className="rank-count">{t.count}</span>
              <IconChevronRight size={12} />
            </button>
          ))}
        </div>
      </div>

      {unsorted && (
        <div className="rail-section">
          <div className="callout">
            <div className="callout-title">
              {unsorted.count} 个文件还没有归属
            </div>
            <div className="callout-sub">
              它们可能只是放错了地方，先看一眼再决定。
            </div>
            <button
              type="button"
              className="text-btn"
              onClick={() => onSelect(unsorted.id)}
            >
              看看它们
              <IconArrowRight size={12} />
            </button>
          </div>
        </div>
      )}

      <div className="rail-foot">
        {workspace.topicCount} 个主题 · {workspace.fileCount.toLocaleString()} 个文件
      </div>
    </aside>
  );
}
