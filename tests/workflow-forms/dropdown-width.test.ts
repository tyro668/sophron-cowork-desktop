import { afterAll, describe, expect, it, vi } from 'vitest';
import { measureMaxTextWidth } from '../../src/renderer/components/workflow-forms/shared/dropdownWidth';

describe('dropdown text width measurement', () => {
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('measures all labels with one reusable canvas context', () => {
    const measureText = vi.fn((text: string) => ({ width: text.length * 10 }));
    const getContext = vi.fn(() => ({ measureText, font: '' }));
    const createElement = vi.fn(() => ({ getContext }));
    vi.stubGlobal('document', { createElement, body: {} });
    vi.stubGlobal('getComputedStyle', () => ({ fontFamily: 'Inter, sans-serif' }));

    expect(measureMaxTextWidth(['a', 'longest'], 13, 48)).toBe(118);
    expect(measureMaxTextWidth(['medium'], 13, 48)).toBe(108);
    expect(createElement).toHaveBeenCalledTimes(1);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(measureText).toHaveBeenCalledTimes(3);
  });
});
