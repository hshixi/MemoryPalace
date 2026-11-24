import path from "node:path";

/** 目录级忽略：不索引、不读取、不展示。 */
export const IGNORED_DIRS = new Set([
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  ".Trash",
  ".ssh",
  ".aws",
  ".gnupg",
  ".cache",
  "Library",
]);

export const SENSITIVE_PATTERN_TEXT = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "id_rsa",
  "id_ed25519",
  "*credential*",
  "*secret*",
  ".ssh/**",
  "**/.aws/**",
];

const SENSITIVE_EXACT = new Set([
  ".env",
  "id_rsa",
  "id_ed25519",
  ".netrc",
  ".npmrc",
  ".pypirc",
]);

const SENSITIVE_SUFFIX = [".pem", ".key", ".p12", ".pfx"];
const SENSITIVE_PREFIX = ["credentials"];
const SENSITIVE_CONTAINS = ["secret", "credential"];

export function isSensitiveName(name: string): boolean {
  const lower = name.toLowerCase();
  if (SENSITIVE_EXACT.has(lower)) return true;
  if (lower.startsWith(".env.")) return true;
  if (SENSITIVE_SUFFIX.some((suffix) => lower.endsWith(suffix))) return true;
  if (SENSITIVE_PREFIX.some((prefix) => lower.startsWith(prefix))) return true;
  if (SENSITIVE_CONTAINS.some((part) => lower.includes(part))) return true;
  return false;
}

export function isSensitiveRelPath(relPath: string): boolean {
  const normalized = relPath.split(path.sep).join("/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment.toLowerCase() === ".ssh")) return true;
  if (segments.some((segment) => segment.toLowerCase() === ".aws")) return true;
  return segments.some(isSensitiveName);
}

export function isIgnoredDirName(name: string): boolean {
  const lower = name.toLowerCase();
  return name.startsWith(".") || IGNORED_DIRS.has(name) || IGNORED_DIRS.has(lower);
}

export function isIgnoredFileName(name: string): boolean {
  return name === ".DS_Store" || name.startsWith("._");
}

export function hasIgnoredSegment(relPath: string): boolean {
  return relPath
    .split("/")
    .filter(Boolean)
    .some((segment) => {
      const lower = segment.toLowerCase();
      return IGNORED_DIRS.has(segment) || IGNORED_DIRS.has(lower);
    });
}
