import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const welcomeViewPath = path.resolve(process.cwd(), 'src/renderer/components/WelcomeView.tsx');

describe('WelcomeView Claude-style layout', () => {
  it('uses a narrower landing column without the app brand or logo in the composer view', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');
    expect(source).toContain('max-w-[840px]');
    expect(source).toContain("t('welcome.title')");
    expect(source).not.toContain('welcomeLogoSrc');
    expect(source).not.toContain("t('welcome.logoAlt')");
    expect(source).not.toContain('sophron cowork');
  });

  it('uses the shared rounded composer shell treatment with file, directory, model, and start controls', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');
    expect(source).toContain('rounded-[28px]');
    expect(source).toContain('bg-background');
    expect(source).toContain('shadow-soft');
    expect(source).toContain('onClick={handleFileSelect}');
    expect(source).toContain("t('welcome.attachFiles')");
    expect(source).toContain('PermissionPolicySelector');
    expect(source).toContain('showPermissionMenu');
    expect(source).toContain('handlePermissionMenuOpenChange');
    expect(source).toContain("t('welcome.selectWorkingFolder')");
    expect(source).toContain('const hasConfiguredModel = Boolean');
    expect(source).toContain('const handleModelButtonClick = () => {');
    expect(source).toContain('if (!hasConfiguredModel) {');
    expect(source).toContain('handleOpenModelSettings();');
    expect(source).toContain('setShowModelMenu((open) => !open);');
    expect(source).toContain('onClick={handleModelButtonClick}');
    expect(source).toContain('showModelMenu && hasConfiguredModel');
    expect(source).toContain("t('welcome.letsGo')");
  });

  it('shows an inline API setup hint on the welcome screen when config is missing', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');
    expect(source).toContain('!isConfigured && (');
    expect(source).toContain("t('welcome.apiNotConfigured')");
    expect(source).toContain("setSettingsTab('api');");
    expect(source).toContain('setShowSettings(true);');
  });
});
