import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveBuiltinSkillsPath } from '../src/main/utils/builtin-skills-path';

const ROOT = path.join(__dirname, '..');

let tmpDir = '';

function makeTmpRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builtin-skills-'));
  tmpDir = root;
  return root;
}

function makeSkillsDir(dir: string): void {
  fs.mkdirSync(path.join(dir, 'docx'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docx', 'SKILL.md'), '---\nname: docx\ndescription: d\n---\n');
}

describe('resolveBuiltinSkillsPath', () => {
  beforeEach(() => {
    tmpDir = '';
  });

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds assets/skills two levels above moduleDir (vite dist-electron/main layout)', () => {
    const root = makeTmpRoot();
    const skillsDir = path.join(root, 'assets', 'skills');
    makeSkillsDir(skillsDir);
    const moduleDir = path.join(root, 'dist-electron', 'main');

    expect(resolveBuiltinSkillsPath({ appPath: root, resourcesPath: undefined, moduleDir })).toBe(
      skillsDir
    );
  });

  it('finds assets/skills three levels above moduleDir (unbundled src/main/* layout)', () => {
    const root = makeTmpRoot();
    const skillsDir = path.join(root, 'assets', 'skills');
    makeSkillsDir(skillsDir);
    const moduleDir = path.join(root, 'src', 'main', 'skills');

    expect(resolveBuiltinSkillsPath({ appPath: root, resourcesPath: undefined, moduleDir })).toBe(
      skillsDir
    );
  });

  it('prefers resourcesPath/skills in production', () => {
    const root = makeTmpRoot();
    const resDir = path.join(root, 'resources');
    const skillsDir = path.join(resDir, 'skills');
    makeSkillsDir(skillsDir);
    // also present via moduleDir — resources must win
    makeSkillsDir(path.join(root, 'assets', 'skills'));

    expect(
      resolveBuiltinSkillsPath({
        appPath: path.join(resDir, 'app.asar'),
        resourcesPath: resDir,
        moduleDir: path.join(root, 'dist-electron', 'main'),
      })
    ).toBe(skillsDir);
  });

  it('finds assets/skills via appPath when moduleDir depth does not match', () => {
    const root = makeTmpRoot();
    const skillsDir = path.join(root, 'assets', 'skills');
    makeSkillsDir(skillsDir);

    expect(
      resolveBuiltinSkillsPath({
        appPath: root,
        resourcesPath: undefined,
        moduleDir: path.join(root, 'somewhere', 'deep', 'nested'),
      })
    ).toBe(skillsDir);
  });

  it('returns empty string when no candidate exists', () => {
    const root = makeTmpRoot();
    expect(
      resolveBuiltinSkillsPath({
        appPath: path.join(root, 'app'),
        resourcesPath: path.join(root, 'empty-resources'),
        moduleDir: path.join(root, 'dist-electron', 'main'),
      })
    ).toBe('');
  });

  it('resolves the real repo assets/skills from src/main/skills (vitest layout)', () => {
    const moduleDir = path.join(ROOT, 'src', 'main', 'skills');
    const resolved = resolveBuiltinSkillsPath({
      appPath: ROOT,
      resourcesPath: undefined,
      moduleDir,
    });
    expect(resolved).toBe(path.join(ROOT, 'assets', 'skills'));
    expect(fs.existsSync(path.join(resolved, 'docx', 'SKILL.md'))).toBe(true);
  });
});
