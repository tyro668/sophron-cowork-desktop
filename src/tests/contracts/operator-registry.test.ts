/**
 * Operator registry completeness contract.
 *
 * `OPERATOR_DEFINITIONS` (shared/operators) is the single registration point
 * for operator types; `OPERATOR_UI` (renderer operator-catalog) is the single
 * UI registration point. Adding an operator without updating every facet must
 * fail here (or earlier at compile time via the exhaustive Record key types).
 */
import { describe, expect, it } from 'vitest';
import {
  OPERATOR_DEFINITIONS,
  OPERATOR_TYPES,
  SCHEMA_MAP,
  getOperatorConfigValidation,
  getOperatorDefinition,
  hasBinaryInputs,
  isWorkflowOperatorType,
} from '../../shared/operators';
import { COMPILE_STRATEGIES } from '../../main/data/operators/strategy';
import { OPERATOR_UI } from '../../renderer/components/data-view/data-tasks/workflow/operator-catalog';
import { AI_GENERATED_WORKFLOW_NODE_TYPES } from '../../main/data/workflow/prep-dsl-capability-profile';

const ALL_TYPES = [...OPERATOR_TYPES].sort();

const VALID_INPUT_HANDLES = new Set(['input', 'left', 'right']);
const VALID_OUTPUT_HANDLES = new Set(['output', 'reject']);

describe('shared operator registry', () => {
  it('defines exactly one entry per operator type', () => {
    expect(Object.keys(OPERATOR_DEFINITIONS).sort()).toEqual(ALL_TYPES);
    for (const type of OPERATOR_TYPES) {
      expect(OPERATOR_DEFINITIONS[type].type).toBe(type);
    }
  });

  it('gives every definition a schema, ports and a compile kind', () => {
    for (const type of OPERATOR_TYPES) {
      const def = OPERATOR_DEFINITIONS[type];
      expect(typeof def.schema.safeParse).toBe('function');
      for (const handle of def.ports.inputs) {
        expect(VALID_INPUT_HANDLES.has(handle)).toBe(true);
      }
      for (const handle of def.ports.outputs) {
        expect(VALID_OUTPUT_HANDLES.has(handle)).toBe(true);
      }
      expect(['strategy', 'join', 'set_op', 'input_source', 'output', 'expect']).toContain(
        def.compileKind
      );
    }
  });

  it('derives SCHEMA_MAP from the registry with schema identity', () => {
    expect(Object.keys(SCHEMA_MAP).sort()).toEqual(ALL_TYPES);
    for (const type of OPERATOR_TYPES) {
      expect(SCHEMA_MAP[type]).toBe(OPERATOR_DEFINITIONS[type].schema);
    }
  });

  it('declares a DSL codec for every step-expressible operator', () => {
    // input_source binds via `from <ref>`/resources — it has no step codec.
    const withoutDsl = OPERATOR_TYPES.filter((type) => !OPERATOR_DEFINITIONS[type].dsl);
    expect(withoutDsl).toEqual(['input_source']);
    for (const type of OPERATOR_TYPES) {
      const codec = OPERATOR_DEFINITIONS[type].dsl;
      if (codec) expect(codec.type).toBe(type);
    }
  });

  it('keeps COMPILE_STRATEGIES aligned with compileKind === "strategy"', () => {
    const strategyTypes = OPERATOR_TYPES.filter(
      (type) => OPERATOR_DEFINITIONS[type].compileKind === 'strategy'
    ).sort();
    expect(Object.keys(COMPILE_STRATEGIES).sort()).toEqual(strategyTypes);
  });

  it('declares boundary/binary/quality ports correctly', () => {
    expect(OPERATOR_DEFINITIONS.input_source.ports).toEqual({ inputs: [], outputs: ['output'] });
    expect(OPERATOR_DEFINITIONS.output.ports).toEqual({ inputs: ['input'], outputs: [] });
    expect(OPERATOR_DEFINITIONS.join.ports.inputs).toEqual(['left', 'right']);
    expect(OPERATOR_DEFINITIONS.set_op.ports.inputs).toEqual(['left', 'right']);
    expect(OPERATOR_DEFINITIONS.expect.ports.outputs).toEqual(['output', 'reject']);
    expect(hasBinaryInputs('join')).toBe(true);
    expect(hasBinaryInputs('set_op')).toBe(true);
    expect(hasBinaryInputs('filter')).toBe(false);
    for (const type of OPERATOR_TYPES) {
      const { inputs, outputs } = OPERATOR_DEFINITIONS[type].ports;
      if (!['input_source', 'join', 'set_op'].includes(type)) {
        expect(inputs).toEqual(['input']);
      }
      if (!['output', 'expect'].includes(type)) {
        expect(outputs).toEqual(['output']);
      }
    }
  });

  it('produces fresh, schema-compatible default configs', () => {
    for (const type of OPERATOR_TYPES) {
      const def = OPERATOR_DEFINITIONS[type];
      const first = def.createDefaultConfig();
      const second = def.createDefaultConfig();
      expect(first).not.toBe(second);
      expect(typeof first).toBe('object');
      // Non-empty defaults must satisfy the operator's own schema.
      if (Object.keys(first).length > 0) {
        expect(def.schema.safeParse(first).success).toBe(true);
      }
    }
  });

  it('validates configs through each definition and rejects unknown types', () => {
    expect(getOperatorDefinition('filter')?.type).toBe('filter');
    expect(getOperatorDefinition('bogus')).toBeUndefined();
    expect(isWorkflowOperatorType('sort')).toBe(true);
    expect(isWorkflowOperatorType('bogus')).toBe(false);
    const invalid = getOperatorConfigValidation('bogus', {});
    expect(invalid.success).toBe(false);
    expect(OPERATOR_DEFINITIONS.filter.validateConfig({}).length).toBeGreaterThan(0);
  });

  it('keeps the AI-generated node allowlist inside the registry', () => {
    for (const type of AI_GENERATED_WORKFLOW_NODE_TYPES) {
      expect(OPERATOR_TYPES).toContain(type);
    }
  });
});

describe('renderer operator UI registry', () => {
  it('defines exactly one UI entry per operator type', () => {
    expect(Object.keys(OPERATOR_UI).sort()).toEqual(ALL_TYPES);
    for (const type of OPERATOR_TYPES) {
      const ui = OPERATOR_UI[type];
      expect(ui.type).toBe(type);
      expect(ui.labelKey.startsWith('data.workflow.operators.')).toBe(true);
      expect(ui.Icon).toBeDefined();
      expect(ui.colorClassName).toBeTruthy();
      expect(ui.nodeClassName).toBeTruthy();
      expect(typeof ui.summarize).toBe('function');
    }
  });

  it('registers a form loader for every non-boundary operator', () => {
    // input_source/output use binding panels instead of config forms.
    const boundary = new Set(['input_source', 'output']);
    for (const type of OPERATOR_TYPES) {
      if (boundary.has(type)) {
        expect(OPERATOR_UI[type].form).toBeUndefined();
      } else {
        expect(typeof OPERATOR_UI[type].form).toBe('function');
      }
    }
  });
});
