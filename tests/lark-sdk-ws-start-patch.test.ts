import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Lark SDK WebSocket start patch', () => {
  it('ships and applies the awaited initial connection patch', () => {
    const patchPath = path.resolve(process.cwd(), 'patches/@larksuiteoapi+node-sdk+1.59.0.patch');
    const installedCjsPath = path.resolve(
      process.cwd(),
      'node_modules/@larksuiteoapi/node-sdk/lib/index.js'
    );
    const patchSource = readFileSync(patchPath, 'utf8');
    const installedSource = readFileSync(installedCjsPath, 'utf8');

    expect(patchSource).toContain('+            yield this.reConnect(true);');
    expect(installedSource).toContain('yield this.reConnect(true);');
  });
});
