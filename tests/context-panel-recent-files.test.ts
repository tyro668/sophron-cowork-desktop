import { desktopClient } from '../src/renderer/features/desktop/api/desktop-client';
import { afterEach, describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

const contextPanelPath = path.resolve(process.cwd(), 'src/renderer/components/ContextPanel.tsx');

afterEach(() => vi.unstubAllGlobals());

describe('ContextPanel recent workspace files integration', () => {
  it('loads recent workspace files through electron artifacts API', async () => {
    const source = fs.readFileSync(contextPanelPath, 'utf8');
    const list = vi.fn().mockResolvedValue([]);
    vi.stubGlobal('window', { electronAPI: { artifacts: { listRecentFiles: list } } });
    await desktopClient.listRecentFiles('/work', 10, 50);
    expect(list).toHaveBeenCalledWith('/work', 10, 50);
    expect(source).toContain('desktopClient.listRecentFiles');
    expect(source).toContain('setRecentWorkspaceFiles');
  });

  it('merges recent workspace files into the displayed artifacts list', () => {
    const source = fs.readFileSync(contextPanelPath, 'utf8');
    expect(source).toContain('const displayArtifacts = useMemo(() => {');
    expect(source).toContain('for (const file of recentWorkspaceFiles)');
  });

  it('opens html artifacts through the generated report viewer path', async () => {
    const source = fs.readFileSync(contextPanelPath, 'utf8');
    expect(source).toContain('isHtmlReportPath(artifactPath || label)');
    const report = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('window', { electronAPI: { openGeneratedReport: report } });
    expect(await desktopClient.openArtifact('out.html', '/work', true)).toBe(true);
    expect(report).toHaveBeenCalledWith('out.html', '/work');
  });

  it('opens artifacts with the default app instead of revealing their folder', async () => {
    const source = fs.readFileSync(contextPanelPath, 'utf8');
    expect(source).toContain('desktopClient.openArtifact');
    const openPath = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const showItemInFolder = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('window', { electronAPI: { openPath, showItemInFolder } });
    expect(await desktopClient.openArtifact('out.csv', '/work', false)).toBe(true);
    expect(showItemInFolder).not.toHaveBeenCalled();
    await desktopClient.openArtifact('out.csv', '/work', false);
    expect(showItemInFolder).toHaveBeenCalledWith('out.csv', '/work');
  });
});
