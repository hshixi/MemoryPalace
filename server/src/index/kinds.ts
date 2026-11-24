export type FileKind =
  | "document"
  | "spreadsheet"
  | "presentation"
  | "image"
  | "archive"
  | "code"
  | "other";

export const KIND_LABEL: Record<FileKind, string> = {
  document: "文档",
  spreadsheet: "表格",
  presentation: "演示",
  image: "图片",
  archive: "压缩包",
  code: "代码",
  other: "其他",
};

const EXT_KIND: Record<string, FileKind> = {};

function add(kind: FileKind, exts: string[]): void {
  for (const ext of exts) EXT_KIND[ext] = kind;
}

add("document", ["md", "markdown", "txt", "pdf", "doc", "docx", "pages", "rtf"]);
add("spreadsheet", ["csv", "xls", "xlsx", "numbers"]);
add("presentation", ["ppt", "pptx", "key"]);
add("image", ["png", "jpg", "jpeg", "gif", "webp", "heic", "svg", "fig", "sketch", "bmp", "tiff"]);
add("archive", ["zip", "tar", "gz", "tgz", "7z", "rar", "bz2", "xz"]);
add(
  "code",
  [
    "ts",
    "tsx",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "py",
    "go",
    "rs",
    "java",
    "kt",
    "swift",
    "c",
    "h",
    "cpp",
    "json",
    "yaml",
    "yml",
    "toml",
    "html",
    "css",
    "scss",
    "sh",
    "sql",
    "xml",
  ],
);

export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function kindOfExt(ext: string): FileKind {
  return EXT_KIND[ext] ?? "other";
}

export function kindOfName(name: string): FileKind {
  return kindOfExt(extOf(name));
}

export function isTextExt(ext: string): boolean {
  return [
    "md",
    "markdown",
    "txt",
    "csv",
    "json",
    "yaml",
    "yml",
    "log",
    "html",
    "css",
    "js",
    "ts",
    "tsx",
    "jsx",
    "py",
    "go",
    "rs",
    "java",
    "sh",
    "sql",
    "xml",
  ].includes(ext);
}

export function kindLabel(kind: FileKind): string {
  return KIND_LABEL[kind];
}
