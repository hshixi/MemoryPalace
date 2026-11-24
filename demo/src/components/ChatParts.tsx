import { useState } from "react";
import { folderOf, KIND_NAME } from "../data";
import type { ConfirmSpec, ContentHitItem, FileItem } from "../types";
import {
  IconAlert,
  IconArrowRight,
  IconBrain,
  IconCheck,
  IconFile,
  IconFolder,
  IconShield,
  IconTrash,
  IconX,
} from "./Icons";
import { FileGlyph } from "./ui";

export function FileCard({
  file,
  onOpen,
}: {
  file: FileItem;
  onOpen: (file: FileItem) => void;
}) {
  return (
    <div className="file-card">
      <FileGlyph kind={file.kind} />
      <div className="file-card-main">
        <div className="file-card-name">{file.name}</div>
        <div className="file-card-path">{file.path}</div>
        <div className="file-card-meta">
          {KIND_NAME[file.kind]} · {file.size} · 修改于 {file.modified}
        </div>
      </div>
      <button
        type="button"
        className="btn-open"
        onClick={() => onOpen(file)}
        title={`打开所在文件夹：${folderOf(file.path)}`}
      >
        <IconFolder size={13} />
        <span className="open-label">打开所在文件夹</span>
      </button>
    </div>
  );
}

export function ContentHitCard({
  hit,
  onOpen,
}: {
  hit: ContentHitItem;
  onOpen: (path: string) => void;
}) {
  const unit = hit.locKind === "page" ? "页" : hit.locKind === "paragraph" ? "段" : "行";
  const lines =
    hit.endLine !== hit.startLine
      ? `第 ${hit.startLine}–${hit.endLine} ${unit}`
      : `第 ${hit.startLine} ${unit}`;
  const via =
    hit.via === "vector"
      ? { label: "语义", title: "按语义相似度命中，引用前先核对片段" }
      : hit.via === "both"
        ? { label: "关键词+语义", title: "关键词和语义都命中" }
        : null;
  return (
    <div className="content-hit">
      <div className="content-hit-top">
        <IconFile size={13} />
        <span className="content-hit-file">{hit.name}</span>
        {via && (
          <span className="content-hit-via" title={via.title}>
            {via.label}
          </span>
        )}
        <span className="content-hit-lines">{lines}</span>
      </div>
      <div className="content-hit-path">{hit.path}</div>
      <div className="content-hit-snippet">{hit.snippet}</div>
      <div className="content-hit-foot">
        {hit.injectionSuspected && (
          <span className="content-hit-warn">
            <IconAlert size={11} /> 文件里有可疑指令，只当内容看
          </span>
        )}
        <button
          type="button"
          className="btn-open"
          onClick={() => onOpen(hit.path)}
          title={`打开所在文件夹：${folderOf(hit.path)}`}
        >
          <IconFolder size={13} />
          <span className="open-label">打开所在文件夹</span>
        </button>
      </div>
    </div>
  );
}

interface ConfirmCardProps {
  spec: ConfirmSpec;
  onCancel: () => void;
  onPrimary: () => void;
  onUndo: () => void;
}

const DIFF_PREVIEW_LINES = 12;

export function ConfirmCard({
  spec,
  onCancel,
  onPrimary,
  onUndo,
}: ConfirmCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [diffExpanded, setDiffExpanded] = useState(false);
  const isDelete = spec.kind === "delete";
  const isWrite = spec.kind === "write";
  const isMemory = spec.kind === "memory";
  /** 真后端确认流带 actionId；mock 场景没有撤销能力。 */
  const live = Boolean(spec.actionId);
  const running = spec.status === "running";
  const locked = running || spec.status === "done";
  const rows = expanded ? spec.rows : spec.rows.slice(0, 3);
  const hiddenCount = spec.rows.length - rows.length;

  if (spec.status === "done") {
    return (
      <div className="confirm-card">
        <div className="confirm-done">
          <span className="done-icon">
            <IconCheck size={14} />
          </span>
          <div className="confirm-done-text">
            <b>
              {isDelete
                ? "已移入废纸篓"
                : isWrite
                  ? "已写入"
                  : isMemory
                    ? "已记住"
                    : "已移动"}
            </b>
            <span>
              {isDelete
                ? `${spec.total} 个文件 · 可在系统废纸篓里手动恢复`
                : isWrite
                  ? "文件已保存，索引已同步更新"
                  : isMemory
                    ? "下一次会话会自动带上，可在仪表盘「助手记忆」里删除"
                    : `${spec.total} 个文件 · 索引已同步更新`}
            </span>
          </div>
          {!live && !isMemory && (
            <button type="button" className="text-btn" onClick={onUndo}>
              {isDelete ? "恢复" : "撤销"}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (spec.status === "cancelled") {
    return (
      <div className="confirm-card">
        <div className="confirm-cancelled">
          <IconX size={13} />
          {isMemory ? "已取消 · 没有写入任何记忆" : "已取消 · 没有改动任何文件"}
        </div>
      </div>
    );
  }

  if (spec.status === "failed") {
    return (
      <div className="confirm-card">
        <div className="confirm-failed">
          <IconAlert size={13} />
          {isMemory ? "没有写入成功 · 记忆保持原样" : "没有执行成功 · 文件保持原样"}
        </div>
      </div>
    );
  }

  const diffLines = spec.diff
    ? diffExpanded
      ? spec.diff.lines
      : spec.diff.lines.slice(0, DIFF_PREVIEW_LINES)
    : [];
  const diffHidden = spec.diff
    ? spec.diff.lines.length - diffLines.length
    : 0;

  return (
    <div
      className={`confirm-card${isDelete ? " danger" : ""}`}
      role="group"
      aria-label={spec.title}
    >
      <div className="confirm-head">
        <span className="confirm-icon">
          {isDelete ? (
            <IconTrash size={15} />
          ) : isWrite ? (
            <IconFile size={15} />
          ) : isMemory ? (
            <IconBrain size={15} />
          ) : (
            <IconArrowRight size={15} />
          )}
        </span>
        <div className="confirm-head-text">
          <div className="confirm-title">{spec.title}</div>
          <div className="confirm-desc">{spec.description}</div>
        </div>
        <span className="confirm-badge">
          {isDelete
            ? "危险动作"
            : isWrite
              ? "写入前确认"
              : isMemory
                ? "记忆写入"
                : "需要确认"}
        </span>
      </div>

      {spec.diff && (
        <div className="confirm-diff">
          <div className="confirm-diff-meta">
            <span className="diff-add">+{spec.diff.added}</span>
            <span className="diff-del">−{spec.diff.removed}</span>
            {spec.diff.truncated && (
              <span className="diff-note">差异过长，只展示前 80 行</span>
            )}
            {spec.diff.lines.length > DIFF_PREVIEW_LINES && (
              <button
                type="button"
                className="text-btn confirm-more"
                onClick={() => setDiffExpanded((v) => !v)}
              >
                {diffExpanded
                  ? "收起 diff"
                  : `展开全部 ${spec.diff.lines.length} 行`}
              </button>
            )}
          </div>
          <pre className="confirm-diff-lines">
            {diffLines.map((line, i) => {
              const tone = line.startsWith("+")
                ? "add"
                : line.startsWith("-")
                  ? "del"
                  : "ctx";
              return (
                <span className={`diff-line ${tone}`} key={`${i}-${line}`}>
                  {line || " "}
                </span>
              );
            })}
            {diffHidden > 0 && (
              <span className="diff-line ctx">… 还有 {diffHidden} 行</span>
            )}
          </pre>
          {spec.diff.note && (
            <div className="confirm-diff-note">{spec.diff.note}</div>
          )}
        </div>
      )}

      {spec.rows.length > 0 && (
        <div className="confirm-rows">
          {rows.map((row, i) => (
            <div className="confirm-row" key={`${row.from}-${i}`}>
              <span className="confirm-from" title={row.from}>
                {row.from}
              </span>
              <IconArrowRight size={11} className="confirm-arrow" />
              <span
                className={`confirm-to${isDelete ? " danger" : ""}`}
                title={row.to}
              >
                {row.to ?? "废纸篓"}
              </span>
            </div>
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              className="text-btn confirm-more"
              onClick={() => setExpanded(true)}
            >
              还有 {hiddenCount} 项 · 展开全部
            </button>
          )}
          {expanded && spec.rows.length > 3 && (
            <button
              type="button"
              className="text-btn confirm-more"
              onClick={() => setExpanded(false)}
            >
              收起
            </button>
          )}
        </div>
      )}

      {isDelete && spec.status === "armed" && (
        <div className="confirm-warning" role="alert">
          <IconAlert size={13} />
          再次确认：{spec.total} 个文件将进入系统废纸篓，之后可在废纸篓里手动恢复。
        </div>
      )}

      <div className="confirm-foot">
        <span className="confirm-hint">
          <IconShield size={12} />
          {running
            ? "正在执行，等待后端返回结果"
            : isDelete
              ? "危险动作不会自动执行"
              : isWrite
                ? "确认后才会写入，内容先给你看"
                : isMemory
                  ? "确认后才会写入长期记忆"
                  : "确认后才会执行，移动不是复制"}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
          disabled={locked}
        >
          取消
        </button>
        <button
          type="button"
          className={`btn btn-sm ${isDelete ? "btn-danger" : "btn-primary"}`}
          onClick={onPrimary}
          disabled={locked}
        >
          {running
            ? "执行中…"
            : isDelete
              ? spec.status === "armed"
                ? "确认删除"
                : "移入废纸篓"
              : isWrite
                ? "确认写入"
                : isMemory
                  ? "确认记住"
                  : `确认移动 ${spec.total} 个文件`}
        </button>
      </div>
    </div>
  );
}
