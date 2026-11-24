import { randomUUID } from "node:crypto";
import type { Db } from "../store/db.ts";
import { createPending, getPending, resolvePending } from "../store/pending.ts";
import type { ConfirmPreview } from "./tool-kit.ts";

export type ConfirmDecision = "allow" | "deny";
export type ConfirmOutcome = "allow" | "deny" | "expired" | "aborted";

interface Waiter {
  resolve: (outcome: ConfirmOutcome) => void;
  timer: NodeJS.Timeout;
  onAbort: () => void;
  signal?: AbortSignal;
  settled: boolean;
}

export interface PendingConfirm {
  actionId: string;
  expiresAt: number;
  /** 在 create 时就注册好，confirm 早到也不会丢。 */
  decision: Promise<ConfirmOutcome>;
}

export interface ConfirmRequest {
  sessionId: string;
  turn: number;
  toolCallId: string;
  tool: string;
  args: unknown;
  preview: ConfirmPreview;
}

export type ResolveResult = "ok" | "not_found" | "expired" | "resolved";

/**
 * 确认是在同一轮对话里原地等待的：chat 的 SSE 连接保持打开，
 * 前端用另一个 POST /api/confirm 把决定送回来。
 * 服务重启会丢掉内存里的等待者，pending_actions 里会留下 pending 记录。
 */
export class ConfirmBroker {
  private readonly waiters = new Map<string, Waiter>();
  private readonly db: Db;
  private readonly timeoutMs: number;

  constructor(db: Db, timeoutMs: number) {
    this.db = db;
    this.timeoutMs = timeoutMs;
  }

  create(request: ConfirmRequest, signal: AbortSignal): PendingConfirm {
    const actionId = `act_${randomUUID()}`;
    const expiresAt = Date.now() + this.timeoutMs;
    createPending(this.db, {
      id: actionId,
      sessionId: request.sessionId,
      toolCallId: request.toolCallId,
      tool: request.tool,
      args: request.args,
      preview: request.preview,
      expiresAt,
    });

    const decision = new Promise<ConfirmOutcome>((resolve) => {
      if (signal.aborted) {
        resolvePending(this.db, actionId, "aborted");
        resolve("aborted");
        return;
      }

      const finish = (
        outcome: ConfirmOutcome,
        status: "allowed" | "denied" | "expired" | "aborted",
      ) => {
        const current = this.waiters.get(actionId);
        if (current && !current.settled) {
          current.settled = true;
          clearTimeout(current.timer);
          signal.removeEventListener("abort", current.onAbort);
          this.waiters.delete(actionId);
        }
        resolvePending(this.db, actionId, status);
        resolve(outcome);
      };

      const onAbort = () => finish("aborted", "aborted");
      const timer = setTimeout(() => finish("expired", "expired"), this.timeoutMs);
      // setTimeout 返回的句柄在进程退出时不阻止退出。
      timer.unref?.();

      this.waiters.set(actionId, {
        resolve,
        timer,
        onAbort,
        signal,
        settled: false,
      });
      signal.addEventListener("abort", onAbort, { once: true });
    });

    return { actionId, expiresAt, decision };
  }

  /** 前端 POST /api/confirm 的入口。 */
  resolve(actionId: string, decision: ConfirmDecision): ResolveResult {
    const waiter = this.waiters.get(actionId);
    if (!waiter) {
      const row = getPending(this.db, actionId);
      if (!row) return "not_found";
      if (row.status === "pending" && (row.expiresAt ?? 0) < Date.now()) {
        resolvePending(this.db, actionId, "expired");
        return "expired";
      }
      return row.status === "pending" ? "not_found" : "resolved";
    }
    if (waiter.settled) return "resolved";

    waiter.settled = true;
    clearTimeout(waiter.timer);
    waiter.signal?.removeEventListener("abort", waiter.onAbort);
    this.waiters.delete(actionId);
    resolvePending(this.db, actionId, decision === "allow" ? "allowed" : "denied");
    waiter.resolve(decision);
    return "ok";
  }

  pendingCount(): number {
    return this.waiters.size;
  }

  /** 服务关闭或会话中止时，把所有等待者清掉。 */
  abortAll(): void {
    for (const [actionId, waiter] of this.waiters) {
      if (waiter.settled) continue;
      waiter.settled = true;
      clearTimeout(waiter.timer);
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
      resolvePending(this.db, actionId, "aborted");
      waiter.resolve("aborted");
    }
    this.waiters.clear();
  }
}
