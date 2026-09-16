/**
 * IPC boundary contract tests.
 *
 * 1. clientEventSchema accepts every ClientEvent variant and rejects malformed
 *    envelopes (missing type, bad enum values, missing required fields).
 * 2. validateIpcArgs validates positional args and reports channel + arg index.
 * 3. Coverage: every channel registered via handleIpc()/ipcMain.handle() in
 *    src/main must have a schema entry in IPC_INPUT_SCHEMAS — and no main file
 *    may call ipcMain.handle directly anymore.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { clientEventSchema, IPC_INPUT_SCHEMAS } from '../../shared/contracts/ipc/schemas';
import {
  IpcInputValidationError,
  parseClientEvent,
  validateIpcArgs,
} from '../../shared/contracts/ipc/validate';

const SRC_MAIN = path.resolve(__dirname, '../../main');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

describe('clientEventSchema', () => {
  it('accepts every documented ClientEvent variant', () => {
    const valid: unknown[] = [
      { type: 'session.start', payload: { title: 't', prompt: 'p' } },
      {
        type: 'session.start',
        payload: {
          title: 't',
          prompt: 'p',
          cwd: '/tmp',
          allowedTools: ['read'],
          permissionRules: [{ tool: 'bash', action: 'allow' }],
          content: [{ type: 'text', text: 'hi' }],
          memoryEnabled: true,
          selectedSkillNames: ['x'],
        },
      },
      { type: 'session.continue', payload: { sessionId: 's', prompt: 'p' } },
      { type: 'session.stop', payload: { sessionId: 's' } },
      { type: 'session.delete', payload: { sessionId: 's' } },
      { type: 'session.batchDelete', payload: { sessionIds: ['a', 'b'] } },
      { type: 'session.list', payload: {} },
      { type: 'session.getMessages', payload: { sessionId: 's' } },
      { type: 'session.getTraceSteps', payload: { sessionId: 's' } },
      { type: 'project.rename', payload: { projectId: 'p', name: null } },
      { type: 'project.renameByCwd', payload: { cwd: '/x', name: 'n' } },
      { type: 'project.delete', payload: { projectId: 'p' } },
      { type: 'permission.response', payload: { toolUseId: 't', result: 'allow_always' } },
      { type: 'sudo.password.response', payload: { toolUseId: 't', password: null } },
      { type: 'settings.update', payload: { theme: 'dark' } },
      { type: 'folder.select', payload: {} },
      { type: 'workdir.get', payload: {} },
      { type: 'workdir.set', payload: { path: '/x' } },
      { type: 'workdir.select', payload: { sessionId: 's' } },
    ];
    for (const event of valid) {
      const result = clientEventSchema.safeParse(event);
      expect(result.success, JSON.stringify(event)).toBe(true);
    }
  });

  it('rejects malformed events', () => {
    const invalid: unknown[] = [
      null,
      undefined,
      'session.start',
      {},
      { type: 'session.start' }, // missing payload
      { type: 'session.start', payload: { title: 't' } }, // missing prompt
      { type: 'session.start', payload: { title: 't', prompt: 42 } },
      { type: 'session.stop', payload: {} }, // missing sessionId
      { type: 'permission.response', payload: { toolUseId: 't', result: 'maybe' } },
      { type: 'no.such.event', payload: {} },
    ];
    for (const event of invalid) {
      expect(clientEventSchema.safeParse(event).success, JSON.stringify(event)).toBe(false);
    }
  });

  it('parseClientEvent throws IpcInputValidationError with channel context', () => {
    try {
      parseClientEvent('client-invoke', { type: 'session.stop', payload: {} });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(IpcInputValidationError);
      const err = error as IpcInputValidationError;
      expect(err.channel).toBe('client-invoke');
      expect(err.message).toContain('client-invoke');
      expect(err.issues.length).toBeGreaterThan(0);
    }
  });
});

describe('validateIpcArgs', () => {
  it('validates positional args and returns parsed values', () => {
    const schemas = IPC_INPUT_SCHEMAS['schedule.toggle'];
    const out = validateIpcArgs('schedule.toggle', schemas, ['id-1', true]);
    expect(out).toEqual(['id-1', true]);
  });

  it('rejects a bad arg with channel + index context', () => {
    const schemas = IPC_INPUT_SCHEMAS['skills.setEnabled'];
    expect(() => validateIpcArgs('skills.setEnabled', schemas, ['id', 'yes'])).toThrow(
      IpcInputValidationError
    );
    try {
      validateIpcArgs('skills.setEnabled', schemas, [123, true]);
      expect.unreachable();
    } catch (error) {
      expect((error as IpcInputValidationError).message).toContain('skills.setEnabled');
      expect((error as IpcInputValidationError).message).toContain('arg 0');
    }
  });

  it('lets variadic tail args pass through', () => {
    const schemas = IPC_INPUT_SCHEMAS['logs.write'];
    const out = validateIpcArgs('logs.write', schemas, ['warn', { a: 1 }, 'text']);
    expect(out[1]).toEqual({ a: 1 });
    expect(out[2]).toBe('text');
  });

  it('enforces config.createSet mode (regression: required on the wire)', () => {
    const [schema] = IPC_INPUT_SCHEMAS['config.createSet'];
    expect(schema.safeParse({ name: 'x', mode: 'blank' }).success).toBe(true);
    expect(schema.safeParse({ name: 'x' }).success).toBe(false);
    expect(schema.safeParse({ name: 'x', mode: 'clone', fromSetId: 'a' }).success).toBe(true);
  });
});

describe('channel schema coverage', () => {
  const registeredChannels: string[] = [];
  for (const file of walk(SRC_MAIN)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/handleIpc\(\s*'([^']+)'/g)) registeredChannels.push(m[1]);
    // Direct ipcMain.handle outside the wrapper module is forbidden.
    if (!file.endsWith('ipc-handle.ts')) {
      for (const m of src.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)) {
        registeredChannels.push(m[1]);
      }
    }
  }

  it('finds registered channels', () => {
    expect(registeredChannels.length).toBeGreaterThan(100);
  });

  it('every handleIpc channel has an input schema', () => {
    const missing = [...new Set(registeredChannels)].filter((ch) => !(ch in IPC_INPUT_SCHEMAS));
    expect(missing).toEqual([]);
  });

  it('no main file calls ipcMain.handle directly (all go through handleIpc)', () => {
    for (const file of walk(SRC_MAIN)) {
      if (file.endsWith('ipc-handle.ts')) continue;
      const src = fs.readFileSync(file, 'utf8');
      expect(src.includes('ipcMain.handle('), path.basename(file)).toBe(false);
    }
  });
});
