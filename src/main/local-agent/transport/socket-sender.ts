/**
 * Socket 发送器，对应 Java `SocketMessageSender` + `MessageQueueEmitter`。
 *
 * - send：直接 emit（fire-and-forget），可带 ack 回调；
 * - blockSend：进入容量 16 的串行队列，逐条 emit 并等待 ack，超时报错。
 *   Java 端用单独线程串行发送，保证同一时刻只有一条等待 ack 的大消息。
 */
import { SOCKET_EMIT_QUEUE_CAPACITY } from '../constants';
import type { AgentSocket } from './agent-socket';
import { encodeMessage, isMessageEncoder } from './agent-socket';

export class SocketSendTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SocketSendTimeoutError';
  }
}

interface EmitTask {
  eventType: string;
  data: unknown;
  timeoutMs: number;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

/**
 * 给二进制负载加 0x04 前缀。服务端（推断为 netty-socketio）在 Engine.IO v4 下
 * 会吃掉二进制帧的第一个字节，Java 端为此做了同样的处理：
 * https://github.com/mrniko/netty-socketio/issues/706
 */
export function packEngineIOv4Data(data: Uint8Array): Buffer {
  const packed = Buffer.alloc(data.length + 1);
  packed[0] = 0x04;
  packed.set(data, 1);
  return packed;
}

/** 对应 Java 的 `args[0].toString()`：对象转 JSON，其余转字符串。 */
export function stringifyAckValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object' && !(value instanceof Uint8Array)) {
    return JSON.stringify(value);
  }
  return String(value);
}

export class SocketMessageSender {
  private socket: AgentSocket | null;
  private readonly queue: EmitTask[] = [];
  private readonly waitingForSlot: Array<() => void> = [];
  private processing = false;

  constructor(
    socket: AgentSocket | null = null,
    private readonly capacity: number = SOCKET_EMIT_QUEUE_CAPACITY
  ) {
    this.socket = socket;
  }

  setSocket(socket: AgentSocket | null): void {
    this.socket = socket;
  }

  private requireSocket(): AgentSocket {
    if (!this.socket) {
      throw new Error('socket is not initialized');
    }
    return this.socket;
  }

  send(eventType: string, data: unknown, ack?: (...args: unknown[]) => void): void {
    const socket = this.requireSocket();
    if (ack) {
      socket.emit(eventType, encodeMessage(data), ack);
    } else {
      socket.emit(eventType, encodeMessage(data));
    }
  }

  /** 排队发送并等待 ack；返回 ack 的第一个参数（转为字符串），没有则为空串。 */
  async blockSend(eventType: string, data: unknown, timeoutMs: number): Promise<string> {
    if (!isMessageEncoder(data) && !(data instanceof Uint8Array) && typeof data !== 'object') {
      throw new Error(`Unsupported data type: ${typeof data}`);
    }
    // 有空位时同步入队，保证"检查容量 + 入队"之间不会被其它调用插队
    if (this.queue.length >= this.capacity) {
      await this.waitForSlot(timeoutMs);
    }
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ eventType, data, timeoutMs, resolve, reject });
      void this.drain();
    });
  }

  get pending(): number {
    return this.queue.length;
  }

  private waitForSlot(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onSlot = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const idx = this.waitingForSlot.indexOf(onSlot);
        if (idx >= 0) this.waitingForSlot.splice(idx, 1);
        reject(
          new SocketSendTimeoutError(`Failed to add task to message queue after ${timeoutMs}ms`)
        );
      }, timeoutMs);
      this.waitingForSlot.push(onSlot);
    });
  }

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const task = this.queue.shift()!;
        const next = this.waitingForSlot.shift();
        if (next) next();
        try {
          task.resolve(await this.doActualEmit(task));
        } catch (error) {
          task.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private doActualEmit(task: EmitTask): Promise<string> {
    const socket = this.requireSocket();
    return new Promise<string>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new SocketSendTimeoutError('Emit acknowledgement timeout.'));
      }, task.timeoutMs);
      const ack = (...args: unknown[]) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(args.length === 1 ? stringifyAckValue(args[0]) : '');
      };
      const payload =
        task.data instanceof Uint8Array ? packEngineIOv4Data(task.data) : encodeMessage(task.data);
      socket.emit(task.eventType, payload, ack);
    });
  }
}
