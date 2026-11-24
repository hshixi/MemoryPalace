import type { Config } from "../config.ts";
import { DeepSeekProvider } from "./deepseek.ts";
import { MockProvider } from "./mock.ts";
import type { ModelProvider } from "./types.ts";

export function createProvider(config: Config): ModelProvider {
  if (config.provider === "mock") return new MockProvider();
  return new DeepSeekProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl });
}

export type { ModelProvider } from "./types.ts";
