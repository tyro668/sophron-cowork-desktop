/**
 * 发送器依赖的最小 socket 接口。真实运行时就是 socket.io-client 的 `Socket`，
 * 单测里可以替换成假的实现。
 */
export interface AgentSocket {
  readonly connected: boolean;
  readonly id?: string;
  emit(event: string, ...args: unknown[]): unknown;
}

/** 对应 Java `MessageEncoder`：有 encode() 的对象先编码再发送。 */
export interface MessageEncoder {
  encode(): unknown;
}

export function isMessageEncoder(value: unknown): value is MessageEncoder {
  return (
    !!value && typeof value === 'object' && typeof (value as MessageEncoder).encode === 'function'
  );
}

export function encodeMessage(data: unknown): unknown {
  return isMessageEncoder(data) ? data.encode() : data;
}

/** 构造错误消息，对应 Java `Message.ofError(messageId, errorMessage)`。 */
export function errorMessage(
  messageId: string | undefined,
  error: string
): Record<string, unknown> {
  return { messageId, error: true, errorMessage: error, hasNext: false };
}
