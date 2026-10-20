import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listRecentWorkspaceFiles } from '../src/main/utils/recent-workspace-files';

// File timestamps come from the kernel's coarse clock, which can lag Date.now()
// by a scheduler tick (4-10ms). Writing "5ms after" a timestamp therefore does
// not guarantee mtime >= timestamp, which made these tests flaky under load.
// Pin the mtime explicitly instead of relying on wall-clock sleeps.
async function writeAt(filePath: string, content: string, mtimeMs: number) {
  await fs.writeFile(filePath, content);
  const at = new Date(mtimeMs);
  await fs.utimes(filePath, at, at);
}

describe('listRecentWorkspaceFiles', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sophron-recent-files-'));
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('returns files created after the given timestamp', async () => {
    const before = Date.now();

    const filePath = path.join(rootDir, 'deck.pptx');
    await writeAt(filePath, 'ppt', before + 1_000);

    const files = await listRecentWorkspaceFiles(rootDir, before);

    expect(files.map((item) => path.basename(item.path))).toContain('deck.pptx');
  });

  it('ignores files inside excluded directories', async () => {
    const before = Date.now();

    await fs.mkdir(path.join(rootDir, 'node_modules'), { recursive: true });
    await writeAt(path.join(rootDir, 'node_modules', 'ignored.txt'), 'ignore', before + 1_000);
    await writeAt(path.join(rootDir, 'report.html'), 'ok', before + 1_000);

    const files = await listRecentWorkspaceFiles(rootDir, before);

    expect(files.map((item) => path.basename(item.path))).toContain('report.html');
    expect(files.map((item) => path.basename(item.path))).not.toContain('ignored.txt');
  });

  it('ignores system metadata files like .DS_Store', async () => {
    const before = Date.now();

    await writeAt(path.join(rootDir, '.DS_Store'), 'noise', before + 1_000);
    await writeAt(path.join(rootDir, 'slides.pptx'), 'ppt', before + 1_000);

    const files = await listRecentWorkspaceFiles(rootDir, before);

    expect(files.map((item) => path.basename(item.path))).toContain('slides.pptx');
    expect(files.map((item) => path.basename(item.path))).not.toContain('.DS_Store');
  });

  it('ignores common temp, lock, and backup file patterns', async () => {
    const before = Date.now();

    const noiseFiles = [
      '._slides.pptx',
      '~$deck.pptx',
      '.~lock.deck.pptx#',
      'draft.md~',
      'report.tmp',
      'download.crdownload',
    ];

    for (const name of noiseFiles) {
      await writeAt(path.join(rootDir, name), 'noise', before + 1_000);
    }
    await writeAt(path.join(rootDir, 'real-output.pdf'), 'pdf', before + 1_000);

    const files = await listRecentWorkspaceFiles(rootDir, before);
    const names = files.map((item) => path.basename(item.path));

    expect(names).toContain('real-output.pdf');
    for (const name of noiseFiles) {
      expect(names).not.toContain(name);
    }
  });

  it('ignores cache directories like __pycache__', async () => {
    const before = Date.now();

    await fs.mkdir(path.join(rootDir, '__pycache__'), { recursive: true });
    await writeAt(
      path.join(rootDir, '__pycache__', 'script.cpython-311.pyc'),
      'pyc',
      before + 1_000
    );
    await writeAt(path.join(rootDir, 'presentation.pptx'), 'ppt', before + 1_000);

    const files = await listRecentWorkspaceFiles(rootDir, before);
    const names = files.map((item) => path.basename(item.path));

    expect(names).toContain('presentation.pptx');
    expect(names).not.toContain('script.cpython-311.pyc');
  });

  it('orders results by most recent change first', async () => {
    const before = Date.now();

    const older = path.join(rootDir, 'older.txt');
    const newer = path.join(rootDir, 'newer.txt');
    await writeAt(older, '1', before + 1_000);
    await writeAt(newer, '2', before + 2_000);

    const files = await listRecentWorkspaceFiles(rootDir, before);

    expect(files[0]?.path).toBe(newer);
    expect(files[1]?.path).toBe(older);
  });
});
