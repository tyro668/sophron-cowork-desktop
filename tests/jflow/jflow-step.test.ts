import { describe, expect, it } from 'vitest';
import { exportJflowStep, parseJflowStep } from '../../src/shared/jflow';

const COLS = [
  { name: 'a', type: 'INTEGER' },
  { name: 'b', type: 'VARCHAR' },
];

describe('per-node jflow step', () => {
  it('round-trips single-node steps', () => {
    for (const text of [
      'where [a] > 1',
      'sort -[a], [b]',
      "derive [c] = if [a] > 1 then 'x' else 'y' end",
      'take 10',
      'distinct by: [b]',
    ]) {
      const parsed = parseJflowStep(text, { columns: COLS });
      expect(
        parsed.diagnostics.filter((d) => d.severity === 'error'),
        text
      ).toEqual([]);
      const exported = exportJflowStep({ type: parsed.type!, config: parsed.config! });
      expect(
        exported.diagnostics.filter((d) => d.severity === 'error'),
        text
      ).toEqual([]);
      const again = parseJflowStep(exported.text, { columns: COLS });
      expect(again.config, `${text} → ${exported.text}`).toEqual(parsed.config);
    }
  });

  it('rejects type changes, composites and multi-input nodes', () => {
    expect(parseJflowStep('where [a] > 1', { expectedType: 'sort' }).diagnostics[0]?.code).toBe(
      'E_STEP_TYPE'
    );
    expect(exportJflowStep({ type: 'join', config: {} }).diagnostics[0]?.code).toBe(
      'E_STEP_UNSUPPORTED'
    );
    const parsed = parseJflowStep('where [zz] > 1', { columns: COLS });
    expect(parsed.config).toBeNull();
    expect(parsed.diagnostics[0]?.span?.start).toBeGreaterThanOrEqual(0);
  });
});
