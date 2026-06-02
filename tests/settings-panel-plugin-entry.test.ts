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
const settingsPanelContent = [
  settingsPanelSource,
  ...readdirSync(settingsDir).map((f) => readFileSync(path.join(settingsDir, f), 'utf8')),
].join('\n');

describe('Skills page plugin browse entry', () => {
  it('keeps skills out of the settings tab list', () => {
    expect(settingsPanelSource).not.toContain("id: 'skills' as TabId");
    expect(settingsPanelSource).not.toContain("t('settings.skills')");
    expect(settingsPanelSource).not.toContain("import { SettingsSkills }");
    expect(settingsPanelSource).not.toContain('<SettingsSkills');
  });

  it('uses a compact flat skills management layout', () => {
    expect(settingsSkillsSource).toContain('function SkillRow');
    expect(settingsSkillsSource).toContain('min-h-[64px]');
    expect(settingsSkillsSource).toContain('bg-background/70 px-3 py-3');
    expect(settingsSkillsSource).not.toContain('SettingsContentSection');
    expect(settingsSkillsSource).not.toContain("t('skills.storagePathHint')");
    expect(settingsSkillsSource).not.toContain("t('skills.builtinSkillsDesc')");
    expect(settingsSkillsSource).not.toContain("t('skills.pluginsDesc')");
  });

  it('unit: renders browse plugins action', () => {
    expect(settingsSkillsSource).toContain("t('skills.browsePlugins')");
  });

  it('smoke: includes plugin list modal title i18n key', () => {
    expect(settingsSkillsSource).toContain("t('skills.pluginListTitle')");
  });

  it('functional: includes plugin install action i18n key', () => {
    expect(settingsSkillsSource).toContain("t('skills.pluginInstall')");
  });

  it('functional: includes skills storage controls', () => {
    expect(settingsPanelContent).toContain("t('skills.storagePathTitle')");
    expect(settingsPanelContent).toContain("t('skills.selectStoragePath')");
    expect(settingsPanelContent).toContain("t('skills.openStoragePath')");
    expect(settingsPanelContent).toContain("t('skills.refreshSkills')");
    expect(settingsPanelContent).toContain('window.electronAPI.skills.getStoragePath()');
    expect(settingsPanelContent).toContain('window.electronAPI.skills.setStoragePath(folderPath, true)');
    expect(settingsPanelContent).toContain('window.electronAPI.skills.openStoragePath()');
    expect(settingsPanelContent).toContain('Promise.allSettled([');
    expect(settingsPanelContent).toContain("throw new Error(errors.join(' | '));");
    expect(settingsPanelContent).toContain("`${tRef.current('skills.failedToLoad')}: ${err.message}`");
    expect(settingsPanelContent).toContain('await loadSkills();');
  });

  it('functional: uses plugins API for catalog and management', () => {
    expect(settingsPanelContent).toContain('window.electronAPI.plugins.listCatalog');
    expect(settingsPanelContent).toContain('window.electronAPI.plugins.listInstalled');
    expect(settingsPanelContent).toContain('window.electronAPI.plugins.install(installTarget)');
    expect(settingsPanelContent).toContain('window.electronAPI.plugins.setComponentEnabled');
    expect(settingsPanelContent).toContain("t('skills.pluginManageUninstall')");
  });

  it('functional: handles marketplace catalog items with unknown component counts', () => {
    expect(settingsPanelContent).toContain("plugin.catalogSource === 'claude-marketplace'");
    expect(settingsPanelContent).toContain("t('skills.pluginComponentsAvailableAfterInstall')");
  });

  it('functional: matches installed plugins using normalized lookup keys', () => {
    expect(settingsPanelContent).toContain('normalizePluginLookupKey');
    expect(settingsPanelContent).toContain('getCatalogLookupKeys');
    expect(settingsPanelContent).toContain('installedPluginsByKey');
  });
});
