import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const remotePanelPath = path.resolve(
  process.cwd(),
  'src/renderer/components/RemoteControlPanel.tsx'
);

describe('RemoteControlPanel layout', () => {
  it('uses a flat shell instead of dashboard-heavy panels', () => {
    const source = fs.readFileSync(remotePanelPath, 'utf8');
    expect(source).toContain('rounded-2xl');
    expect(source).toContain('border-border-subtle');
  });

  it('disables configuration while the service is stopped', () => {
    const source = fs.readFileSync(remotePanelPath, 'utf8');
    expect(source).toContain('serviceRunning');
    expect(source).toContain('startToConfigure');
    expect(source).toContain("inert: ''");
  });
});
