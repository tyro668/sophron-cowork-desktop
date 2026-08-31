import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { RemoteGateway } from '../src/main/remote/gateway';
import type { IChannel } from '../src/main/remote/types';
import type { MessageRouter } from '../src/main/remote/message-router';

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

describe('RemoteGateway webhook HTTP transport', () => {
  it('dispatches GET verification requests and preserves plain-text responses', () => {
    const router = {
      onResponse: vi.fn(),
      getActiveSessionCount: vi.fn(() => 0),
    } as unknown as MessageRouter;
    const gateway = new RemoteGateway(
      {
        enabled: true,
        port: 18789,
        bind: '127.0.0.1',
        auth: { mode: 'open' },
      },
      router
    );
    const channel = {
      type: 'wecom',
      connected: true,
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      send: vi.fn(async () => {}),
      onMessage: vi.fn(),
      onError: vi.fn(),
    } as IChannel;
    gateway.registerChannel(channel);
    (gateway as unknown as { _running: boolean })._running = true;
    gateway.on(
      'webhook:wecom',
      (request: {
        method: string;
        url: string;
        respond: (status: number, data: unknown, contentType?: string) => void;
      }) => {
        expect(request.method).toBe('GET');
        expect(request.url).toContain('echostr=encrypted');
        request.respond(200, 'decrypted-echo', 'text/plain; charset=utf-8');
      }
    );

    const request = {
      method: 'GET',
      headers: {},
    } as unknown as IncomingMessage;
    const state: {
      status?: number;
      headers?: Record<string, string>;
      body?: string;
      writableEnded: boolean;
    } = { writableEnded: false };
    const response = {
      get writableEnded() {
        return state.writableEnded;
      },
      writeHead(status: number, headers: Record<string, string>) {
        state.status = status;
        state.headers = headers;
        return this;
      },
      end(data?: string | Buffer) {
        state.body = data?.toString() || '';
        state.writableEnded = true;
        return this;
      },
    } as unknown as ServerResponse;

    (
      gateway as unknown as {
        handleWebhook(req: IncomingMessage, res: ServerResponse, url: string): void;
      }
    ).handleWebhook(request, response, '/webhook/wecom?echostr=encrypted');

    expect(state).toMatchObject({
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'decrypted-echo',
      writableEnded: true,
    });
  });
});
