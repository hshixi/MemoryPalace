import { useEffect, useState } from "react";
import {
  browseFolder,
  toFileItem,
  type BackendBrowse,
  type BrowseFolderEntry,
} from "../api";
import { folderOf } from "../data";
import type { FileItem, Topic } from "../types";
import { IconChevronRight, IconExternal, IconFolder } from "./Icons";
import { FileGlyph } from "./ui";

const PAGE_SIZE = 50;

interface FolderBrowserProps {
  topic: Topic;
  onOpenFile: (file: FileItem) => void;
}

/** 主题就是一级目录；「未归类」对应工作区根目录。 */
function topicRoot(topic: Topic): string {
  return topic.name === "未归类" ? "" : topic.name;
}

export default function FolderBrowser({
  topic,
  onOpenFile,
}: FolderBrowserProps) {
  const root = topicRoot(topic);
  const rootDepth = root ? root.split("/").length : 0;
  const [path, setPath] = useState(root);
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<BackendBrowse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    browseFolder(path, offset, PAGE_SIZE, controller.signal)
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "目录读取失败");
        setLoading(false);
      });
    return () => controller.abort();
  }, [path, offset, reload]);

  // 发起新请求前清掉旧结果，由事件处理函数完成，避免在 effect 里同步 setState。
  const go = (next: string, nextOffset = 0) => {
    setData(null);
    setLoading(true);
    setError(null);
    setPath(next);
    setOffset(nextOffset);
  };

  const openFolder = (folder: BrowseFolderEntry) => go(folder.path);

  const rootLabel = topic.name === "未归类" ? "根目录" : topic.name;
  const crumbs = data ? data.breadcrumbs.slice(rootDepth) : [];
  const files = data ? data.files.map(toFileItem) : [];
  const total = data?.totalFiles ?? 0;

  return (
    <div className="folder-browser">
      {(path !== root || crumbs.length > 0) && (
        <div className="folder-crumbs" aria-label="目录路径">
          <button
            type="button"
            className="crumb"
            onClick={() => go(root)}
          >
            {rootLabel}
          </button>
          {crumbs.map((crumb, index) => (
            <span className="crumb-seg" key={crumb.path}>
              <IconChevronRight size={10} />
              <button
                type="button"
                className={`crumb${
                  index === crumbs.length - 1 ? " current" : ""
                }`}
                onClick={() => go(crumb.path)}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>
      )}

      {loading && !data && <div className="empty-line">正在读取目录…</div>}

      {error && (
        <div className="folder-error">
          <span>{error}</span>
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              setData(null);
              setLoading(true);
              setError(null);
              setReload((value) => value + 1);
            }}
          >
            重试
          </button>
        </div>
      )}

      {data && !error && (
        <>
          {data.folders.length > 0 && (
            <div className="rail-section">
              <div className="rail-kicker">子文件夹</div>
              <div className="folder-list">
                {data.folders.map((folder) => (
                  <button
                    type="button"
                    className="folder-row"
                    key={folder.path}
                    onClick={() => openFolder(folder)}
                    title={`进入 ${folder.path}`}
                  >
                    <span className="folder-icon">
                      <IconFolder size={14} />
                    </span>
                    <span className="folder-row-main">
                      <span className="folder-row-name">{folder.name}</span>
                      <span className="folder-row-path">
                        {folder.count} 个文件
                      </span>
                    </span>
                    <IconChevronRight size={12} className="folder-row-open" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="rail-section">
            <div className="rail-kicker">
              文件{total > 0 ? ` · ${total}` : ""}
            </div>
            {files.length === 0 ? (
              <div className="empty-line">这个目录下没有已索引的文件。</div>
            ) : (
              <div className="file-list">
                {files.map((file) => (
                  <button
                    type="button"
                    className="file-row"
                    key={file.id}
                    onClick={() => onOpenFile(file)}
                    title={`打开所在文件夹：${folderOf(file.path)}`}
                  >
                    <FileGlyph kind={file.kind} small />
                    <span className="file-row-main">
                      <span className="file-row-name">{file.name}</span>
                      <span className="file-row-path">{file.path}</span>
                    </span>
                    <IconExternal size={12} className="file-row-open" />
                  </button>
                ))}
              </div>
            )}

            {total > PAGE_SIZE && (
              <div className="folder-pager">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  disabled={offset === 0}
                  onClick={() => go(path, Math.max(0, offset - PAGE_SIZE))}
                >
                  上一页
                </button>
                <span className="folder-page-meta">
                  {offset + 1}–{Math.min(offset + files.length, total)} / {total}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => go(path, offset + PAGE_SIZE)}
                >
                  下一页
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
