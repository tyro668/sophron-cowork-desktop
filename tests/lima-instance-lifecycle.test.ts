import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn(), exec: vi.fn() }));
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  ...mocks,
}));
vi.mock('../src/main/utils/logger', () => ({ log: vi.fn(), logError: vi.fn() }));
vi.mock('electron', () => ({ app: { isPackaged: false } }));
import { LimaBridge } from '../src/main/sandbox/lima-bridge';
import {
  adoptLimaInstanceName,
  LEGACY_LIMA_INSTANCE_NAME,
  LIMA_INSTANCE_NAME,
} from '../src/main/sandbox/lima-instance-name';

beforeEach(() => {
  vi.useFakeTimers();
  adoptLimaInstanceName(LEGACY_LIMA_INSTANCE_NAME);
  mocks.spawn.mockReset();
  mocks.execFile.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  adoptLimaInstanceName(LIMA_INSTANCE_NAME);
});

function processStub() {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: {},
    kill: vi.fn(),
  });
}

it('starts and stops the adopted legacy instance', async () => {
  const process = processStub();
  mocks.spawn.mockReturnValue(process);
  const starting = LimaBridge.startLimaInstance();
  expect(mocks.spawn).toHaveBeenCalledWith(
    'limactl',
    ['start', LEGACY_LIMA_INSTANCE_NAME],
    expect.anything()
  );
  process.emit('close', 0);
  expect(await starting).toBe(true);
  mocks.execFile.mockImplementation((_file, _args, _options, callback) => callback(null, '', ''));
  expect(await LimaBridge.stopLimaInstance()).toBe(true);
  expect(mocks.execFile).toHaveBeenCalledWith(
    'limactl',
    ['stop', LEGACY_LIMA_INSTANCE_NAME],
    expect.anything(),
    expect.any(Function)
  );
});

it('connects its agent to the same adopted instance', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lima-lifecycle-'));
  const entry = path.join(root, 'dist-lima-agent', 'index.js');
  fs.mkdirSync(path.dirname(entry));
  fs.writeFileSync(entry, '');
  const bridge = new LimaBridge();
  const internal = bridge as unknown as {
    getAgentScriptPath(): string;
    sendRequest(): Promise<unknown>;
    startAgent(): Promise<void>;
  };
  vi.spyOn(internal, 'getAgentScriptPath').mockReturnValue(entry);
  vi.spyOn(internal, 'sendRequest').mockResolvedValue({ pong: true });
  mocks.spawn.mockReturnValue(processStub());
  try {
    const starting = internal.startAgent();
    await vi.advanceTimersByTimeAsync(1000);
    await starting;
    expect(mocks.spawn).toHaveBeenCalledWith(
      'limactl',
      expect.arrayContaining(['shell', LEGACY_LIMA_INSTANCE_NAME]),
      expect.anything()
    );
    await bridge.shutdown();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
