import { describe, expect, it, vi } from 'vitest';

import { silentLocalAgentLogger } from '../../src/main/local-agent/logger';
import { RemoteEnvStore } from '../../src/main/local-agent/remote-env';
import type { AgentSocket } from '../../src/main/local-agent/transport/agent-socket';
import {
  SocketEventDispatcher,
  parseSocketTaskArgs,
} from '../../src/main/local-agent/transport/event-dispatcher';
import {
  BaseUrlMissingError,
  HttpMessageSender,
  isConnectionResetError,
} from '../../src/main/local-agent/transport/http-sender';
import {
  SocketMessageSender,
  SocketSendTimeoutError,
  packEngineIOv4Data,
} from '../../src/main/local-agent/transport/socket-sender';

class FakeSocket implements AgentSocket {
  connected = true;
  emitted: Array<{ event: string; args: unknown[] }> = [];
  autoAck: ((event: string, data: unknown) => unknown[]) | null = (e) => [`ack:${e}`];
  ackDelayMs = 0;
  emit(event: string, ...args: unknown[]): void {
    this.emitted.push({ event, args });
    const last = args[args.length - 1];
    if (typeof last === 'function' && this.autoAck) {
      const reply = this.autoAck(event, args[0]);
      setTimeout(() => (last as (...a: unknown[]) => void)(...reply), this.ackDelayMs);
    }
  }
}

describe('SocketMessageSender', () => {
  it('send emits encoded payloads (MessageEncoder)', () => {
    const socket = new FakeSocket();
    const sender = new SocketMessageSender(socket);
    sender.send('tables_result', { encode: () => ({ messageId: 'm1' }) });
    expect(socket.emitted[0]).toEqual({ event: 'tables_result', args: [{ messageId: 'm1' }] });
  });

  it('blockSend serializes emits and returns the ack value', async () => {
    const socket = new FakeSocket();
    socket.ackDelayMs = 5;
    const sender = new SocketMessageSender(socket);
    const order: string[] = [];
    socket.autoAck = (e) => {
      order.push(e);
      return [{ ok: e }];
    };
    const [a, b] = await Promise.all([
      sender.blockSend('e1', { x: 1 }, 1000),
      sender.blockSend('e2', { x: 2 }, 1000),
    ]);
    expect(a).toBe('{"ok":"e1"}');
    expect(b).toBe('{"ok":"e2"}');
    expect(order).toEqual(['e1', 'e2']);
  });

  it('returns empty string when ack has no single argument', async () => {
    const socket = new FakeSocket();
    socket.autoAck = () => [];
    await expect(new SocketMessageSender(socket).blockSend('e', {}, 1000)).resolves.toBe('');
  });

  it('times out when no ack arrives', async () => {
    const socket = new FakeSocket();
    socket.autoAck = null;
    await expect(new SocketMessageSender(socket).blockSend('e', {}, 20)).rejects.toBeInstanceOf(
      SocketSendTimeoutError
    );
  });

  it('rejects when the queue stays full', async () => {
    const socket = new FakeSocket();
    socket.autoAck = null;
    const sender = new SocketMessageSender(socket, 1);
    const first = sender.blockSend('a', {}, 200).catch(() => 'first-timeout');
    const second = sender.blockSend('b', {}, 200).catch(() => 'second-timeout');
    await expect(sender.blockSend('c', {}, 10)).rejects.toThrow(/Failed to add task/);
    await Promise.all([first, second]);
  });

  it('prefixes binary payloads with 0x04 (netty-socketio EIO v4 workaround)', async () => {
    const socket = new FakeSocket();
    await new SocketMessageSender(socket).blockSend('bin', new Uint8Array([1, 2]), 1000);
    expect([...(socket.emitted[0].args[0] as Buffer)]).toEqual([4, 1, 2]);
    expect([...packEngineIOv4Data(new Uint8Array([]))]).toEqual([4]);
  });
});

describe('SocketEventDispatcher', () => {
  it('parses [payload, messageId, trace] like BaseSocketHandler', () => {
    const ack = () => {};
    expect(parseSocketTaskArgs('t', ['{"a":1}', 'm1', '{"traceparent":"x"}', ack])).toEqual({
      event: 't',
      payload: '{"a":1}',
      messageId: 'm1',
      trace: { traceparent: 'x' },
      ack,
    });
    expect(parseSocketTaskArgs('t', ['only-id'])).toMatchObject({
      payload: '',
      messageId: 'only-id',
    });
    expect(parseSocketTaskArgs('t', [])).toMatchObject({ payload: '', messageId: '' });
  });

  it('binds handlers to the source and survives handler errors', async () => {
    const listeners = new Map<string, (...a: unknown[]) => void>();
    const source = {
      on: (e: string, l: (...a: unknown[]) => void) => listeners.set(e, l),
      off: (e: string) => listeners.delete(e),
    };
    const dispatcher = new SocketEventDispatcher(silentLocalAgentLogger);
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    dispatcher.register('tables', handler);
    dispatcher.attach(source);
    expect(listeners.has('tables')).toBe(true);
    await dispatcher.dispatch('tables', ['p', 'm']);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ payload: 'p', messageId: 'm' }));
    dispatcher.detach();
    expect(listeners.size).toBe(0);
  });
});

describe('HttpMessageSender', () => {
  it('posts JSON to baseUrl + eventType and returns body text', async () => {
    const env = new RemoteEnvStore();
    env.update({ baseUrl: 'https://sync.example.com/sync' });
    const fetchImpl = vi.fn(async () => new Response('ok-body', { status: 500 }));
    const sender = new HttpMessageSender(env, fetchImpl as unknown as typeof fetch);
    await expect(sender.blockSend('/webhook/agent/source/single', { a: 1 })).resolves.toBe(
      'ok-body'
    );
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://sync.example.com/sync/webhook/agent/source/single');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
  });

  it('throws when baseUrl is unknown (not connected yet)', async () => {
    const sender = new HttpMessageSender(new RemoteEnvStore(), vi.fn() as unknown as typeof fetch);
    await expect(sender.blockSend('/x', {})).rejects.toBeInstanceOf(BaseUrlMissingError);
  });

  it('retries once on connection reset only in blockSendWithFallback', async () => {
    const env = new RemoteEnvStore();
    env.update({ baseUrl: 'http://h' });
    const reset = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(reset)
      .mockResolvedValueOnce(new Response('second'));
    const sender = new HttpMessageSender(env, fetchImpl as unknown as typeof fetch);
    await expect(sender.blockSendWithFallback('/x', {})).resolves.toBe('second');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(isConnectionResetError(new Error('other'))).toBe(false);
  });
});
