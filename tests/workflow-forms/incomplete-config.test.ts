import { describe, expect, it } from 'vitest';
import type { DataWorkflowNode } from '../../src/renderer/types';
import {
  hasInvalidAggregateConfig,
  hasInvalidCalculateFieldConfig,
  hasInvalidDeduplicateConfig,
  hasInvalidFieldMappingConfig,
  hasInvalidFieldSelectConfig,
  hasInvalidFilterConfig,
  hasInvalidJoinConditionConfig,
  hasInvalidLimitConfig,
  hasInvalidLimitPercent,
  hasInvalidMissingValueConfig,
  hasInvalidPivotConfig,
  hasInvalidSetOpConfig,
  hasInvalidSortConfig,
  hasInvalidTypeConvertConfig,
  hasInvalidUnnestConfig,
  hasInvalidUnpivotConfig,
  incompleteConfigMessageKey,
} from '../../src/renderer/components/data-view/workflow-config-guards';

function makeNode(
  type: DataWorkflowNode['type'],
  config: Record<string, unknown>
): DataWorkflowNode {
  return {
    id: 'n',
    taskId: 't',
    type,
    label: type,
    x: 0,
    y: 0,
    config,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('incomplete config guards', () => {
  it('returns false when node type does not match the guard', () => {
    const node = makeNode('filter', { condition: '' });
    expect(hasInvalidTypeConvertConfig(node)).toBe(false);
    expect(hasInvalidUnpivotConfig(node)).toBe(false);
    expect(hasInvalidUnnestConfig(node)).toBe(false);
    expect(hasInvalidCalculateFieldConfig(node)).toBe(false);
    expect(hasInvalidAggregateConfig(node)).toBe(false);
    expect(hasInvalidSetOpConfig(node)).toBe(false);
  });

  describe('type_convert', () => {
    it('flags missing or empty conversions', () => {
      expect(hasInvalidTypeConvertConfig(makeNode('type_convert', {}))).toBe(true);
      expect(hasInvalidTypeConvertConfig(makeNode('type_convert', { conversions: [] }))).toBe(true);
    });

    it('flags a conversion with an empty column', () => {
      const node = makeNode('type_convert', {
        conversions: [{ column: '  ', type: 'float' }],
      });
      expect(hasInvalidTypeConvertConfig(node)).toBe(true);
    });

    it('accepts a complete conversion', () => {
      const node = makeNode('type_convert', {
        conversions: [{ column: 'amount', type: 'float' }],
      });
      expect(hasInvalidTypeConvertConfig(node)).toBe(false);
    });
  });

  describe('unpivot', () => {
    it('flags missing or empty columns', () => {
      expect(hasInvalidUnpivotConfig(makeNode('unpivot', {}))).toBe(true);
      expect(hasInvalidUnpivotConfig(makeNode('unpivot', { columns: [] }))).toBe(true);
    });

    it('accepts columns without name/value (they are optional)', () => {
      const node = makeNode('unpivot', { columns: ['q1', 'q2'] });
      expect(hasInvalidUnpivotConfig(node)).toBe(false);
    });
  });

  describe('unnest', () => {
    it('flags a missing column', () => {
      expect(hasInvalidUnnestConfig(makeNode('unnest', {}))).toBe(true);
      expect(hasInvalidUnnestConfig(makeNode('unnest', { column: ' ' }))).toBe(true);
    });

    it('flags a list unnest without an alias', () => {
      const node = makeNode('unnest', { sourceKind: 'list', column: 'items' });
      expect(hasInvalidUnnestConfig(node)).toBe(true);
    });

    it('accepts a list unnest with column and alias', () => {
      const node = makeNode('unnest', { sourceKind: 'list', column: 'items', alias: 'item' });
      expect(hasInvalidUnnestConfig(node)).toBe(false);
    });

    it('accepts a json unnest without an alias', () => {
      const node = makeNode('unnest', { sourceKind: 'json', column: 'payload' });
      expect(hasInvalidUnnestConfig(node)).toBe(false);
    });

    it('ignores withIndex for a json unnest (json mode has no index column)', () => {
      const node = makeNode('unnest', {
        sourceKind: 'json',
        column: 'payload',
        withIndex: '',
      });
      expect(hasInvalidUnnestConfig(node)).toBe(false);
    });

    it('flags withIndex set to an empty string', () => {
      const node = makeNode('unnest', {
        sourceKind: 'list',
        column: 'items',
        alias: 'item',
        withIndex: '',
      });
      expect(hasInvalidUnnestConfig(node)).toBe(true);
    });
  });

  describe('calculate_field', () => {
    it('flags missing or empty calculations', () => {
      expect(hasInvalidCalculateFieldConfig(makeNode('calculate_field', {}))).toBe(true);
      expect(
        hasInvalidCalculateFieldConfig(makeNode('calculate_field', { calculations: [] }))
      ).toBe(true);
    });

    it('flags a row-mode calculation with an empty field or expression', () => {
      const emptyExpr = makeNode('calculate_field', {
        calculations: [{ field: 'margin', expression: ' ' }],
      });
      expect(hasInvalidCalculateFieldConfig(emptyExpr)).toBe(true);
      const emptyField = makeNode('calculate_field', {
        calculations: [{ field: ' ', expression: '[a] - [b]' }],
      });
      expect(hasInvalidCalculateFieldConfig(emptyField)).toBe(true);
    });

    it('accepts a complete calculation', () => {
      const node = makeNode('calculate_field', {
        calculations: [{ field: 'margin', expression: '[revenue] - [cost]' }],
      });
      expect(hasInvalidCalculateFieldConfig(node)).toBe(false);
    });

    it('flags a placeholder calculation without a target or expression', () => {
      const node = makeNode('calculate_field', {
        calculations: [{ field: '', expression: '' }],
      });
      expect(hasInvalidCalculateFieldConfig(node)).toBe(true);
    });
  });

  describe('aggregate', () => {
    it('flags missing or empty metrics', () => {
      expect(hasInvalidAggregateConfig(makeNode('aggregate', {}))).toBe(true);
      expect(hasInvalidAggregateConfig(makeNode('aggregate', { metrics: [] }))).toBe(true);
    });

    it('flags a metric without an expression or alias', () => {
      const noAlias = makeNode('aggregate', {
        metrics: [{ function: 'sum', expression: '[amount]', alias: '' }],
      });
      expect(hasInvalidAggregateConfig(noAlias)).toBe(true);
      const noExpr = makeNode('aggregate', {
        metrics: [{ function: 'sum', expression: '', alias: 'total' }],
      });
      expect(hasInvalidAggregateConfig(noExpr)).toBe(true);
    });

    it('accepts a complete metric and allows empty groupBy', () => {
      const node = makeNode('aggregate', {
        groupBy: [],
        metrics: [{ function: 'sum', expression: '[amount]', alias: 'total' }],
      });
      expect(hasInvalidAggregateConfig(node)).toBe(false);
    });
  });

  describe('set_op', () => {
    it('flags a missing rightInput', () => {
      expect(hasInvalidSetOpConfig(makeNode('set_op', {}))).toBe(true);
      expect(hasInvalidSetOpConfig(makeNode('set_op', { rightInput: ' ' }))).toBe(true);
    });

    it('accepts a rightInput', () => {
      expect(hasInvalidSetOpConfig(makeNode('set_op', { rightInput: 'R' }))).toBe(false);
    });
  });

  describe('missing_value', () => {
    it('does not flag row-mode strategies (empty columns default to all fields)', () => {
      expect(
        hasInvalidMissingValueConfig(makeNode('missing_value', { strategy: 'drop_empty_rows' }))
      ).toBe(false);
      expect(
        hasInvalidMissingValueConfig(
          makeNode('missing_value', { strategy: 'drop_rows_by_nulls', condition: 'any_null' })
        )
      ).toBe(false);
    });

    it('flags missing or empty column-mode rules', () => {
      expect(hasInvalidMissingValueConfig(makeNode('missing_value', {}))).toBe(true);
      expect(hasInvalidMissingValueConfig(makeNode('missing_value', { rules: [] }))).toBe(true);
    });

    it('flags a rule with an empty column', () => {
      const node = makeNode('missing_value', {
        rules: [{ column: ' ', method: 'literal_fill', value: 'x' }],
      });
      expect(hasInvalidMissingValueConfig(node)).toBe(true);
    });

    it('flags nullify_values without values', () => {
      const node = makeNode('missing_value', {
        rules: [{ column: 'a', method: 'nullify_values', values: [] }],
      });
      expect(hasInvalidMissingValueConfig(node)).toBe(true);
    });

    it('flags literal_fill without a value', () => {
      const node = makeNode('missing_value', {
        rules: [{ column: 'a', method: 'literal_fill', value: '' }],
      });
      expect(hasInvalidMissingValueConfig(node)).toBe(true);
    });

    it('accepts a complete column-mode rule', () => {
      const node = makeNode('missing_value', {
        strategy: 'by_column',
        rules: [{ column: 'a', method: 'literal_fill', value: 'x' }],
      });
      expect(hasInvalidMissingValueConfig(node)).toBe(false);
    });
  });

  describe('limit', () => {
    it('flags a missing limit count', () => {
      expect(hasInvalidLimitConfig(makeNode('limit', {}))).toBe(true);
    });

    it('accepts an explicit limit count', () => {
      expect(hasInvalidLimitConfig(makeNode('limit', { limit: 10 }))).toBe(false);
      expect(hasInvalidLimitConfig(makeNode('limit', { limit: 0 }))).toBe(false);
    });
  });

  describe('existing guards still behave correctly', () => {
    it('sort', () => {
      expect(hasInvalidSortConfig(makeNode('sort', {}))).toBe(true);
      expect(
        hasInvalidSortConfig(makeNode('sort', { keys: [{ field: 'a', direction: 'asc' }] }))
      ).toBe(false);
    });

    it('filter', () => {
      expect(hasInvalidFilterConfig(makeNode('filter', { condition: '' }))).toBe(true);
      expect(hasInvalidFilterConfig(makeNode('filter', { condition: '[a] = 1' }))).toBe(false);
    });

    it('field_mapping', () => {
      expect(hasInvalidFieldMappingConfig(makeNode('field_mapping', {}))).toBe(true);
      expect(
        hasInvalidFieldMappingConfig(
          makeNode('field_mapping', { mappings: [{ source: 'a', target: 'b' }] })
        )
      ).toBe(false);
    });

    it('field_select', () => {
      expect(hasInvalidFieldSelectConfig(makeNode('field_select', {}))).toBe(true);
      expect(hasInvalidFieldSelectConfig(makeNode('field_select', { columns: ['a'] }))).toBe(false);
    });

    it('deduplicate', () => {
      expect(hasInvalidDeduplicateConfig(makeNode('deduplicate', {}))).toBe(true);
      expect(
        hasInvalidDeduplicateConfig(makeNode('deduplicate', { strategy: 'all_columns' }))
      ).toBe(false);
    });

    it('limit percent', () => {
      expect(hasInvalidLimitPercent(makeNode('limit', { unit: 'percent', limit: 101 }))).toBe(true);
      expect(hasInvalidLimitPercent(makeNode('limit', { unit: 'percent', limit: 50 }))).toBe(false);
    });

    it('pivot', () => {
      expect(hasInvalidPivotConfig(makeNode('pivot', {}))).toBe(true);
      expect(
        hasInvalidPivotConfig(
          makeNode('pivot', {
            on: [{ field: 'a', values: [] }],
            using: [{ function: 'count', expression: '*' }],
          })
        )
      ).toBe(false);
    });

    it('join', () => {
      expect(hasInvalidJoinConditionConfig(makeNode('join', { joinType: 'left' }))).toBe(true);
      expect(
        hasInvalidJoinConditionConfig(
          makeNode('join', {
            joinType: 'left',
            conditions: [{ left: 'a', operator: '=', right: 'b' }],
          })
        )
      ).toBe(false);
    });

    it('asof join requires time fields', () => {
      const noTime = makeNode('join', {
        joinType: 'asof',
        rightInput: 'R',
        asof: { by: [{ left: 'a', operator: '=', right: 'b' }] },
      });
      expect(hasInvalidJoinConditionConfig(noTime)).toBe(true);
      const complete = makeNode('join', {
        joinType: 'asof',
        rightInput: 'R',
        asof: {
          leftTime: '[t1]',
          rightTime: '[t2]',
          by: [{ left: 'a', operator: '=', right: 'b' }],
        },
      });
      expect(hasInvalidJoinConditionConfig(complete)).toBe(false);
    });
  });

  describe('incompleteConfigMessageKey', () => {
    it('maps each invalid operator to its i18n key', () => {
      expect(incompleteConfigMessageKey(makeNode('type_convert', {}))).toBe(
        'data.workflow.formLabels.typeConvertIncompleteField'
      );
      expect(incompleteConfigMessageKey(makeNode('unpivot', {}))).toBe(
        'data.workflow.formLabels.unpivotIncompleteField'
      );
      expect(incompleteConfigMessageKey(makeNode('unnest', {}))).toBe(
        'data.workflow.formLabels.unnestIncompleteField'
      );
      expect(incompleteConfigMessageKey(makeNode('calculate_field', {}))).toBe(
        'data.workflow.formLabels.calculateFieldIncompleteField'
      );
      expect(incompleteConfigMessageKey(makeNode('aggregate', {}))).toBe(
        'data.workflow.formLabels.aggregateIncompleteField'
      );
      expect(incompleteConfigMessageKey(makeNode('set_op', {}))).toBe(
        'data.workflow.formLabels.setOpIncompleteField'
      );
      expect(incompleteConfigMessageKey(makeNode('missing_value', {}))).toBe(
        'data.workflow.formLabels.missingValueIncompleteField'
      );
      expect(incompleteConfigMessageKey(makeNode('limit', {}))).toBe(
        'data.workflow.formLabels.limitIncompleteField'
      );
    });

    it('returns null for a complete node', () => {
      const node = makeNode('type_convert', {
        conversions: [{ column: 'amount', type: 'float' }],
      });
      expect(incompleteConfigMessageKey(node)).toBeNull();
    });

    it('uses the generic incomplete-rows message when complete and incomplete entries coexist', () => {
      const cases: Array<[DataWorkflowNode['type'], Record<string, unknown>]> = [
        [
          'type_convert',
          {
            conversions: [
              { column: 'a', type: 'integer' },
              { column: '', type: 'text' },
            ],
          },
        ],
        ['sort', { keys: [{ field: 'a' }, { field: '' }] }],
        [
          'aggregate',
          {
            metrics: [
              { function: 'sum', expression: '[a]', alias: 't' },
              { function: 'sum', expression: '[b]', alias: '' },
            ],
          },
        ],
        [
          'join',
          {
            joinType: 'left',
            rightInput: 'R',
            conditions: [
              { left: '[L].a', operator: '=', right: '[R].b' },
              { left: '[L].c', operator: '=', right: '' },
            ],
          },
        ],
        [
          'pivot',
          {
            on: [{ field: 'a' }, { field: '' }],
            using: [{ function: 'count', expression: '*' }],
          },
        ],
        [
          'calculate_field',
          {
            calculations: [
              { field: 'm', expression: '[a]' },
              { field: 'n', expression: '' },
            ],
          },
        ],
        [
          'field_mapping',
          {
            mappings: [
              { source: 'a', target: 'b' },
              { source: '', target: '' },
            ],
          },
        ],
        [
          'missing_value',
          {
            strategy: 'by_column',
            rules: [
              { column: 'a', method: 'literal_fill', value: 'x' },
              { column: '', method: 'literal_fill', value: '' },
            ],
          },
        ],
        ['deduplicate', { strategy: 'by_columns', columns: ['a'], orderBy: [{ field: '' }] }],
      ];
      for (const [type, config] of cases) {
        expect(incompleteConfigMessageKey(makeNode(type, config)), `operator ${type}`).toBe(
          'data.workflow.formLabels.incompleteConfigRows'
        );
      }
    });

    it('keeps the operator-specific message when only the required config is missing', () => {
      expect(incompleteConfigMessageKey(makeNode('type_convert', {}))).toBe(
        'data.workflow.formLabels.typeConvertIncompleteField'
      );
      expect(incompleteConfigMessageKey(makeNode('pivot', { using: [] }))).toBe(
        'data.workflow.formLabels.pivotIncompleteField'
      );
    });

    it('treats an empty deduplicate orderBy as optional', () => {
      const node = makeNode('deduplicate', {
        strategy: 'by_columns',
        columns: ['a'],
        orderBy: [],
      });
      expect(incompleteConfigMessageKey(node)).toBeNull();
    });

    it('ignores incomplete regular conditions for an ASOF join', () => {
      const node = makeNode('join', {
        joinType: 'asof',
        rightInput: 'R',
        conditions: [{ left: '', operator: '=', right: '' }],
        asof: {
          leftTime: 'left_time',
          rightTime: 'right_time',
          by: [{ left: '[a]', operator: '=', right: '[b]' }],
        },
      });
      expect(incompleteConfigMessageKey(node)).toBeNull();
    });

    it('reports incomplete asof.by entries for an ASOF join', () => {
      const node = makeNode('join', {
        joinType: 'asof',
        rightInput: 'R',
        asof: {
          leftTime: 'left_time',
          rightTime: 'right_time',
          by: [{ left: '[a]', operator: '=', right: '' }],
        },
      });
      expect(incompleteConfigMessageKey(node)).toBe(
        'data.workflow.formLabels.incompleteConfigRows'
      );
    });

    it('ignores asof.by for a regular join', () => {
      const node = makeNode('join', {
        joinType: 'left',
        rightInput: 'R',
        conditions: [{ left: '[L].a', operator: '=', right: '[R].b' }],
        asof: { by: [{ left: '', operator: '=', right: '' }] },
      });
      expect(incompleteConfigMessageKey(node)).toBeNull();
    });

    it('keeps deduplicate columns in the operator-specific guard, not generic rows', () => {
      const node = makeNode('deduplicate', {
        strategy: 'by_columns',
        columns: ['', 'a'],
        orderBy: [],
      });
      expect(incompleteConfigMessageKey(node)).toBe(
        'data.workflow.formLabels.dedupIncompleteField'
      );
    });
  });
});
