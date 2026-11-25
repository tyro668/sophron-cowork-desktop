/**
 * 云端任务事件分发，对应 Java `AgentContext.on()` + `BaseSocketHandler.call()`。
 *
 * 云端事件参数约定：`[payload, messageId, traceContext?]`；只有一个参数时它就是 messageId。
 * 如果云端要求 ack，socket.io-client 会把 ack 回调作为最后一个参数传进来，这里先剥离出来。
 */
import type { LocalAgentLogger } from '../logger';

export interface SocketTaskContext {
  event: string;
  payload: unknown;
  messageId: string;
  trace: Record<string, unknown>;
  ack?: (...args: unknown[]) => void;
}

export type SocketTaskHandler = (ctx: SocketTaskContext) => void | Promise<void>;

export interface EventSource {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener?: (...args: unknown[]) => void): unknown;
}

function toTraceMap(carrier: unknown): Record<string, unknown> {
  if (carrier && typeof carrier === 'object' && !Array.isArray(carrier)) {
    return carrier as Record<string, unknown>;
  }
  if (typeof carrier === 'string' && carrier.trim()) {
    try {
      const parsed = JSON.parse(carrier);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      /* ignore */
    }
  }
  return {};
}

export function parseSocketTaskArgs(event: string, rawArgs: unknown[]): SocketTaskContext {
  const args = [...rawArgs];
  let ack: SocketTaskContext['ack'];
  if (args.length > 0 && typeof args[args.length - 1] === 'function') {
    ack = args.pop() as SocketTaskContext['ack'];
  }
  const payload = args.length > 1 ? args[0] : '';
  const messageId = args.length > 1 ? String(args[1]) : args.length === 1 ? String(args[0]) : '';
  const trace = args.length > 2 ? toTraceMap(args[2]) : {};
  return { event, payload, messageId, trace, ack };
}

export class SocketEventDispatcher {
  private readonly handlers = new Map<string, SocketTaskHandler>();
  private readonly bound = new Map<string, (...args: unknown[]) => void>();
  private source: EventSource | null = null;

  constructor(private readonly logger: LocalAgentLogger) {}

  register(event: string, handler: SocketTaskHandler): void {
    this.handlers.set(event, handler);
    if (this.source) this.bindOne(this.source, event);
  }

  has(event: string): boolean {
    return this.handlers.has(event);
  }

  events(): string[] {
    return [...this.handlers.keys()];
  }

  attach(source: EventSource): void {
    this.detach();
    this.source = source;
    for (const event of this.handlers.keys()) this.bindOne(source, event);
  }

  detach(): void {
    if (!this.source) return;
    for (const [event, listener] of this.bound) this.source.off(event, listener);
    this.bound.clear();
    this.source = null;
  }

  private bindOne(source: EventSource, event: string): void {
    const previous = this.bound.get(event);
    if (previous) source.off(event, previous);
    const listener = (...args: unknown[]) => {
      void this.dispatch(event, args);
    };
    this.bound.set(event, listener);
    source.on(event, listener);
  }

  /** 直接分发（单测和本地调试用）。 */
  async dispatch(event: string, args: unknown[]): Promise<void> {
    const handler = this.handlers.get(event);
    if (!handler) return;
    const ctx = parseSocketTaskArgs(event, args);
    try {
      await handler(ctx);
    } catch (error) {
      this.logger.error(
        `handle sync event failed, event: ${event}, messageId: ${ctx.messageId}`,
        error
      );
    }
  }
}
