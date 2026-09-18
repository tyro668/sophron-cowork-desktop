import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '../..');

function asset(relativePath: string): Buffer {
  return fs.readFileSync(path.join(projectRoot, relativePath));
}

function pngSize(data: Buffer): [number, number] {
  expect(data.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

function pngPixel(data: Buffer, x: number, y: number): [number, number, number, number] {
  const [width, height] = pngSize(data);
  expect(data[24]).toBe(8); // 8-bit channels
  expect(data[25]).toBe(6); // RGBA
  expect(data[28]).toBe(0); // no interlace
  expect(x).toBeLessThan(width);
  expect(y).toBeLessThan(height);

  const chunks: Buffer[] = [];
  for (let offset = 8; offset < data.length; ) {
    const length = data.readUInt32BE(offset);
    const kind = data.toString('ascii', offset + 4, offset + 8);
    if (kind === 'IDAT') chunks.push(data.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (kind === 'IEND') break;
  }

  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  let previous = Buffer.alloc(stride);
  let offset = 0;
  for (let row = 0; row <= y; row += 1) {
    const filter = raw[offset++];
    const current = Buffer.from(raw.subarray(offset, offset + stride));
    offset += stride;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= 4 ? current[i - 4] : 0;
      const up = previous[i];
      const upperLeft = i >= 4 ? previous[i - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      if (filter === 2) predictor = up;
      if (filter === 3) predictor = Math.floor((left + up) / 2);
      if (filter === 4) {
        const estimate = left + up - upperLeft;
        const leftDistance = Math.abs(estimate - left);
        const upDistance = Math.abs(estimate - up);
        const upperLeftDistance = Math.abs(estimate - upperLeft);
        predictor =
          leftDistance <= upDistance && leftDistance <= upperLeftDistance
            ? left
            : upDistance <= upperLeftDistance
              ? up
              : upperLeft;
      }
      current[i] = (current[i] + predictor) & 0xff;
    }
    if (row === y) {
      const pixel = x * 4;
      return [current[pixel], current[pixel + 1], current[pixel + 2], current[pixel + 3]];
    }
    previous = current;
  }
  throw new Error('PNG row was not found');
}

describe('approved Jiusi brand assets', () => {
  it('uses the same standard icon for app resources and both websites', () => {
    const locations = [
      'resources/icon.png',
      'resources/logo.png',
      'public/logo.png',
      'website/public/logo.png',
    ];
    const hashes = locations.map((location) =>
      createHash('sha256').update(asset(location)).digest('hex')
    );
    expect(new Set(hashes).size).toBe(1);
    expect(pngSize(asset(locations[0]))).toEqual([1024, 1024]);
  });

  it('keeps a transparent UI mark and inset macOS variant', () => {
    const standard = asset('resources/icon.png');
    const ui = asset('src/renderer/assets/logo.png');
    const mac = asset('resources/icon-mac.png');
    expect(pngSize(ui)).toEqual([1024, 1024]);
    expect(pngSize(mac)).toEqual([1024, 1024]);
    expect(ui.equals(standard)).toBe(false);
    expect(mac.equals(standard)).toBe(false);
    expect(mac.equals(asset('resources/icon.iconset/icon_512x512@2x.png'))).toBe(true);

    expect(pngPixel(ui, 512, 120)[3]).toBe(0);
    expect(pngPixel(ui, 512, 500)[3]).toBeGreaterThan(240);
    expect(pngPixel(standard, 512, 120)).toEqual([234, 246, 238, 255]);
    expect(pngPixel(mac, 512, 80)[3]).toBe(0);
    expect(pngPixel(standard, 512, 80)[3]).toBeGreaterThan(240);

    const runtimeIcons = fs.readFileSync(
      path.join(projectRoot, 'src/main/app/brand-icons.ts'),
      'utf8'
    );
    expect(runtimeIcons).toContain("'icon-mac.png'");
    expect(runtimeIcons).toContain("'icon-fold-mac.png'");
  });

  it('exports the collaborative fold as a separate complete runtime set', () => {
    const standard = asset('resources/icon-fold.png');
    const mac = asset('resources/icon-fold-mac.png');
    const ui = asset('src/renderer/assets/logo-fold.png');
    expect(pngSize(standard)).toEqual([1024, 1024]);
    expect(pngSize(mac)).toEqual([1024, 1024]);
    expect(pngSize(ui)).toEqual([1024, 1024]);
    expect(pngPixel(standard, 512, 512)).toEqual([255, 255, 255, 255]);
    expect(pngPixel(ui, 512, 512)[3]).toBe(0);
    expect(pngPixel(ui, 250, 500)[3]).toBeGreaterThan(240);
    expect(pngPixel(mac, 512, 80)[3]).toBe(0);
    expect(pngSize(asset('resources/tray-icon-fold.png'))).toEqual([32, 32]);
    expect(pngSize(asset('resources/tray-icon-foldTemplate.png'))).toEqual([32, 32]);
    for (const name of ['icon-fold.ico', 'tray-icon-fold.ico']) {
      expect(asset(`resources/${name}`).readUInt16LE(4)).toBeGreaterThanOrEqual(5);
    }
    expect(asset('resources/icon-fold.icns').toString('ascii', 0, 4)).toBe('icns');
  });

  it('provides small web and tray sizes and a full social preview', () => {
    expect(pngSize(asset('public/favicon.png'))).toEqual([32, 32]);
    expect(pngSize(asset('resources/tray-icon.png'))).toEqual([32, 32]);
    expect(pngSize(asset('resources/tray-iconTemplate.png'))).toEqual([32, 32]);
    expect(pngSize(asset('website/public/og-image.png'))).toEqual([1280, 640]);
  });

  it('provides multi-resolution Windows icons and a macOS icon', () => {
    for (const name of ['icon.ico', 'tray-icon.ico']) {
      const ico = asset(`resources/${name}`);
      expect(ico.readUInt16LE(0)).toBe(0);
      expect(ico.readUInt16LE(2)).toBe(1);
      expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(5);
    }
    expect(asset('resources/icon.icns').toString('ascii', 0, 4)).toBe('icns');
  });

  it('keeps the main-process tray paths aligned with exported assets', () => {
    const traySource = fs.readFileSync(path.join(projectRoot, 'src/main/app/tray.ts'), 'utf8');
    const runtimeIcons = fs.readFileSync(
      path.join(projectRoot, 'src/main/app/brand-icons.ts'),
      'utf8'
    );
    expect(traySource).toContain("getTrayIconPath(configStore.get('logoVariant'))");
    expect(runtimeIcons).toContain('tray-icon${suffix}${extension}');
    expect(runtimeIcons).toContain("'Template.png'");
    expect(traySource).not.toContain('appContext.tray-icon');
  });

  it('packages runtime icons where the main process reads them', () => {
    const loadConfig = createRequire(path.join(projectRoot, 'package.json'));
    const buildConfig = loadConfig('./electron-builder.config.cjs') as Record<
      'mac' | 'win' | 'linux',
      { extraResources: Array<{ from: string; to: string }> }
    >;
    const expected = {
      mac: [
        'icon.icns',
        'icon-fold.icns',
        'icon-mac.png',
        'icon-fold-mac.png',
        'tray-iconTemplate.png',
        'tray-icon-foldTemplate.png',
      ],
      win: [
        'icon.ico',
        'icon-fold.ico',
        'tray-icon.ico',
        'tray-icon-fold.ico',
        'tray-icon.png',
        'tray-icon-fold.png',
      ],
      linux: ['icon.png', 'icon-fold.png', 'tray-icon.png', 'tray-icon-fold.png'],
    };
    for (const platform of ['mac', 'win', 'linux'] as const) {
      for (const name of expected[platform]) {
        expect(buildConfig[platform].extraResources).toContainEqual({
          from: `resources/${name}`,
          to: name,
        });
      }
    }
  });
});
