import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAudit,
  getIndexRun,
  getOverview,
  LIVE,
  revealFile,
  startRebuild,
  toDashboardData,
  type ApiError,
} from "../api";
import {
  activity as mockActivity,
  auditEvents as mockAudit,
  folderOf,
  recentQueries as mockRecentQueries,
  topics as mockTopics,
  typeDistribution as mockTypes,
  WORKSPACE,
} from "../data";
import type { DashboardData, FileItem } from "../types";
import {
  IconAlert,
  IconChat,
  IconFolder,
  IconRefresh,
  IconSearch,
  IconX,
} from "./Icons";
import Accordions from "./Accordions";
import MapRail from "./MapRail";
import { ActivityPanel, RecentPanel, TypesPanel } from "./Panels";
import TopicMap from "./TopicMap";

interface DashboardProps {
  onAsk: (query: string) => void;
  onOpenChat: () => void;
  onToast: (title: string, detail?: string) => void;
}

const MOCK_DATA: DashboardData = {
  workspace: {
    path: WORKSPACE.path,
    fileCount: WORKSPACE.files,
    sizeLabel: WORKSPACE.size,
    topicCount: WORKSPACE.topics,
    lastIndexedLabel: WORKSPACE.indexed,
    status: "ready",
  },
  topics: mockTopics,
  activity: mockActivity,
  types: mockTypes,
  recentQueries: mockRecentQueries,
  audit: mockAudit,
  lastRun: null,
};

const EMPTY_DATA: DashboardData = {
  workspace: {
    path: "读取中…",
    fileCount: 0,
    sizeLabel: "—",
    topicCount: 0,
    lastIndexedLabel: "—",
    status: "empty",
  },
  topics: [],
  activity: [],
  types: [],
  recentQueries: [],
  audit: [],
  lastRun: null,
};

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "请求失败";
}

async function waitForRun(runId: string) {
  for (let i = 0; i < 240; i += 1) {
    const run = await getIndexRun(runId);
    if (run.status !== "running") return run;
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw new Error("索引任务超时，请稍后刷新");
}

export default function Dashboard({
  onAsk,
  onOpenChat,
  onToast,
}: DashboardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [rebuilding, setRebuilding] = useState(false);
  const [data, setData] = useState<DashboardData>(() =>
    LIVE ? EMPTY_DATA : MOCK_DATA,
  );
  const [loading, setLoading] = useState(LIVE);
  const [loadError, setLoadError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!LIVE) return;
    const [overview, audit] = await Promise.all([
      getOverview(signal),
      getAudit(20, signal),
    ]);
    if (!aliveRef.current) return;
    setData(toDashboardData(overview, audit));
    setLoadError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!LIVE) return;
    const controller = new AbortController();
    refresh(controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setLoadError(errorText(error));
      setLoading(false);
    });
    return () => controller.abort();
  }, [refresh]);

  // 索引正在跑时轻量轮询，跑完自动换成新数据。
  useEffect(() => {
    if (!LIVE || data.workspace.status !== "indexing") return;
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [data.workspace.status, refresh]);

  const selected = data.topics.find((t) => t.id === selectedId) ?? null;

  const rebuild = async () => {
    if (rebuilding) return;
    if (!LIVE) {
      setRebuilding(true);
      window.setTimeout(() => {
        setRebuilding(false);
        setData((prev) => ({
          ...prev,
          workspace: { ...prev.workspace, lastIndexedLabel: "刚刚" },
        }));
        onToast("索引已更新", "1,284 个文件 · 0 个失败");
      }, 1500);
      return;
    }

    setRebuilding(true);
    setLoadError(null);
    try {
      const started = await startRebuild();
      setData((prev) => ({
        ...prev,
        workspace: { ...prev.workspace, status: "indexing" },
      }));
      const run = await waitForRun(started.runId);
      await refresh();
      if (run.status === "failed") {
        onToast("索引失败", `${run.errors.length} 个错误，详见审计日志`);
      } else {
        onToast(
          "索引已更新",
          `${run.filesIndexed} 个文件 · ${run.filesExcluded} 个已排除`,
        );
      }
    } catch (error) {
      onToast("重建索引失败", errorText(error));
    } finally {
      if (aliveRef.current) setRebuilding(false);
    }
  };

  const openFile = (file: FileItem) => {
    if (!LIVE) {
      onToast("已打开所在文件夹", folderOf(file.path));
      return;
    }
    revealFile(file.path)
      .then(() => onToast("已在 Finder 中定位", folderOf(file.path)))
      .catch((error: ApiError | Error) =>
        onToast("定位失败", errorText(error)),
      );
  };

  const statusText =
    data.workspace.status === "ready"
      ? "已索引"
      : data.workspace.status === "indexing"
        ? "索引中"
        : "未索引";
  const indexing = rebuilding || data.workspace.status === "indexing";

  return (
    <div className="dashboard">
      <div className="dash-intro">
        <div>
          <h1>你的文件，已经长成一张地图。</h1>
          <p>不用记得它们在哪。先看主题，或者直接问。</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onOpenChat}>
          <IconChat size={14} />
          直接问
        </button>
      </div>

      {loadError && (
        <div className="dash-error" role="alert">
          <IconAlert size={14} />
          <span>后端没连上：{loadError}</span>
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              setLoading(true);
              refresh()
                .catch((error: unknown) => {
                  setLoadError(errorText(error));
                  setLoading(false);
                })
                .finally(() => setLoading(false));
            }}
          >
            重试
          </button>
        </div>
      )}

      <section className="card workspace-strip" aria-label="工作区状态">
        <span className="ws-icon">
          <IconFolder size={19} />
        </span>
        <div className="ws-main">
          <div className="ws-title-row">
            <span className="ws-title">工作区</span>
            <span className={`status-pill ${data.workspace.status}`}>
              <span className="dot" />
              {statusText}
            </span>
          </div>
          <div className="ws-path">{data.workspace.path}</div>
        </div>

        <div className="ws-stats">
          <div className="ws-stat">
            <b>{data.workspace.fileCount.toLocaleString()}</b>
            <span>文件</span>
          </div>
          <div className="ws-divider" />
          <div className="ws-stat">
            <b>{data.workspace.sizeLabel}</b>
            <span>体积</span>
          </div>
          <div className="ws-divider" />
          <div className="ws-stat">
            <b>{data.workspace.topicCount}</b>
            <span>主题</span>
          </div>
          <div className="ws-divider" />
          <div className="ws-stat">
            <b>{data.workspace.lastIndexedLabel}</b>
            <span>最后索引</span>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-ghost rebuild-btn"
          onClick={rebuild}
          disabled={indexing}
        >
          {indexing ? (
            <>
              <span className="spinner" />
              索引中…
            </>
          ) : (
            <>
              <IconRefresh size={14} />
              重建索引
            </>
          )}
        </button>
      </section>

      <section className="card map-card" aria-label="主题地图">
        <div className="map-head">
          <div className="map-title">
            <h2>主题地图</h2>
            <p>
              {data.workspace.topicCount} 个主题 ·{" "}
              {data.workspace.fileCount.toLocaleString()} 个文件 · 点主题展开
            </p>
          </div>
          <div className="map-actions">
            <div className="search-field">
              <IconSearch size={14} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="在地图里找主题…"
                aria-label="在地图里搜索主题"
              />
              {query && (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() => setQuery("")}
                  aria-label="清除搜索"
                >
                  <IconX size={12} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="map-body">
          <TopicMap
            topics={data.topics}
            selectedId={selectedId}
            onSelect={setSelectedId}
            query={query}
            emptyText={
              loading
                ? "正在读取工作区…"
                : data.workspace.status === "empty"
                  ? "工作区还没有索引。右上角可以重建索引。"
                  : "索引里还没有可归类的文件。"
            }
          />
          <MapRail
            topics={data.topics}
            workspace={data.workspace}
            selected={selected}
            onSelect={setSelectedId}
            onAsk={onAsk}
            onOpenFile={openFile}
            live={LIVE}
          />
        </div>
      </section>

      <div className="lower-grid">
        <ActivityPanel data={data.activity} />
        <TypesPanel data={data.types} fileCount={data.workspace.fileCount} />
        <RecentPanel data={data.recentQueries} onAsk={onAsk} />
      </div>

      <Accordions
        onToast={onToast}
        live={LIVE}
        audit={data.audit}
        workspace={data.workspace}
        lastRun={data.lastRun}
      />
    </div>
  );
}
