import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

const contextPanelPath = path.resolve(process.cwd(), 'src/renderer/components/ContextPanel.tsx');

describe('ContextPanel recent workspace files integration', () => {
  it('loads recent workspace files through electron artifacts API', () => {
    const source = fs.readFileSync(contextPanelPath, 'utf8');
    expect(source).toContain('window.electronAPI?.artifacts?.listRecentFiles');
    expect(source).toContain('setRecentWorkspaceFiles');
  });

  it('merges recent workspace files into the displayed artifacts list', () => {
    const source = fs.readFileSync(contextPanelPath, 'utf8');
    expect(source).toContain('const displayArtifacts = useMemo(() => {');
    expect(source).toContain('for (const file of recentWorkspaceFiles)');
  });

  it('opens html artifacts through the generated report viewer path', () => {
    const source = fs.readFileSync(contextPanelPath, 'utf8');
    expect(source).toContain('isHtmlReportPath(artifactPath || label)');
    expect(source).toContain('api.openGeneratedReport');
  });
});
