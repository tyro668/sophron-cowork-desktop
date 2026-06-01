import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const appPath = path.resolve(process.cwd(), 'src/renderer/App.tsx');
const sidebarPath = path.resolve(process.cwd(), 'src/renderer/components/Sidebar.tsx');
const storePath = path.resolve(process.cwd(), 'src/renderer/store/index.ts');
const dataViewPath = path.resolve(process.cwd(), 'src/renderer/components/DataView.tsx');
const skillsViewPath = path.resolve(process.cwd(), 'src/renderer/components/SkillsView.tsx');
const zhPath = path.resolve(process.cwd(), 'src/renderer/i18n/locales/zh.json');

describe('main workspace navigation', () => {
  it('routes data and skills as independent main pages', () => {
    const app = fs.readFileSync(appPath, 'utf8');

    expect(app).toContain('const mainView = useMainView();');
    expect(app).toContain("mainView === 'skills'");
    expect(app).toContain("mainView === 'data'");
    expect(app).toContain('<SkillsView />');
    expect(app).toContain('<DataView />');
    expect(app).toContain("activeSessionId && !showSettings && mainView === 'chat'");
  });

  it('shows a dedicated data placeholder instead of the new chat surface', () => {
    const source = fs.readFileSync(dataViewPath, 'utf8');

    expect(source).toContain("window.electronAPI.data.getDashboard");
    expect(source).toContain("t('data.newCleaningTask')");
    expect(source).toContain("t('data.tabs.tasks')");
    expect(source).not.toContain('WelcomeView');
  });

  it('uses the reusable skills manager in the skills page', () => {
    const source = fs.readFileSync(skillsViewPath, 'utf8');

    expect(source).toContain("import { SettingsSkills } from './settings/SettingsSkills';");
    expect(source).toContain('<SettingsSkills isActive={true} />');
    expect(source).toContain("t('skills.pageTitle')");
  });

  it('exposes data, skills, and tasks in the sidebar', () => {
    const source = fs.readFileSync(sidebarPath, 'utf8');

    expect(source).toContain("t('mainNav.data')");
    expect(source).toContain("t('mainNav.skills')");
    expect(source).toContain("t('mainNav.tasks')");
    expect(source).toContain("setMainView('data')");
    expect(source).toContain("setMainView('skills')");
    expect(source).toContain("setMainView('chat')");
  });

  it('stores the selected top-level view and supports nav-server page aliases', () => {
    const source = fs.readFileSync(storePath, 'utf8');

    expect(source).toContain("export type MainView = 'chat' | 'data' | 'skills';");
    expect(source).toContain("mainView: 'chat'");
    expect(source).toContain("...(sessionId ? { mainView: 'chat' as const } : {})");
    expect(source).toContain("page === 'welcome'");
    expect(source).toContain("page === 'data'");
    expect(source).toContain("page === 'skills'");
  });

  it('defines localized main nav labels', () => {
    const zh = JSON.parse(fs.readFileSync(zhPath, 'utf8'));

    expect(zh.mainNav.data).toBe('数据');
    expect(zh.mainNav.skills).toBe('技能');
    expect(zh.mainNav.tasks).toBe('任务');
    expect(zh.data.newCleaningTask).toBe('新建任务');
    expect(zh.data.tabs.tasks).toBe('数据任务');
  });
});
