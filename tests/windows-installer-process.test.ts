import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('windows installer process handling', () => {
  it('only targets the current sophron app names', () => {
    const builderConfig = fs.readFileSync(
      path.resolve(process.cwd(), 'electron-builder.yml'),
      'utf8'
    );
    const installerInclude = fs.readFileSync(
      path.resolve(process.cwd(), 'resources/installer.nsh'),
      'utf8'
    );

    expect(builderConfig).toContain('include: installer.nsh');
    expect(installerInclude).toContain('sophron cowork.exe');
    expect(installerInclude).toContain('九思助理.exe');
    expect(installerInclude.includes(['Metis', 'Cowork'].join(' '))).toBe(false);
    expect(installerInclude).not.toContain('customUnInstallCheck');
  });

  it('closes long-lived resources during quit cleanup', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/main/app/lifecycle.ts'),
      'utf8'
    );

    expect(source).toContain('closeDatabase();');
    expect(source).toContain('closeLogFile();');
    expect(source).toContain('stopNavServer();');
    expect(source).toContain(
      "await withTimeout(remoteManager.stop(), 5000, 'Remote control shutdown');"
    );
    expect(source).toContain("await withTimeout(mcpManager.shutdown(), 5000, 'MCP shutdown');");
  });
});
