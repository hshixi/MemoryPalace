import { KIND_LABEL } from "../data";
import type { FileKind } from "../types";
import {
  IconFile,
  IconImage,
  IconMore,
  IconPlay,
  IconTable,
} from "./Icons";

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="26" height="26" rx="8" fill="var(--ink)" />
      <path
        d="M9 19.5V12a5 5 0 0 1 10 0v7.5"
        stroke="var(--surface)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M9 19.5h10"
        stroke="var(--surface)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="14" cy="11.2" r="1.3" fill="var(--surface)" />
    </svg>
  );
}

export function FileGlyph({
  kind,
  small = false,
}: {
  kind: FileKind;
  small?: boolean;
}) {
  return (
    <span className={`file-glyph ${kind}${small ? " sm" : ""}`}>
      {KIND_LABEL[kind]}
    </span>
  );
}

export function TypeIcon({ label }: { label: string }) {
  switch (label) {
    case "文档":
      return <IconFile size={14} />;
    case "图片":
      return <IconImage size={14} />;
    case "表格":
      return <IconTable size={14} />;
    case "演示":
      return <IconPlay size={14} />;
    default:
      return <IconMore size={14} />;
  }
}
