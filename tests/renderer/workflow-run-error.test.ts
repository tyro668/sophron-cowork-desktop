/**
 * Run-error parsing: unwraps IPC/executor wrappers, extracts the missing
 * field, DuckDB candidate lists, "did you mean" and LINE positions, while
 * keeping the raw text for the technical-details disclosure.
 */
import { describe, expect, it } from 'vitest';
import {
  closestFieldName,
  parseWorkflowRunError,
} from '../../src/renderer/components/data-view/data-tasks/workflow/run-error';

describe('parseWorkflowRunError', () => {
  it('unwraps the node wrapper and extracts a missing field + candidates', () => {
    const raw =
      "Error: Error invoking remote method 'data.runTaskWithDiagnostics': " +
      'Error: Workflow node sql_1 (sql_query) failed: ' +
      'Binder Error: Referenced column "missing_col" not found in FROM clause!\n' +
      'Candidate columns: "id", "name", "amount"\n' +
      'LINE 1: SELECT missing_col FROM input\n                 ^';
    const parsed = parseWorkflowRunError(raw);
    expect(parsed.nodeId).toBe('sql_1');
    expect(parsed.nodeType).toBe('sql_query');
    expect(parsed.kind).toBe('Binder');
    expect(parsed.missingField).toBe('missing_col');
    expect(parsed.candidateFields).toEqual(['id', 'name', 'amount']);
    expect(parsed.line).toBe(1);
    // Headline keeps the readable clause, drops the LINE block + candidates.
    expect(parsed.headline).toContain('not found in FROM clause');
    expect(parsed.headline).not.toContain('LINE 1');
    expect(parsed.headline).not.toContain('Candidate columns');
    expect(parsed.raw).toBe(raw);
  });

  it('parses parser errors without a node wrapper', () => {
    const parsed = parseWorkflowRunError(
      'Error: Parser Error: syntax error at or near "FROM"\nLINE 3: SELECT * FROM\n                 ^'
    );
    expect(parsed.kind).toBe('Parser');
    expect(parsed.line).toBe(3);
    expect(parsed.headline).toBe('syntax error at or near "FROM"');
    expect(parsed.nodeId).toBeUndefined();
  });

  it('captures the engine did-you-mean suggestion', () => {
    const parsed = parseWorkflowRunError(
      'Catalog Error: Table with name orderss does not exist!\nDid you mean "orders"?'
    );
    expect(parsed.kind).toBe('Catalog');
    expect(parsed.suggestion).toBe('orders');
  });

  it('keeps unrecognized messages as plain headlines', () => {
    const parsed = parseWorkflowRunError('Output node has no input: out_1');
    expect(parsed.headline).toBe('Output node has no input: out_1');
    expect(parsed.candidateFields).toEqual([]);
  });
});

describe('closestFieldName', () => {
  it('fixes case slips and small typos', () => {
    expect(closestFieldName('Amount', ['amount', 'id'])).toBe('amount');
    expect(closestFieldName('amont', ['amount', 'id'])).toBe('amount');
  });
  it('returns null when the field already exists or nothing is close', () => {
    expect(closestFieldName('amount', ['amount', 'id'])).toBeNull();
    expect(closestFieldName('zzz', ['amount', 'id'])).toBeNull();
    expect(closestFieldName('x', [])).toBeNull();
  });
});
