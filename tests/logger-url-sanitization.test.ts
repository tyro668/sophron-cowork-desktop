import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Persisted logs are exportable via logs.export, so the log entry point
 * itself must redact credentials — a call site that logs a raw URL should
 * still never write secrets to disk. Covers the unified sanitizeLogText
 * pass applied in serializeLogArg and the console fan-out.
 */
let testUserDataDir = '';
let capturedWriteStream: fs.WriteStream | null = null;

async function getLogContent(logger: typeof import('../src/main/utils/logger')): Promise<string> {
  const logFilePath = logger.getLogFilePath();
  expect(logFilePath).toBeTruthy();
  const stream = capturedWriteStream;
  logger.closeLogFile();
  if (stream) {
    await new Promise<void>((resolve) => {
      if (stream.writableFinished || stream.destroyed) {
        resolve();
        return;
      }
      stream.once('finish', resolve);
      stream.once('close', resolve);
    });
  } else {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return fs.readFileSync(logFilePath!, 'utf8');
}

const SECRET = 'sk-persisted-secret-abc123';

describe('logger entry-point credential sanitization', () => {
  beforeEach(() => {
    testUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-test-logger-'));
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doMock('electron', () => ({
      app: {
        getPath: (_name: string) => testUserDataDir,
        getVersion: () => 'test',
      },
    }));
    capturedWriteStream = null;
    const realCreateWriteStream = fs.createWriteStream.bind(fs);
    vi.spyOn(fs, 'createWriteStream').mockImplementation(
      (...args: Parameters<typeof fs.createWriteStream>) => {
        const stream = realCreateWriteStream(...args);
        capturedWriteStream = stream;
        return stream;
      }
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    capturedWriteStream = null;
    try {
      const logger = await import('../src/main/utils/logger');
      logger.closeLogFile();
    } catch {
      // ignore
    }
    fs.rmSync(testUserDataDir, { recursive: true, force: true });
  });

  it('masks URL userinfo credentials in persisted log lines', async () => {
    const logger = await import('../src/main/utils/logger');
    logger.log(`[Test] connecting to https://user:${SECRET}@api.example.com/v1`);
    const content = await getLogContent(logger);
    expect(content).not.toContain(SECRET);
    expect(content).toContain('https://***@api.example.com/v1');
  });

  it('masks credential-looking query parameters in persisted log lines', async () => {
    const logger = await import('../src/main/utils/logger');
    logger.log(`[Test] url https://api.example.com/v1?api_key=${SECRET}&region=us`);
    const content = await getLogContent(logger);
    expect(content).not.toContain(SECRET);
    expect(content).toContain('api_key=***');
    expect(content).toContain('region=us');
  });

  it('sanitizes credentials inside serialized object payloads', async () => {
    const logger = await import('../src/main/utils/logger');
    logger.log('[Test] config dump', {
      baseUrl: `https://svc:${SECRET}@internal.example.com:8443/api`,
      provider: 'openai',
    });
    const content = await getLogContent(logger);
    expect(content).not.toContain(SECRET);
    expect(content).toContain('https://***@internal.example.com:8443/api');
    expect(content).toContain('"provider": "openai"');
  });

  it('leaves ordinary strings untouched', async () => {
    const logger = await import('../src/main/utils/logger');
    logger.log('[Test] plain message with https://example.com/path?a=1&b=2');
    const content = await getLogContent(logger);
    expect(content).toContain('https://example.com/path?a=1&b=2');
  });
});
