import { describe, expect, it } from 'vitest';
import { cn } from '../src/renderer/components/ui/cn';
import { menuItemClass } from '../src/renderer/components/ui/dropdown-menu';
import { selectItemClass, selectTriggerClass } from '../src/renderer/components/ui/select';

describe('cn custom Tailwind token merging', () => {
  it('preserves text-ui-* font-size tokens when combined with text-color utilities', () => {
    expect(cn('text-ui-body', 'text-text-primary')).toBe('text-ui-body text-text-primary');
    expect(cn('text-ui-label', 'text-text-secondary')).toBe('text-ui-label text-text-secondary');
    expect(cn('text-ui-control', 'text-accent')).toBe('text-ui-control text-accent');
    expect(cn('text-ui-caption', 'text-text-muted')).toBe('text-ui-caption text-text-muted');
  });

  it('still lets explicit font-size utilities override text-ui-* tokens', () => {
    expect(cn('text-ui-body', 'text-xs', 'text-text-primary')).toBe('text-xs text-text-primary');
    expect(cn('text-ui-body', 'text-[12.5px]', 'text-accent')).toBe('text-[12.5px] text-accent');
    expect(cn('text-ui-label', 'text-ui-body', 'text-text-primary')).toBe(
      'text-ui-body text-text-primary'
    );
  });

  it('keeps text-ui-body on select triggers, select items, and dropdown menu items', () => {
    expect(cn(selectTriggerClass, 'min-w-0')).toContain('text-ui-body');
    expect(cn(selectItemClass, 'min-h-8', 'text-text-muted')).toContain('text-ui-body');
    expect(menuItemClass()).toContain('text-ui-body');
    expect(menuItemClass({ danger: true })).toContain('text-ui-body');
  });

  it('resolves custom shadow tokens against shadow-none', () => {
    expect(cn('shadow-elevated', 'shadow-none')).toBe('shadow-none');
    expect(cn('shadow-soft', 'shadow-card')).toBe('shadow-card');
  });
});
