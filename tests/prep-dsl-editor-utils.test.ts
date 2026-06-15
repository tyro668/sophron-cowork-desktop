import { describe, expect, it } from 'vitest';
import { arePrepDiagnosticsEqual } from '../src/renderer/components/prep-dsl-editor-utils';
import type { PrepDiagnostic } from '../src/shared/prep-dsl';

describe('prep dsl editor diagnostics equality', () => {
  it('treats identical diagnostics as equal', () => {
    const left: PrepDiagnostic[] = [
      { severity: 'error', message: 'Invalid DSL', code: 'dsl', line: 1, column: 2 },
    ];
    const right: PrepDiagnostic[] = [
      { severity: 'error', message: 'Invalid DSL', code: 'dsl', line: 1, column: 2 },
    ];
    expect(arePrepDiagnosticsEqual(left, right)).toBe(true);
  });

  it('treats parameter order as irrelevant', () => {
    const left: PrepDiagnostic[] = [
      {
        severity: 'warning',
        message: 'Missing field',
        code: 'field',
        params: { b: 2, a: 1 },
      },
    ];
    const right: PrepDiagnostic[] = [
      {
        severity: 'warning',
        message: 'Missing field',
        code: 'field',
        params: { a: 1, b: 2 },
      },
    ];
    expect(arePrepDiagnosticsEqual(left, right)).toBe(true);
  });

  it('detects changed diagnostics', () => {
    expect(
      arePrepDiagnosticsEqual(
        [{ severity: 'error', message: 'A' }],
        [{ severity: 'error', message: 'B' }]
      )
    ).toBe(false);
  });
});
