import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const settingsPanelPath = path.resolve(process.cwd(), 'src/renderer/components/SettingsPanel.tsx');
const settingsSkillsPath = path.resolve(
  process.cwd(),
  'src/renderer/components/settings/SettingsSkills.tsx'
);
const settingsDir = path.resolve(process.cwd(), 'src/renderer/components/settings');
const settingsPanelSource = readFileSync(settingsPanelPath, 'utf8');
const settingsSkillsSource = readFileSync(settingsSkillsPath, 'utf8');

function readSourceTree(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? readSourceTree(entryPath) : [readFileSync(entryPath, 'utf8')];
  });
}

const settingsPanelContent = [settingsPanelSource, ...readSourceTree(settingsDir)].join('\n');

describe('Skills page plugin browse entry', () => {
  it('keeps skills out of the settings tab list', () => {
    expect(settingsPanelSource).not.toContain("id: 'skills' as TabId");
    expect(settingsPanelSource).not.toContain("t('settings.skills')");
    expect(settingsPanelSource).not.toContain('import { SettingsSkills }');
    expect(settingsPanelSource).not.toContain('<SettingsSkills');
  });

  it('uses the data-workspace table and detail layout', () => {
    expect(settingsSkillsSource).toContain('function SkillTableRow');
    expect(settingsSkillsSource).toContain('activeWorkspaceTab');
    expect(settingsSkillsSource).toContain('SKILL_TABLE_PAGE_SIZE');
    expect(settingsSkillsSource).toContain('xl:grid-cols-[minmax(0,1fr)_320px]');
    expect(settingsSkillsSource).toContain("t('skills.workspace.table.skill')");
  });

  it('switches to the online market through the workspace tab', () => {
    expect(settingsSkillsSource).toContain('const handleBrowseMarket = async () => {');
    expect(settingsSkillsSource).toContain("setActiveWorkspaceTab('market')");
    expect(settingsSkillsSource).toContain("t('skills.workspace.marketTab')");
  });

  it('functional: includes plugin install action i18n key', () => {
    expect(settingsSkillsSource).toContain("t('skills.pluginInstall')");
  });

  it('functional: includes skill refresh, install, toggle, and open controls', () => {
    expect(settingsPanelContent).toContain("t('skills.refreshSkills')");
    expect(settingsPanelContent).toContain('window.electronAPI.skills.install(folderPath)');
    expect(settingsPanelContent).toContain('window.electronAPI.skills.setEnabled');
    expect(settingsPanelContent).toContain('window.electronAPI.skills.openSkillPath');
    expect(settingsPanelContent).toContain(
      "`${tRef.current('skills.failedToLoad')}: ${err.message}`"
    );
    expect(settingsPanelContent).toContain('await loadSkills();');
  });

  it('functional: uses plugins API for catalog and management', () => {
    expect(settingsPanelContent).toContain('window.electronAPI.plugins.listCatalog');
    expect(settingsPanelContent).toContain('window.electronAPI.plugins.listInstalled');
    expect(settingsPanelContent).toContain('window.electronAPI.plugins.install(installTarget)');
    expect(settingsPanelContent).toContain('window.electronAPI.skills.installFromSkillHub(slug)');
    expect(settingsPanelContent).toContain("t('skills.pluginManageUninstall')");
  });

  it('functional: paginates marketplace results without duplicating plugins', () => {
    expect(settingsPanelContent).toContain('pluginPageRef.current + 1');
    expect(settingsPanelContent).toContain('const seen = new Set(current.map');
    expect(settingsPanelContent).toContain('setHasMorePlugins');
  });

  it('functional: matches installed plugins using normalized lookup keys', () => {
    expect(settingsPanelContent).toContain('normalizePluginLookupKey');
    expect(settingsPanelContent).toContain('getCatalogLookupKeys');
    expect(settingsPanelContent).toContain('installedPluginsByKey');
  });
});
