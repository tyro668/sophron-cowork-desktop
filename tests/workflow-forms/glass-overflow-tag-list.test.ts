import { createElement } from 'react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  GlassOverflowTagList,
  getVisibleTagCount,
} from '../../src/renderer/components/workflow-forms/shared/GlassOverflowTagList';

describe('GlassOverflowTagList', () => {
  it('keeps the first fitting tag and collapses two hidden tags into +2', () => {
    expect(getVisibleTagCount([96, 72, 70], 34, 138)).toBe(1);
  });

  it('shows all tags if they fit, and a badge alone when even the first cannot fit', () => {
    expect(getVisibleTagCount([60, 70], 28, 136)).toBe(2);
    expect(getVisibleTagCount([96, 72, 70], 34, 80)).toBe(0);
  });

  it('shares removable chip and count styling for filter values and deduplicate fields', () => {
    const html = renderToStaticMarkup(
      createElement(GlassOverflowTagList, {
        values: ['0.350000', '0.370000', '0.390000'],
        onRemove: () => undefined,
      })
    );

    expect(html).toContain('0.350000');
    expect(html).toContain('rounded-full');
    expect(html).toContain('+3');
    expect(html).toContain('whitespace-nowrap');
    expect(html).toContain('overflow-hidden');
  });

  it('keeps every multi-select surface on the single GlassValueChip markup', () => {
    const sharedDir = resolve(__dirname, '../../src/renderer/components/workflow-forms/shared');
    const tagListSrc = readFileSync(resolve(sharedDir, 'GlassOverflowTagList.tsx'), 'utf-8');
    const pickerSrc = readFileSync(resolve(sharedDir, 'GlassFieldMultiPicker.tsx'), 'utf-8');

    // The chip class signature lives in GlassValueChip only — no inline copies.
    expect(tagListSrc).toContain('GlassValueChip');
    expect(pickerSrc).toContain('GlassValueChip');
    for (const source of [tagListSrc, pickerSrc]) {
      expect(source).not.toContain('bg-accent-muted text-accent');
      expect(source).not.toContain('rounded-md border px-2');
    }
  });
});
