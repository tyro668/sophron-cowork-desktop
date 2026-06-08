import { describe, expect, it } from 'vitest';
import { isAllowedClientEventType } from '../src/shared/client-event-allowlist';

describe('client event allowlist', () => {
  it('allows project events used by sidebar project actions', () => {
    expect(isAllowedClientEventType('project.rename')).toBe(true);
    expect(isAllowedClientEventType('project.renameByCwd')).toBe(true);
    expect(isAllowedClientEventType('project.delete')).toBe(true);
  });
});
