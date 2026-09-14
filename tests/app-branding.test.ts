import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const require = createRequire(import.meta.url);

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(root, relativePath), 'utf8');
}

describe('application branding', () => {
  it('keeps sophron as the internal package identity', () => {
    expect(JSON.parse(read('package.json')).name).toBe('sophron');
    expect(read('src/shared/branding.ts')).toContain("APP_INTERNAL_NAME = 'sophron'");
    expect(read('electron-builder.config.cjs')).toContain("name: 'sophron'");
  });

  it('defines English and Chinese product names for packaged variants', () => {
    const { getBrand } = require('../scripts/sophron-brand.cjs');

    expect(getBrand('sophron').productName).toBe('sophron cowork');
    expect(getBrand('sophron').artifactName).toBe('sophron');
    expect(getBrand('sophron-cn').productName).toBe('九思助理');
    expect(getBrand('sophron-cn').artifactName).toBe('sophron-cn');
    expect(read('package.json')).toContain('"build:sophron"');
    expect(read('package.json')).toContain('"build:sophron-cn"');
  });

  it('uses localized app names in renderer surfaces', () => {
    expect(read('src/renderer/i18n/locales/en.json')).toContain('"appName": "sophron cowork"');
    expect(read('src/renderer/i18n/locales/zh.json')).toContain('"appName": "九思助理"');
    expect(read('src/renderer/components/Sidebar.tsx')).toContain("t('common.appName')");
    expect(read('src/renderer/components/settings/SettingsGeneral.tsx')).toContain(
      "t('common.appName')"
    );
  });

  it('uses runtime product name in main-process user-facing messages', () => {
    expect(read('src/main/index.ts')).toContain('function getRuntimeAppName()');
    expect(read('src/main/index.ts')).toContain('tray.setToolTip(getRuntimeAppName())');
    expect(read('src/main/index.ts')).toContain('getRuntimeAppName()} 启动失败');
    expect(read('src/main/prompts/main-agent-system.txt')).toContain(
      'You are sophron cowork (九思助理 in Chinese)'
    );
  });
});
