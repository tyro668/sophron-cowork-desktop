import { describe, expect, it } from 'vitest';
import { resolveAutomationStatusAfterUpdate } from '../src/main/automation/automation-store';

describe('AutomationStore schedule updates', () => {
  it('preserves paused and running states while updating an enabled automation', () => {
    expect(resolveAutomationStatusAfterUpdate('paused', true)).toBe('paused');
    expect(resolveAutomationStatusAfterUpdate('running', true)).toBe('running');
    expect(resolveAutomationStatusAfterUpdate('failed', true)).toBe('enabled');
    expect(resolveAutomationStatusAfterUpdate('paused', false)).toBe('disabled');
  });
});
