/** Test helpers: per-node jflow step export / parse with the old call shape. */
import { exportJflowStep, parseJflowStep } from '../../src/shared/jflow';

export function exportStep(node: { id?: string; type: string; config: Record<string, unknown> }) {
  return exportJflowStep(node).text;
}

export function parseStep(text: string, expectedType?: string) {
  const parsed = parseJflowStep(text, { expectedType });
  return {
    operator: parsed.config && parsed.type ? { type: parsed.type, config: parsed.config } : null,
    diagnostics: parsed.diagnostics,
  };
}
