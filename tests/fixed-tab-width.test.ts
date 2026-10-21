import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FIXED_TAB_WIDTH,
  fixedTabGroupWidth,
  fixedTabWidthClass,
  bottomTabTriggerClass,
} from '../src/renderer/components/data-view/shared';

describe('fixed equal tab width', () => {
  it('uses one shared width; 4 tabs = cloud tree width', () => {
    expect(FIXED_TAB_WIDTH).toBe(112);
    expect(fixedTabWidthClass).toContain(`w-[${FIXED_TAB_WIDTH}px]`);
    expect(bottomTabTriggerClass).toContain(`w-[${FIXED_TAB_WIDTH}px]`);
    expect(fixedTabGroupWidth(4)).toBe(448);
  });
  it('is applied to data top tabs, cloud tree and cloud bottom tabs', () => {
    const page = readFileSync('src/renderer/features/data/pages/DataViewPage.tsx', 'utf8');
    const cloud = readFileSync('src/renderer/components/data-view/cloud-analysis.tsx', 'utf8');
    expect(page).toContain('className={fixedUnderlineTabTriggerClass}');
    expect(cloud).toContain('style={{ width: fixedTabGroupWidth(4) }}');
    expect(cloud).toContain('${fixedTabWidthClass}');
  });
});
