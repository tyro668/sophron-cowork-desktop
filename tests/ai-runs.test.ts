import { EventEmitter } from 'events';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { streamSimple } from '@earendil-works/pi-ai/compat';
import type { Model } from '@earendil-works/pi-ai';
import {
  abortAllAiRuns,
  cancelAiRun,
  runningAiRunCount,
  startAiRun,
} from '../src/main/agent/ai-runs';
import { asCancelled, cancelledError, isCancelledError } from '../src/shared/cancel';

class FakeWebContents extends EventEmitter {
  destroyed = false;
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
    this.emit('destroyed');
  }
}

afterEach(() => {
  abortAllAiRuns();
});

describe('AI run registry', () => {
  it('取消 aborts exactly the run with that id', () => {
    const a = startAiRun('script:a');
    const b = startAiRun('script:b');
    expect(cancelAiRun('script:a')).toBe(true);
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
    a.release();
    b.release();
    expect(cancelAiRun('script:a')).toBe(false);
    expect(runningAiRunCount()).toBe(0);
  });

  it('closing the window that started a run aborts it', () => {
    const sender = new FakeWebContents();
    const run = startAiRun('normalizer:x', sender);
    sender.destroy();
    expect(run.signal.aborted).toBe(true);
    run.release();
  });

  it('release stops listening to the window', () => {
    const sender = new FakeWebContents();
    const run = startAiRun('normalizer:y', sender);
    run.release();
    expect(sender.listenerCount('destroyed')).toBe(0);
    sender.destroy();
    expect(run.signal.aborted).toBe(false);
  });

  it('a retry under the same id aborts the older run; a late release keeps the new one', () => {
    const first = startAiRun('chat-proposal:r');
    const second = startAiRun('chat-proposal:r');
    expect(first.signal.aborted).toBe(true);
    first.release();
    expect(cancelAiRun('chat-proposal:r')).toBe(true);
    expect(second.signal.aborted).toBe(true);
    second.release();
  });

  it('app quit aborts every running run', () => {
    const runs = [startAiRun('script:1'), startAiRun('normalizer:2')];
    expect(abortAllAiRuns()).toBe(2);
    expect(runs.every((run) => run.signal.aborted)).toBe(true);
    expect(runningAiRunCount()).toBe(0);
  });

  it('cancelled errors survive the IPC prefix', () => {
    const wrapped = new Error(
      `Error invoking remote method 'automation.scripts.generateDraft': ${cancelledError().message}`
    );
    expect(isCancelledError(wrapped)).toBe(true);
    expect(isCancelledError(new Error('模型出错'))).toBe(false);
    const controller = new AbortController();
    const other = new Error('x');
    expect(asCancelled(other, controller.signal)).toBe(other);
    controller.abort();
    expect(isCancelledError(asCancelled(other, controller.signal))).toBe(true);
  });
});

describe('provider stream honours the AbortSignal', () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  it('aborting mid-stream closes the HTTP request and no further chunks are read', async () => {
    let chunksSent = 0;
    let requestClosedAt = 0;
    let timer: NodeJS.Timeout | undefined;
    server = createServer((req, res) => {
      req.resume();
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = () => {
        chunksSent += 1;
        res.write(
          `data: ${JSON.stringify({
            id: 'c1',
            object: 'chat.completion.chunk',
            created: 0,
            model: 'fake',
            choices: [{ index: 0, delta: { content: `tok${chunksSent} ` }, finish_reason: null }],
          })}\n\n`
        );
      };
      send();
      timer = setInterval(send, 50);
      res.on('close', () => {
        requestClosedAt = Date.now();
        clearInterval(timer);
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server!.address() as AddressInfo).port;
    const model = {
      id: 'fake',
      name: 'fake',
      api: 'openai-completions',
      provider: 'fake-local',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8000,
      maxTokens: 1000,
    } as unknown as Model<'openai-completions'>;
    const controller = new AbortController();
    const stream = streamSimple(
      model,
      { systemPrompt: '', messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }] },
      { apiKey: 'local-test', signal: controller.signal }
    );
    let deltas = 0;
    let abortedAt = 0;
    for await (const event of stream) {
      if (event.type === 'text_delta') {
        deltas += 1;
        if (deltas === 3) {
          abortedAt = Date.now();
          controller.abort();
        }
      }
    }
    const result = await stream.result();
    expect(result.stopReason).toBe('aborted');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(requestClosedAt).toBeGreaterThan(0);
    expect(requestClosedAt - abortedAt).toBeLessThan(500);
    const sentAtClose = chunksSent;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(chunksSent).toBe(sentAtClose); // the server stopped streaming
    expect(deltas).toBeLessThanOrEqual(4);
  });
});
