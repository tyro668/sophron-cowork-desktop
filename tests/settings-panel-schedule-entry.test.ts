import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const automationViewPath = path.resolve(
  process.cwd(),
  'src/renderer/components/AutomationView.tsx'
);
const settingsPanelPath = path.resolve(process.cwd(), 'src/renderer/components/SettingsPanel.tsx');
const settingsDir = path.resolve(process.cwd(), 'src/renderer/components/settings');

function readSourceTree(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? readSourceTree(entryPath) : [readFileSync(entryPath, 'utf8')];
  });
}

const settingsPanelSource = readFileSync(settingsPanelPath, 'utf8');
const automationSource = [
  readFileSync(automationViewPath, 'utf8'),
  ...readSourceTree(settingsDir),
].join('\n');

describe('Automation workspace', () => {
  it('renders automation as an independent workspace', () => {
    expect(automationSource).toContain(
      "import { SettingsSchedule } from './settings/SettingsSchedule';"
    );
    expect(automationSource).toContain('<SettingsSchedule isActive={isActive} />');
    expect(automationSource).toContain('max-w-[1120px]');
    expect(settingsPanelSource).not.toContain("id: 'schedule' as TabId");
  });

  it('loads automations, action definitions, data resources, and run history', () => {
    expect(automationSource).toContain('window.electronAPI.automation.list()');
    expect(automationSource).toContain('window.electronAPI.automation.listActionDefinitions()');
    expect(automationSource).toContain('window.electronAPI.data.getDashboard({');
    expect(automationSource).toContain('window.electronAPI.automation.listRuns(automation.id');
  });

  it('ignores stale asynchronous list and run-history responses', () => {
    expect(automationSource).toContain('const loadRequestSeq = useRef(0)');
    expect(automationSource).toContain('const loadRunsRequestSeq = useRef(0)');
    expect(automationSource).toContain('requestId !== loadRequestSeq.current');
    expect(automationSource).toContain('requestId !== loadRunsRequestSeq.current');
  });

  it('polls only while an automation is running', () => {
    expect(automationSource).toContain('if (!isActive || !hasRunningAutomation) return;');
    expect(automationSource).toContain('void load({ silent: true });');
    expect(automationSource).toContain('window.clearInterval(timer)');
  });

  it('validates schedule-specific and action-specific requirements before saving', () => {
    expect(automationSource).toContain("tr('schedule.weekdayRequired'");
    expect(automationSource).toContain("tr('schedule.monthDayRequired'");
    expect(automationSource).toContain("tr('schedule.endAtAfterStartRequired'");
    expect(automationSource).toContain('validateEnabledActionNodes(draft, tr)');
    expect(automationSource).toContain("tr('schedule.cloudSourceRequired'");
    expect(automationSource).toContain("tr('schedule.cloudTargetRequired'");
  });

  it('supports all current trigger modes in the normalized model', () => {
    expect(automationSource).toContain("kind: 'once'");
    expect(automationSource).toContain("kind: 'daily'");
    expect(automationSource).toContain("kind: 'weekly'");
    expect(automationSource).toContain("kind: 'monthly'");
    expect(automationSource).toContain("kind: 'interval'");
    expect(automationSource).toContain("kind: 'file_change'");
  });

  it('renders list, run history, and the full editor sections', () => {
    expect(automationSource).toContain('<AutomationListPanel');
    expect(automationSource).toContain('<AutomationRunLogPanel');
    expect(automationSource).toContain('<TaskStatusSection');
    expect(automationSource).toContain('<ExecutionProjectPanel');
    expect(automationSource).toContain('<TriggerConditionPanel');
    expect(automationSource).toContain('<ActionChainSection');
  });

  it('formats missing next-run values and manual triggers explicitly', () => {
    expect(automationSource).toContain("automation.trigger.kind === 'manual'");
    expect(automationSource).toContain("tr('schedule.noAutoTrigger', '无自动触发')");
    expect(automationSource).toContain(
      "automation.nextRunAt ? formatAppDateTime(automation.nextRunAt) : '-'"
    );
  });

  it('creates, updates, runs, and deletes through the automation API', () => {
    expect(automationSource).toContain(
      'window.electronAPI.automation.update(selectedAutomation.id, payload)'
    );
    expect(automationSource).toContain(
      'window.electronAPI.automation.create(payload as AutomationCreateInput)'
    );
    expect(automationSource).toContain(
      'window.electronAPI.automation.runNow(selectedAutomation.id)'
    );
    expect(automationSource).toContain(
      'window.electronAPI.automation.delete(selectedAutomation.id)'
    );
  });
});
