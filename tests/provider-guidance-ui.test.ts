import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const configModalPath = path.resolve(process.cwd(), 'src/renderer/components/ConfigModal.tsx');
// SettingsPanel was split — API settings (including provider guidance) live in settings/SettingsAPI.tsx
const settingsPanelPath = path.resolve(process.cwd(), 'src/renderer/components/SettingsPanel.tsx');
const settingsDir = path.resolve(process.cwd(), 'src/renderer/components/settings');
const settingsPanelContent = [
  fs.readFileSync(settingsPanelPath, 'utf8'),
  ...fs.readdirSync(settingsDir).map((f) => fs.readFileSync(path.join(settingsDir, f), 'utf8')),
].join('\n');

describe('provider guidance UI wiring', () => {
  it('keeps common setup guidance in ConfigModal without field-level hints', () => {
    const source = fs.readFileSync(configModalPath, 'utf8');
    expect(source).toContain('CommonProviderSetupsCard');
    expect(source).toContain('onApplySetup={applyCommonProviderSetup}');
    expect(source).toContain('friendlyTestDetails');
    expect(source).toContain('VISIBLE_API_PROVIDER_OPTIONS');
    expect(source).not.toContain('GuidanceInlineHint');
    expect(source).not.toContain("t('api.selectProtocol')");
    expect(source).not.toContain("t('api.discoverLocalOllamaHint')");
  });

  it('keeps common setup guidance in SettingsPanel without field-level hints', () => {
    expect(settingsPanelContent).toContain('CommonProviderSetupsCard');
    expect(settingsPanelContent).toContain('onApplySetup={applyCommonProviderSetup}');
    expect(settingsPanelContent).toContain('<ApiDiagnosticsPanel');
    expect(settingsPanelContent).toContain('VISIBLE_API_PROVIDER_OPTIONS');
    expect(settingsPanelContent).not.toContain('GuidanceInlineHint');
    expect(settingsPanelContent).not.toContain("t('api.providerDescription')");
    expect(settingsPanelContent).not.toContain("t('api.apiKeyDescription')");
    expect(settingsPanelContent).not.toContain("t('api.selectProtocol')");
    expect(settingsPanelContent).not.toContain("t('api.contextWindowHint')");
    expect(settingsPanelContent).not.toContain("t('api.enableThinkingHint')");
    expect(settingsPanelContent).not.toContain("t('api.moreModels')");
  });
});
