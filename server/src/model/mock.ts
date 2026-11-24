import {
  type ChatRequest,
  type ModelProvider,
  type ProviderCapabilities,
  type ProviderMessage,
  type StreamEvent,
} from "./types.ts";

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

function lastUserIndex(messages: ProviderMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") return index;
  }
  return -1;
}

function userIdText(messages: ProviderMessage[]): string {
  const index = lastUserIndex(messages);
  if (index < 0 || messages[index].role !== "user") return "";
  return messages[index].content
    .replace(/<control\b[^>]*\/>/g, "")
    .trim();
}

type ToolMessage = Extract<ProviderMessage, { role: "tool" }>;

function toolMessagesAfterUser(messages: ProviderMessage[]): ToolMessage[] {
  const index = lastUserIndex(messages);
  return messages
    .slice(index + 1)
    .filter((message): message is ToolMessage => message.role === "tool");
}

function extractPath(text: string): string | null {
  const quoted = text.match(/[`'"“”]([^`'"“”]+\.(?:md|markdown|txt|csv|json|ya?ml|log|html|css|js|ts|tsx|jsx|py|go|rs|java|sh|sql|xml))[`'"“”]/i);
  if (quoted) return quoted[1];
  const plain = text.match(
    /([\w一-鿿][^\s，。！？；：'"“”]*\.(?:md|markdown|txt|csv|json|ya?ml|log|html|css|js|ts|tsx|jsx|py|go|rs|java|sh|sql|xml))/i,
  );
  return plain ? plain[1] : null;
}

function extractAnyPaths(text: string): string[] {
  const quoted = [...text.matchAll(/[`'"“”]([^`'"“”\n]+?\.[A-Za-z0-9]{1,8})[`'"“”]/g)].map(
    (match) => match[1],
  );
  if (quoted.length > 0) return quoted;
  return [...text.matchAll(/([\w一-鿿][\w一-鿿\-_.]*(?:\/[\w一-鿿\-_. ]+)*\.[A-Za-z0-9]{1,8})/g)].map(
    (match) => match[1],
  );
}

type DestructiveIntent = "delete" | "move" | "write";
type Intent = DestructiveIntent | "remember";

function detectIntent(text: string): Intent | null {
  if (/记住|记一下|记下|帮我记/.test(text)) return "remember";
  if (/删除|删掉|删了|移入废纸篓/.test(text)) return "delete";
  if (/移动|移到|重命名|改名/.test(text)) return "move";
  if (/写入|新建|创建文件/.test(text)) return "write";
  return null;
}

function intentTool(intent: Intent): string {
  if (intent === "remember") return "save_memory";
  if (intent === "delete") return "delete_file";
  if (intent === "move") return "move_file";
  return "write_file";
}

/** mock 只认用户明确写出的路径；不会拿搜索结果去猜要删哪个文件。 */
function intentArgs(
  intent: Intent,
  text: string,
): Record<string, unknown> | null {
  if (intent === "remember") {
    // mock 只是离线替身：尽量剥掉「请 / 帮我 / 这个信息：」这类引导语。
    // 真正的语义判断由模型完成，见 save_memory 的工具描述。
    const match = text.match(
      /(?:请|麻烦)?\s*(?:帮我\s*)?(?:记住|记一下|记下)\s*(?:这个信息|这条信息|这句话|一下)?\s*[：:，,]?\s*([\s\S]+)$/,
    );
    if (!match) return null;
    const fact = match[1].trim().replace(/\s+/g, " ");
    if (!fact) return null;
    const kind = /指代|就是|=|＝/.test(fact)
      ? "alias"
      : /喜欢|偏好|习惯|别用|不要/.test(fact)
        ? "preference"
        : /不是|纠正|搞错/.test(fact)
          ? "correction"
          : "context";
    return { kind, fact };
  }
  if (intent === "delete") {
    const path = extractAnyPaths(text)[0];
    return path ? { path } : null;
  }
  if (intent === "move") {
    const paths = extractAnyPaths(text);
    return paths.length >= 2 ? { from: paths[0], to: paths[1] } : null;
  }
  const path = extractAnyPaths(text)[0];
  if (!path) return null;
  const colon = text.match(/[：:]\s*([\s\S]*)$/);
  const newline = text.includes("\n") ? text.slice(text.indexOf("\n") + 1) : "";
  const content = (colon ? colon[1] : newline).trimEnd();
  return { path, content: content ? `${content}\n` : "" };
}

/** mock 的正文检索启发式：只在用户明显问“哪份文件里提到过”时才走正文。 */
function wantsContentSearch(text: string): boolean {
  return /提到过|提到|正文|内容里|里面写|哪份文件.*(写|说|提)|那句话|哪句话|原话/.test(text);
}

function contentQueryOf(text: string): string | null {
  const quoted = text.match(/[“"「']([^”"」']{1,40})[”"」']/);
  if (quoted) return quoted[1].trim();

  const marked = text.match(/(?:提到过?|说到|写过?到?|关于)\s*([^\s，。？！?？]{1,40})/);
  if (marked) return marked[1];

  const stripped = text
    .replace(
      /哪份|哪个|哪些|文件|里面|正文|内容|有没有|提到过|提到|说过|写过|写了|那句话|哪句话|原话|请|帮我|找一下|搜一下|一下|吗|呢|的|是|在|里|？|\?|，|。|,/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length >= 2 ? stripped.slice(0, 60) : null;
}

function lastSearchedPath(messages: ProviderMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "tool" || message.name !== "search_files") continue;
    try {
      const payload = JSON.parse(message.content) as {
        files?: Array<{ path?: string }>;
      };
      const path = payload.files?.[0]?.path;
      if (typeof path === "string" && path) return path;
    } catch {
      // tool 结果不是 JSON 就继续往前找。
    }
  }
  return null;
}

function chunkText(text: string, size = 18): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks.length ? chunks : [""];
}

function summarizeTool(messages: ProviderMessage[]): string {
  const tools = toolMessagesAfterUser(messages);
  const last = tools[tools.length - 1];
  if (!last) return "我没拿到工具结果。";

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(last.content) as Record<string, unknown>;
  } catch {
    return "工具返回了结果，但我没能解析它。";
  }

  if (payload.ok === false) {
    const error = payload.error as { message?: string; code?: string } | undefined;
    if (error?.code === "rejected") {
      return last.name === "save_memory"
        ? "你取消了，这条记忆没有写入。"
        : "你取消了这次操作，文件没有改动。";
    }
    if (error?.code === "confirm_timeout") return "等待确认超时，这次操作没有执行。";
    return `这次工具调用没有成功：${error?.message ?? "未知错误"}。`;
  }

  if (last.name === "save_memory") {
    return payload.merged === true
      ? `我把这条并进了已有记忆：${String(payload.fact ?? "")}。`
      : `记住了：${String(payload.fact ?? "")}。下一次会话会自动带上。`;
  }

  if (last.name === "write_file") {
    return `已经写入 ${String(payload.path ?? "文件")}（+${String(payload.added ?? 0)} / -${String(payload.removed ?? 0)} 行）。`;
  }

  if (last.name === "move_file") {
    return `已经把 ${String(payload.from ?? "")} 移动到 ${String(payload.to ?? "")}。`;
  }

  if (last.name === "delete_file") {
    return `已经把 ${String(payload.path ?? "文件")} 移入系统废纸篓，可以手动恢复。`;
  }

  if (last.name === "search_content") {
    const hits = Array.isArray(payload.hits) ? payload.hits : [];
    if (hits.length === 0) {
      return "正文里没有找到匹配的内容。可以换一个更短的词，或者先重建索引。";
    }
    const top = hits
      .slice(0, 3)
      .map((hit) => {
        const item = hit as { path?: string; loc?: string };
        return `${item.path ?? ""} ${item.loc ?? ""}`.trim();
      })
      .join("、");
    const hasNonText = hits.some((hit) => {
      const kind = (hit as { locKind?: string }).locKind;
      return kind === "page" || kind === "paragraph";
    });
    return `正文里命中 ${hits.length} 处：${top}。可以打开所在文件夹，${
      hasNonText
        ? "PDF/DOCX 只能引用检索片段；文本文件可以再用 read_file 看完整上下文。"
        : "再用 read_file 看完整上下文。"
    }`;
  }

  if (last.name === "read_file") {
    if (payload.injectionSuspected === true) {
      return "我读了这个文件，但里面出现了可疑的指令式内容。我只把它当数据看，没有执行，也不会据此改变规则。";
    }
    return `我读完了 ${String(payload.path ?? "这个文件")}，内容只作为参考资料。P0 只能读文本文件。`;
  }

  if (last.name === "search_files") {
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (files.length === 0) {
      return "索引里没有找到匹配的文件。可以换一个关键词，或先重建索引。";
    }
    const top = files
      .slice(0, 3)
      .map((file) => {
        const item = file as { name?: string; path?: string };
        return `${item.name ?? "未命名"}（${item.path ?? ""}）`;
      })
      .join("、");
    return `我在索引里找到 ${files.length} 个结果，最相关的是：${top}。你可以点文件卡片里的“打开所在文件夹”去定位。`;
  }

  if (last.name === "list_folder") {
    const folders = Array.isArray(payload.folders) ? payload.folders.length : 0;
    const files = Array.isArray(payload.files) ? payload.files.length : 0;
    return `这个目录下有 ${folders} 个子文件夹、${files} 个文件。`;
  }

  if (last.name === "get_file_info") {
    return `文件信息：${String(payload.name ?? "")}，${String(payload.sizeLabel ?? "")}，最近修改 ${String(payload.modifiedLabel ?? "")}。`;
  }

  return String(payload.summary ?? "工具执行完成。");
}

export class MockProvider implements ModelProvider {
  readonly id = "mock";
  readonly capabilities: ProviderCapabilities = {
    tools: true,
    parallelToolCalls: false,
    streaming: true,
    prefixCache: false,
    reasoning: false,
    maxContext: 32_000,
    maxOutput: 2_000,
  };

  private counter = 0;

  async *streamChat(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const userText = userIdText(req.messages);
    const toolMessages = toolMessagesAfterUser(req.messages);
    const intent = detectIntent(userText);

    if (intent) {
      const name = intentTool(intent);
      const args = intentArgs(intent, userText);
      const alreadyHandled = toolMessages.some((message) => message.name === name);
      if (args && !alreadyHandled) {
        this.counter += 1;
        const callId = `call_mock_${this.counter}`;
        yield {
          type: "tool_call_delta",
          index: 0,
          id: callId,
          name,
          arguments: JSON.stringify(args),
        };
        yield {
          type: "usage",
          usage: {
            prompt: Math.max(1, Math.round(JSON.stringify(req.messages).length / 4)),
            cached: 0,
            completion: 20,
          },
        };
        yield { type: "finish", reason: "tool_calls" };
        return;
      }
    }

    if (toolMessages.length > 0) {
      const answer = summarizeTool(req.messages);
      for (const part of chunkText(answer)) {
        if (signal.aborted) throw abortError();
        await sleep(4, signal);
        yield { type: "text_delta", text: part };
      }
      yield {
        type: "usage",
        usage: {
          prompt: Math.max(1, Math.round(JSON.stringify(req.messages).length / 4)),
          cached: 0,
          completion: Math.max(1, Math.round(answer.length / 4)),
        },
      };
      yield { type: "finish", reason: "stop" };
      return;
    }

    if (wantsContentSearch(userText) && toolMessages.length === 0) {
      const query = contentQueryOf(userText);
      if (query) {
        this.counter += 1;
        yield {
          type: "tool_call_delta",
          index: 0,
          id: `call_mock_${this.counter}`,
          name: "search_content",
          arguments: JSON.stringify({ query, k: 5 }),
        };
        yield {
          type: "usage",
          usage: {
            prompt: Math.max(1, Math.round(JSON.stringify(req.messages).length / 4)),
            cached: 0,
            completion: 20,
          },
        };
        yield { type: "finish", reason: "tool_calls" };
        return;
      }
    }

    const wantsRead = /读一下|读取|读读|看看内容|打开看看/.test(userText);
    const path = wantsRead ? extractPath(userText) ?? lastSearchedPath(req.messages) : null;

    let name: string;
    let args: Record<string, unknown>;
    if (wantsRead && path) {
      name = "read_file";
      args = { path };
    } else {
      name = "search_files";
      args = { query: userText.trim() || "文件", k: 5, type: "any" };
    }

    this.counter += 1;
    const callId = `call_mock_${this.counter}`;
    yield {
      type: "tool_call_delta",
      index: 0,
      id: callId,
      name,
      arguments: JSON.stringify(args),
    };
    yield {
      type: "usage",
      usage: {
        prompt: Math.max(1, Math.round(JSON.stringify(req.messages).length / 4)),
        cached: 0,
        completion: 20,
      },
    };
    yield { type: "finish", reason: "tool_calls" };
  }
}
