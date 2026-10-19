import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shell } from 'electron';
import { openLocalFile } from '../src/main/app/file-open';

vi.mock('../src/main/app/workdir', () => ({
  DEFAULT_WORKING_DIR_NAME: 'default_working_dir',
  LEGACY_DEFAULT_WORKING_DIR_NAME: 'legacy_working_dir',
  getWorkingDir: () => '',
}));

describe('openLocalFile', () => {
  let dir: string;
  let openPath: ReturnType<typeof vi.spyOn>;
  let showItemInFolder: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-path-'));
    openPath = vi.spyOn(shell, 'openPath').mockResolvedValue('');
    showItemInFolder = vi.spyOn(shell, 'showItemInFolder');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('opens the file itself (not its folder) for a Chinese file name', async () => {
    const file = path.join(dir, '销售分析报告.xlsx');
    fs.writeFileSync(file, 'x');
    await expect(openLocalFile(file, dir)).resolves.toBe(true);
    expect(openPath).toHaveBeenCalledWith(file);
    expect(showItemInFolder).not.toHaveBeenCalled();
  });

  it('decodes URL-encoded and file:// paths before opening', async () => {
    const file = path.join(dir, '销售分析简报.docx');
    fs.writeFileSync(file, 'x');
    await expect(openLocalFile(`file://${encodeURI(file)}`)).resolves.toBe(true);
    expect(openPath).toHaveBeenCalledWith(file);
  });

  it('resolves relative paths against the session cwd', async () => {
    fs.writeFileSync(path.join(dir, 'clean_report.py'), 'print(1)');
    await expect(openLocalFile('clean_report.py', dir)).resolves.toBe(true);
    expect(openPath).toHaveBeenCalledWith(path.join(dir, 'clean_report.py'));
  });

  it('reports failure when the default app cannot be launched', async () => {
    const file = path.join(dir, 'a.xlsx');
    fs.writeFileSync(file, 'x');
    openPath.mockResolvedValue('Failed to open path');
    await expect(openLocalFile(file, dir)).resolves.toBe(false);
  });

  it('reports failure for a missing file instead of opening its folder', async () => {
    await expect(openLocalFile(path.join(dir, 'missing.xlsx'), dir)).resolves.toBe(false);
    expect(openPath).not.toHaveBeenCalled();
  });
});
