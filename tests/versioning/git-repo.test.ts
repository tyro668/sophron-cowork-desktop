import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import git from 'isomorphic-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  VERSION_GIT_AUTHOR,
  VersionRepo as PackageRepo,
  findReusableDraft,
} from '../../src/main/versioning/git-repo';

let dir: string;
let repo: PackageRepo;

function write(rel: string, content: string) {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), content);
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'pkg-git-'));
  repo = new PackageRepo(dir);
  await repo.ensure();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('PackageRepo (isomorphic-git)', () => {
  it('initialises a repo with a managed .gitignore for runtime files', async () => {
    expect(existsSync(path.join(dir, '.git'))).toBe(true);
    const ignore = readFileSync(path.join(dir, '.gitignore'), 'utf8');
    for (const entry of ['.sophron/', '.venv/', 'node_modules/', '*.log', 'output/'])
      expect(ignore).toContain(entry);
    // Re-running keeps a user's own lines and only appends what is missing.
    writeFileSync(path.join(dir, '.gitignore'), 'secret.txt\n');
    await repo.ensure();
    const merged = readFileSync(path.join(dir, '.gitignore'), 'utf8');
    expect(merged.startsWith('secret.txt\n')).toBe(true);
    expect(merged).toContain('node_modules/');
  });

  it('commits the working tree with the neutral author and ignores runtime folders', async () => {
    write('main.py', 'print(1)\n');
    write('.venv/bin/python', 'x');
    write('node_modules/a/index.js', 'x');
    write('.sophron/state.json', '{}');
    write('run.log', 'log');
    const oid = await repo.commitAll('v1');
    expect(oid).toMatch(/^[0-9a-f]{40}$/);
    const files = (await repo.readFiles(oid!)).map((file: { path: string }) => file.path);
    expect(files).toEqual(['.gitignore', 'main.py']);
    const [entry] = await git.log({ fs, dir, depth: 1 });
    expect(entry.commit.author).toMatchObject(VERSION_GIT_AUTHOR);
    expect(await repo.changedPaths()).toEqual([]);
    expect(await repo.commitAll('nothing')).toBeNull();
  });

  it('reports folder edits through statusMatrix, including added and deleted files', async () => {
    write('main.py', 'a\n');
    write('lib.py', 'b\n');
    await repo.commitAll('v1');
    write('main.py', 'changed\n');
    rmSync(path.join(dir, 'lib.py'));
    write('new.py', 'c\n');
    write('.venv/x', 'ignored');
    expect((await repo.changedPaths()).sort()).toEqual(['lib.py', 'main.py', 'new.py']);
  });

  it('replaces the tip commit for an overwritten draft without growing history', async () => {
    write('main.py', 'v1\n');
    const v1 = (await repo.commitAll('v1'))!;
    write('main.py', 'draft a\n');
    const draftA = (await repo.commitAll('v2'))!;
    write('main.py', 'draft b\n');
    const draftB = (await repo.commitAll('v2', { replace: draftA }))!;
    expect(draftB).not.toBe(draftA);
    const log = await git.log({ fs, dir });
    expect(log.map((entry) => entry.oid)).toEqual([draftB, v1]);
  });

  it('tags versions, diffs trees and checks a tag out into another directory', async () => {
    write('main.py', 'v1\n');
    write('old.py', 'x\n');
    const v1 = (await repo.commitAll('v1'))!;
    await repo.tag('v1', v1);
    await repo.tag('published', v1);
    write('main.py', 'v2\n');
    rmSync(path.join(dir, 'old.py'));
    write('lib/new.py', 'y\n');
    const v2 = (await repo.commitAll('v2'))!;
    await repo.tag('v2', v2);
    await repo.tag('published', v2);
    expect(await repo.resolveTag('published')).toBe(v2);
    expect(await repo.diff(v1, v2)).toEqual({
      added: ['lib/new.py'],
      modified: ['main.py'],
      removed: ['old.py'],
    });

    // Rollback: move the tag back and check it out where runs happen; deps survive.
    await repo.tag('published', v1);
    const runDir = path.join(dir, '.sophron', 'run', 'published');
    mkdirSync(path.join(runDir, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(path.join(runDir, 'stale.py'), 'stale');
    await repo.checkoutTree((await repo.resolveTag('published'))!, runDir);
    expect(readFileSync(path.join(runDir, 'main.py'), 'utf8')).toBe('v1\n');
    expect(existsSync(path.join(runDir, 'old.py'))).toBe(true);
    expect(existsSync(path.join(runDir, 'stale.py'))).toBe(false);
    expect(existsSync(path.join(runDir, 'node_modules', 'dep'))).toBe(true);
    // The working tree is untouched by a run checkout.
    expect(readFileSync(path.join(dir, 'main.py'), 'utf8')).toBe('v2\n');
    expect(await repo.changedPaths()).toEqual([]);
  });

  it('writeFiles replaces the working tree but keeps runtime folders', async () => {
    const repo = new PackageRepo(dir);
    await repo.ensure();
    write('old.py', 'x');
    mkdirSync(path.join(dir, '.normalizer-env', 'bin'), { recursive: true });
    await repo.writeFiles([
      { path: 'src/main.py', content: 'print(1)\n' },
      { path: 'requirements.txt', content: '' },
    ]);
    expect(existsSync(path.join(dir, 'old.py'))).toBe(false);
    expect(existsSync(path.join(dir, '.normalizer-env', 'bin'))).toBe(true);
    expect(existsSync(path.join(dir, '.gitignore'))).toBe(true);
    const oid = (await repo.commitAll('v1'))!;
    expect((await repo.readFiles(oid)).map((file: { path: string }) => file.path)).toEqual([
      '.gitignore',
      'requirements.txt',
      'src/main.py',
    ]);
    await expect(repo.writeFiles([{ path: '../escape.py', content: '' }])).rejects.toThrow();
    await repo.publishTag(1, oid);
    expect((await repo.listTags()).sort()).toEqual(['published', 'v1']);
  });

  it('findReusableDraft picks the newest unpublished draft of the same source', () => {
    const rec = (version: number, status: 'draft' | 'published' | 'archived', source: string) => ({
      version,
      status,
      source,
      commit: String(version),
    });
    expect(
      findReusableDraft([rec(1, 'published', 'chat'), rec(2, 'draft', 'manual')], 'manual')
    ).toMatchObject({ version: 2 });
    expect(
      findReusableDraft([rec(1, 'published', 'chat'), rec(2, 'draft', 'manual')], 'ai_repair')
    ).toBeUndefined();
    expect(
      findReusableDraft([rec(1, 'published', 'chat'), rec(2, 'draft', 'rule')], 'rule', {
        alwaysNew: true,
      })
    ).toBeUndefined();
    // A draft older than the published version is never reused.
    expect(
      findReusableDraft([rec(1, 'draft', 'manual'), rec(2, 'published', 'chat')], 'manual')
    ).toBeUndefined();
  });
});
