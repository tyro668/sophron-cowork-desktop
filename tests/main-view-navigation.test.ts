import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const appPath = path.resolve(process.cwd(), 'src/renderer/App.tsx');
const sidebarPath = path.resolve(process.cwd(), 'src/renderer/components/Sidebar.tsx');
const storePath = path.resolve(process.cwd(), 'src/renderer/store/index.ts');
const dataViewPagePath = path.resolve(
  process.cwd(),
  'src/renderer/features/data/pages/DataViewPage.tsx'
);
const dataDashboardHookPath = path.resolve(
  process.cwd(),
  'src/renderer/features/data/hooks/use-data-dashboard.ts'
);
const tasksPanelPath = path.resolve(
  process.cwd(),
  'src/renderer/components/data-view/data-tasks/TasksPanel.tsx'
);
const skillsViewPath = path.resolve(process.cwd(), 'src/renderer/components/SkillsView.tsx');
const zhPath = path.resolve(process.cwd(), 'src/shared/i18n/locales/zh.json');

describe('main workspace navigation', () => {
  it('routes data and skills as independent main pages', () => {
    const app = fs.readFileSync(appPath, 'utf8');

    expect(app).toContain('const mainView = useMainView();');
    expect(app).toContain("id: 'skills' as MainPanelRouteId");
    expect(app).toContain("id: 'data' as MainPanelRouteId");
    expect(app).toContain('<SkillsView />');
    expect(app).toContain('<DataView />');
    expect(app).toContain("activeMainRouteId === 'chat'");
  });

  it('shows a dedicated data placeholder instead of the new chat surface', () => {
    const source = fs.readFileSync(dataViewPagePath, 'utf8');
    const dashboardHook = fs.readFileSync(dataDashboardHookPath, 'utf8');
    const tasksPanel = fs.readFileSync(tasksPanelPath, 'utf8');

    expect(dashboardHook).toContain('dataClient.getDashboard');
    expect(tasksPanel).toContain("t('data.newCleaningTask')");
    expect(source).toContain("'data.tabs.tasks'");
    expect(source).not.toContain('WelcomeView');
  });

  it('uses the reusable skills manager in the skills page', () => {
    const source = fs.readFileSync(skillsViewPath, 'utf8');

    expect(source).toContain("import { SettingsSkills } from './settings/SettingsSkills';");
    expect(source).toContain('<SettingsSkills isActive={true} />');
    expect(source).toContain('max-w-[1500px]');
  });

  it('exposes data, skills, and automation in the sidebar', () => {
    const source = fs.readFileSync(sidebarPath, 'utf8');

    expect(source).toContain("t('mainNav.data')");
    expect(source).toContain("t('mainNav.skills')");
    expect(source).toContain("t('mainNav.automation')");
    expect(source).toContain("setMainView('data')");
    expect(source).toContain("setMainView('skills')");
    expect(source).toContain("setMainView('automation')");
    expect(source).toContain('<Package className="w-4 h-4" />');
    expect(source).toContain('<Package className="h-4 w-4 flex-shrink-0" />');
  });

  it('stores the selected top-level view and supports nav-server page aliases', () => {
    // Behavioral coverage lives in tests/renderer/data-navigation-store.test.ts
    // (setMainView, __navigate aliases, nonce-guarded clearing). Keep only a
    // smoke check that the MainView union and nav-server bridge still exist.
    const source = fs.readFileSync(storePath, 'utf8');

    expect(source).toContain(
      "export type MainView = 'chat' | 'data' | 'cloud-data' | 'skills' | 'automation';"
    );
    expect(source).toContain('__navigate');
  });

  it('defines localized main nav labels', () => {
    const zh = JSON.parse(fs.readFileSync(zhPath, 'utf8'));

    expect(zh.mainNav.data).toBe('数据');
    expect(zh.mainNav.skills).toBe('技能');
    expect(zh.mainNav.automation).toBe('自动化');
    expect(zh.data.newCleaningTask).toBe('新建任务');
    expect(zh.data.tabs.tasks).toBe('数据任务');
  });
});
