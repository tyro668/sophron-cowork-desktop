import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let testRoot = '';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return path.join(testRoot, 'userData');
      return testRoot;
    },
  },
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { getAppStorageDir } from '../src/main/utils/app-storage';

const tempRoots: string[] = [];

function freshRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-app-storage-'));
  tempRoots.push(root);
  testRoot = root;
  return root;
}

function userDataDir(root: string): string {
  return path.join(root, 'userData');
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

beforeEach(() => {
  freshRoot();
});

describe('getAppStorageDir', () => {
  it('returns <userData>/agent when no legacy directory exists', () => {
    const dir = getAppStorageDir();
    expect(dir).toBe(path.join(userDataDir(testRoot), 'agent'));
  });

  it('imports a legacy <userData>/claude directory once and never writes to it', () => {
    const root = testRoot;
    const legacy = path.join(userDataDir(root), 'claude');
    fs.mkdirSync(path.join(legacy, 'skills', 'alpha'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'skills', 'alpha', 'SKILL.md'), 'legacy skill');

    const dir = getAppStorageDir();
    expect(dir).toBe(path.join(userDataDir(root), 'agent'));
    expect(fs.readFileSync(path.join(dir, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toBe(
      'legacy skill'
    );
    expect(fs.existsSync(path.join(dir, '.legacy-import-complete'))).toBe(true);
    // Legacy directory untouched.
    expect(fs.readFileSync(path.join(legacy, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toBe(
      'legacy skill'
    );
  });

  it('does not overwrite files that already exist in the new directory', () => {
    const root = testRoot;
    const storage = path.join(userDataDir(root), 'agent');
    const legacy = path.join(userDataDir(root), 'claude');
    fs.mkdirSync(path.join(storage, 'skills', 'alpha'), { recursive: true });
    fs.mkdirSync(path.join(legacy, 'skills', 'alpha'), { recursive: true });
    fs.mkdirSync(path.join(legacy, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(storage, 'skills', 'alpha', 'SKILL.md'), 'current');
    fs.writeFileSync(path.join(legacy, 'skills', 'alpha', 'SKILL.md'), 'legacy');
    fs.writeFileSync(path.join(legacy, 'plugins', 'extra.json'), 'x');

    const dir = getAppStorageDir();
    expect(fs.readFileSync(path.join(dir, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toBe('current');
    expect(fs.readFileSync(path.join(dir, 'plugins', 'extra.json'), 'utf8')).toBe('x');
  });

  it('returns the new path and retries later when the import fails', () => {
    const root = testRoot;
    const legacy = path.join(userDataDir(root), 'claude');
    fs.mkdirSync(legacy, { recursive: true });
    // A broken symlink makes the recursive walk fail mid-import.
    fs.symlinkSync(path.join(legacy, 'missing-target'), path.join(legacy, 'broken-link'));

    const copySpy = vi.spyOn(fs, 'copyFileSync').mockImplementationOnce(() => {
      throw new Error('simulated copy failure');
    });
    // Force a failing file: broken symlink is lstat'd as a symlink, not a file,
    // so instead fail on the first real copy attempt.
    fs.writeFileSync(path.join(legacy, 'a.txt'), 'data');

    const dir = getAppStorageDir();
    copySpy.mockRestore();
    expect(dir).toBe(path.join(userDataDir(root), 'agent'));
    // Marker NOT written -> import retries on next call.
    expect(fs.existsSync(path.join(dir, '.legacy-import-complete'))).toBe(false);
    // Legacy directory still intact and unmodified.
    expect(fs.readFileSync(path.join(legacy, 'a.txt'), 'utf8')).toBe('data');

    const dir2 = getAppStorageDir();
    expect(fs.readFileSync(path.join(dir2, 'a.txt'), 'utf8')).toBe('data');
    expect(fs.existsSync(path.join(dir2, '.legacy-import-complete'))).toBe(true);
  });
});
