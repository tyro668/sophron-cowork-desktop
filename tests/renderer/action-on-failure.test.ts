import { describe, expect, it } from 'vitest';
import { withActionOnFailure } from '../../src/renderer/components/settings/schedule/action-config-editors';
import type { AutomationActionNode } from '../../src/shared/automation/types';

const node = {
  id: 'a1',
  type: 'data.pipeline.run',
  label: '',
  config: {},
} as unknown as AutomationActionNode;

describe('withActionOnFailure', () => {
  it('sets continue policy used by the runner', () => {
    expect(withActionOnFailure(node, 'continue').failurePolicy).toEqual({
      onFailure: 'continue',
      emitErrorArtifact: false,
    });
  });
  it('clears policy for stop (default behaviour, keeps legacy data compatible)', () => {
    const cont = withActionOnFailure(node, 'continue');
    const stopped = withActionOnFailure(cont, 'stop');
    expect(stopped.failurePolicy).toBeUndefined();
    expect(stopped.config).toBe(node.config);
  });
});
