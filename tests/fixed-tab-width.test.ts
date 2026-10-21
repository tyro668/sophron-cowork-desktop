import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FIXED_TAB_WIDTH,
  fixedTabGroupWidth,
  fixedTabWidthClass,
  bottomTabTriggerClass,
} from '../src/renderer/components/data-view/shared';

describe('fixed equal tab width', () => {
  it('uses one shared width; 3 tabs = cloud tree width', () => {
    expect(FIXED_TAB_WIDTH).toBe(112);
    expect(fixedTabWidthClass).toContain(`w-[${FIXED_TAB_WIDTH}px]`);
    expect(bottomTabTriggerClass).toContain(`w-[${FIXED_TAB_WIDTH}px]`);
    expect(fixedTabGroupWidth(3)).toBe(336);
  });
  it('is applied to data top tabs, cloud tree and cloud bottom tabs', () => {
    const page = readFileSync('src/renderer/features/data/pages/DataViewPage.tsx', 'utf8');
    const cloud = readFileSync('src/renderer/components/data-view/cloud-analysis.tsx', 'utf8');
    expect(page).toContain('className={fixedUnderlineTabTriggerClass}');
    expect(cloud).toContain('style={{ width: fixedTabGroupWidth(3) }}');
    expect(cloud).toContain('${fixedTabWidthClass}');
  });
});

describe('automation page tabs', () => {
  it('use the fixed tab width and the shared tab-bar action slot', () => {
    const src = readFileSync('src/renderer/components/settings/SettingsSchedule.tsx', 'utf8');
    expect(src).toContain('className={fixedUnderlineTabTriggerClass}');
    expect(src).not.toContain('className={underlineTabTriggerClass}');
    expect(src).toContain('<TabBarActionSlot');
  });
});
