import { redactSecrets } from "../policy/redact.ts";
import {
  ProviderError,
  type ChatRequest,
  type ModelProvider,
  type ProviderCapabilities,
  type ProviderMessage,
  type ProviderUsage,
  type StreamEvent,
} from "./types.ts";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export interface DeepSeekOptions {
  apiKey: string | null;
  baseUrl?: string;
}

function abortError(): Error {
  const error = new Error("请求已取消");
  error.name = "AbortError";
  return error;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function toApiMessage(message: ProviderMessage): Record<string, unknown> {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content || null,
      ...(message.toolCalls?.length
        ? {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        : {}),
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }
  return { role: message.role, content: message.content };
}

function mapHttpError(status: number, body: string): ProviderError {
  const text = redactSecrets(body).text.slice(0, 400);
  if (status === 401 || status === 403) {
    return new ProviderError("auth_error", `DeepSeek 鉴权失败（${status}）。请检查 DEEPSEEK_API_KEY。`, status);
  }
  if (status === 400 && /reasoning_content/i.test(text)) {
    return new ProviderError("harness_bug_reasoning", `上游拒绝了 reasoning_content：${text}`, status);
  }
  if (status === 400 && /(max_tokens|context|length)/i.test(text)) {
    return new ProviderError("context_exceeded", `上下文超限：${text}`, status);
  }
  if (status === 429) {
    return new ProviderError("rate_limited", `DeepSeek 限流：${text}`, status);
  }
  if (status >= 500) {
    return new ProviderError("upstream_error", `DeepSeek 上游错误（${status}）：${text}`, status);
  }
  return new ProviderError("invalid_request", `DeepSeek 请求失败（${status}）：${text}`, status);
}

async function* readSseData(
  body: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffer = "";

  const takeBlock = (block: string): string | null => {
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("data:")) {
        data.push(line.slice(5).replace(/^ /, ""));
      }
    }
    return data.length ? data.join("\n") : null;
  };

  for await (const chunk of body) {
    if (signal.aborted) throw abortError();
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
    let index = buffer.indexOf("\n\n");
    while (index >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = takeBlock(block);
      if (data !== null) yield data;
      index = buffer.indexOf("\n\n");
    }
  }

  const tail = takeBlock(buffer);
  if (tail !== null) yield tail;
}

function mapUsage(raw: unknown): ProviderUsage {
  if (!raw || typeof raw !== "object") {
    return { prompt: 0, cached: 0, completion: 0 };
  }
  const usage = raw as Record<string, unknown>;
  const details = (usage.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const completionDetails = (usage.completion_tokens_details ?? {}) as Record<string, unknown>;
  const cached =
    (details.cached_tokens as number | undefined) ??
    (usage.prompt_cache_hit_tokens as number | undefined) ??
    0;
  return {
    prompt: (usage.prompt_tokens as number | undefined) ?? 0,
    cached,
    completion: (usage.completion_tokens as number | undefined) ?? 0,
    reasoning: (completionDetails.reasoning_tokens as number | undefined) ?? 0,
  };
}

export class DeepSeekProvider implements ModelProvider {
  readonly id = "deepseek";
  readonly capabilities: ProviderCapabilities = {
    tools: true,
    parallelToolCalls: true,
    streaming: true,
    prefixCache: true,
    reasoning: true,
    maxContext: 128_000,
    maxOutput: 8_192,
  };

  private readonly apiKey: string | null;
  private readonly baseUrl: string;

  constructor(options: DeepSeekOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  async *streamChat(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
    if (!this.apiKey) {
      throw new ProviderError(
        "missing_api_key",
        "没有配置 DEEPSEEK_API_KEY。可以把 MP_PROVIDER=mock 用于开发。",
        503,
      );
    }

    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map(toApiMessage),
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: req.maxOutputTokens,
      thinking: { type: req.thinking ? "enabled" : "disabled" },
    };
    if (req.tools.length > 0) {
      body.tools = req.tools;
      body.tool_choice = "auto";
    }

    let response: Response | null = null;
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      if (signal.aborted) throw abortError();
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw abortError();
        if (attempt < 2) {
          await sleep(400 * (attempt + 1), signal);
          continue;
        }
        throw new ProviderError(
          "network_error",
          `连接 DeepSeek 失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (response.ok) break;
      const text = await response.text().catch(() => "");
      const mapped = mapHttpError(response.status, text);
      if (RETRYABLE.has(response.status) && attempt < 2) {
        await sleep(500 * (attempt + 1), signal);
        continue;
      }
      throw mapped;
    }

    if (!response || !response.ok) {
      throw new ProviderError("upstream_error", "DeepSeek 没有返回可用响应");
    }
    if (!response.body) {
      throw new ProviderError("upstream_error", "DeepSeek 返回了空响应体");
    }

    let finished = false;
    try {
      for await (const data of readSseData(
        response.body as unknown as AsyncIterable<Uint8Array>,
        signal,
      )) {
        if (data.trim() === "[DONE]") break;

        let chunk: Record<string, unknown>;
        try {
          chunk = JSON.parse(data) as Record<string, unknown>;
        } catch {
          throw new ProviderError("bad_upstream", "DeepSeek 返回了无法解析的 SSE 数据");
        }

        if (chunk.usage) {
          yield { type: "usage", usage: mapUsage(chunk.usage) };
        }

        const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(choices) || choices.length === 0) continue;
        const choice = choices[0];
        const delta = (choice.delta ?? {}) as Record<string, unknown>;

        if (typeof delta.content === "string" && delta.content) {
          yield { type: "text_delta", text: delta.content };
        }
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
          yield { type: "reasoning_delta", text: delta.reasoning_content };
        }

        const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(toolCalls)) {
          for (const call of toolCalls) {
            const fn = (call.function ?? {}) as Record<string, unknown>;
            yield {
              type: "tool_call_delta",
              index: typeof call.index === "number" ? call.index : 0,
              ...(typeof call.id === "string" ? { id: call.id } : {}),
              ...(typeof fn.name === "string" ? { name: fn.name } : {}),
              ...(typeof fn.arguments === "string" ? { arguments: fn.arguments } : {}),
            };
          }
        }

        if (typeof choice.finish_reason === "string" && choice.finish_reason) {
          finished = true;
          yield { type: "finish", reason: choice.finish_reason };
        }
      }
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw abortError();
      }
      throw error;
    }

    if (!finished) {
      yield { type: "finish", reason: "stop" };
    }
  }
}
