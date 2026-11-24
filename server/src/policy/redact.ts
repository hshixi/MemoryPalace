export interface RedactResult {
  text: string;
  redacted: boolean;
}

const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const OPENAI_KEY = /\bsk-[A-Za-z0-9_-]{16,}\b/g;
const AWS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;
const GITHUB_TOKEN = /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g;
const LONG_BASE64 = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/])/g;

export function redactSecrets(input: string): RedactResult {
  let text = input;
  let redacted = false;

  const apply = (pattern: RegExp, replacement: string) => {
    text = text.replace(pattern, () => {
      redacted = true;
      return replacement;
    });
  };

  apply(PRIVATE_KEY, "[REDACTED_KEY]");
  apply(OPENAI_KEY, "[REDACTED_KEY]");
  apply(AWS_KEY, "[REDACTED_KEY]");
  apply(GITHUB_TOKEN, "[REDACTED_KEY]");
  apply(LONG_BASE64, "[REDACTED_BLOB]");

  return { text, redacted };
}

export function redactObject(value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value).text;
  if (Array.isArray(value)) return value.map(redactObject);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = redactObject(item);
    }
    return out;
  }
  return value;
}
