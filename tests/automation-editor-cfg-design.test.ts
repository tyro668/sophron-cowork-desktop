import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { formatNextRun } from '../src/renderer/components/settings/schedule/editorPanels';

const read = (f: string) => fs.readFileSync(path.resolve(process.cwd(), f), 'utf8');
const dir = 'src/renderer/components/settings/schedule/';

describe('automation editor follows config design c01–c04', () => {
  const panels = read(dir + 'editorPanels.tsx');
  const actions = read(dir + 'action-config-editors.tsx');

  it('uses full-width dropdowns for 触发方式 / 执行频率 / 处理方式 / 失败时 (no segments)', () => {
    expect(panels).not.toContain('SegmentedControl');
    expect(actions).not.toContain('SegmentedControl');
    for (const label of ['触发方式', '执行频率']) {
      expect(panels).toMatch(new RegExp(`ariaLabel=\\{tr\\('schedule\\.\\w+', '${label}'\\)\\}`));
    }
    expect(actions).toContain("ariaLabel={tr('schedule.dataProcessModeLabel', '处理方式')}");
    expect(actions).toContain("ariaLabel={tr('schedule.onFailureLabel', '失败时')}");
  });

  it('puts all groups in flush form cells and adds the 下次执行 row', () => {
    expect(panels.match(/ui-group ui-form-flush/g)?.length).toBeGreaterThanOrEqual(2);
    expect(actions).toContain('ui-group ui-form-flush');
    expect(panels).toContain('data-testid="automation-next-run"');
  });

  it('renders actions as grid rows with connector rows, not cards', () => {
    expect(actions).toContain('grid-cols-[40px_minmax(0,1fr)]');
    expect(actions).toContain('data-testid="automation-action-connector"');
    expect(actions).not.toMatch(/<div className="ui-group bg-surface">/);
  });

  it('header actions are flush cells; 立即运行 is an accent-text cell, not a primary block', () => {
    expect(panels).toContain('ui-accent-cell w-[104px] border-l');
    expect(panels).not.toContain('variant="primary"');
  });

  it('formats the next run as MM-DD weekday HH:mm', () => {
    const ts = new Date(2026, 9, 26, 9, 0).getTime();
    expect(formatNextRun(ts, 'zh-CN')).toBe('10-26 周一 09:00');
  });
});
