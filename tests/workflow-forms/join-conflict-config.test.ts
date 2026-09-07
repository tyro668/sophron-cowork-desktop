import { describe, expect, it } from 'vitest';
import {
  buildJoinConflictConfig,
  JOIN_CONFLICT_DEFAULTS,
  type JoinConflictUi,
} from '../../src/shared/operator-config';

function draft(overrides: Partial<JoinConflictUi>): JoinConflictUi {
  return { ...JOIN_CONFLICT_DEFAULTS, ...overrides };
}

describe('buildJoinConflictConfig', () => {
  it('keeps trimmed custom suffixes and drops the prefix field for the suffix strategy', () => {
    const result = buildJoinConflictConfig(
      draft({ strategy: 'suffix', leftSuffix: ' _l ', rightSuffix: '_r ' })
    );

    expect(result).toEqual({ strategy: 'suffix', leftSuffix: '_l', rightSuffix: '_r' });
  });

  it('falls back to default suffixes when the inputs are blank', () => {
    const result = buildJoinConflictConfig(
      draft({ strategy: 'suffix', leftSuffix: '  ', rightSuffix: '' })
    );

    expect(result).toEqual({
      strategy: 'suffix',
      leftSuffix: JOIN_CONFLICT_DEFAULTS.leftSuffix,
      rightSuffix: JOIN_CONFLICT_DEFAULTS.rightSuffix,
    });
  });

  it('writes only the trimmed prefix for the right_prefix strategy, cropping stale suffixes', () => {
    const result = buildJoinConflictConfig(
      draft({
        strategy: 'right_prefix',
        leftSuffix: '_left',
        rightSuffix: '_right',
        rightPrefix: ' r_ ',
      })
    );

    expect(result).toEqual({ strategy: 'right_prefix', rightPrefix: 'r_' });
  });

  it('falls back to the default prefix when blank so the config passes schema validation', () => {
    const result = buildJoinConflictConfig(draft({ strategy: 'right_prefix', rightPrefix: '' }));

    expect(result).toEqual({
      strategy: 'right_prefix',
      rightPrefix: JOIN_CONFLICT_DEFAULTS.rightPrefix,
    });
  });
});
