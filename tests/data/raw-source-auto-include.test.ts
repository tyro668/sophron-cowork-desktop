import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../../src/main/data/data-pipeline-store';

const roots: string[] = [];
const stores: DataPipelineStore[] = [];
afterEach(() => {
  while (stores.length) stores.pop()?.close();
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-autoinc-'));
  roots.push(root);
  const dir = path.join(root, 'in');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'a.csv'), 'x,y\n1,2\n');
  fs.writeFileSync(path.join(dir, 'b.csv'), 'x,y\n3,4\n');
  const store = createDataPipelineStore(path.join(root, 'w.duckdb'));
  stores.push(store);
  return { store, dir, root };
}

describe('setRawSourceAutoInclude', () => {
  it('persists the toggle for multi-table sources', async () => {
    const { store, dir } = setup();
    const { source } = await store.createRawSource({
      sourcePath: dir,
      buildMode: 'folder_per_file',
    });
    expect(source.config.autoInclude).toBe(true);
    const off = await store.setRawSourceAutoInclude(source.id, false);
    expect(off.config.autoInclude).toBe(false);
    expect((await store.getRawSource(source.id))?.config.autoInclude).toBe(false);
    // other config is preserved
    expect(off.config.knownMembers).toEqual(source.config.knownMembers);
    await store.setRawSourceAutoInclude(source.id, true);
    expect((await store.getRawSource(source.id))?.config.autoInclude).toBe(true);
  });

  it('rejects turning it on for single-table sources and unknown ids', async () => {
    const { store, root } = setup();
    const file = path.join(root, 'one.csv');
    fs.writeFileSync(file, 'x\n1\n');
    const { source } = await store.createRawSource({ sourcePath: file, buildMode: 'single' });
    await expect(store.setRawSourceAutoInclude(source.id, true)).rejects.toThrow(/E_AUTO_INCLUDE/);
    await expect(store.setRawSourceAutoInclude('nope', false)).rejects.toThrow();
  });
});
