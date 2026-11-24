export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ProviderMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ProviderToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface ProviderUsage {
  prompt: number;
  cached: number;
  completion: number;
  reasoning?: number;
}

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | {
      type: "tool_call_delta";
      index: number;
      id?: string;
      name?: string;
      arguments?: string;
    }
  | { type: "usage"; usage: ProviderUsage }
  | { type: "finish"; reason: string };

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequest {
  model: string;
  messages: ProviderMessage[];
  tools: ToolDefinition[];
  maxOutputTokens: number;
  thinking: boolean;
}

export interface ProviderCapabilities {
  tools: boolean;
  parallelToolCalls: boolean;
  streaming: boolean;
  prefixCache: boolean;
  reasoning: boolean;
  maxContext: number;
  maxOutput: number;
}

export interface ModelProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  streamChat(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent>;
}

export class ProviderError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}
