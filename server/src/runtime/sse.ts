import type { ServerResponse } from "node:http";

export interface SseWriter {
  readonly closed: boolean;
  send(event: string, data: unknown): void;
  end(): void;
  startHeartbeat(intervalMs?: number): void;
}

export function createSseWriter(res: ServerResponse): SseWriter {
  let closed = false;
  let heartbeat: NodeJS.Timeout | null = null;

  const stopHeartbeat = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  res.on("close", () => {
    closed = true;
    stopHeartbeat();
  });

  return {
    get closed() {
      return closed || res.writableEnded || res.destroyed;
    },
    send(event, data) {
      if (closed || res.writableEnded || res.destroyed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      stopHeartbeat();
      if (!closed && !res.writableEnded) res.end();
    },
    startHeartbeat(intervalMs = 15_000) {
      stopHeartbeat();
      heartbeat = setInterval(() => {
        if (closed || res.writableEnded || res.destroyed) {
          stopHeartbeat();
          return;
        }
        res.write(": keep-alive\n\n");
      }, intervalMs);
      heartbeat.unref();
    },
  };
}
