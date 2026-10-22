import { describe, expect, it } from 'vitest';
import type { DataWorkflowNode } from '../../src/renderer/types';
import {
  getOperatorConfigIssue,
  type OperatorConfigIssueCode,
} from '../../src/shared/operator-validation';
import { incompleteConfigMessageKey } from '../../src/renderer/components/data-view/workflow-config-guards';

function hasIssue(
  node: DataWorkflowNode,
  type: DataWorkflowNode['type'],
  code: OperatorConfigIssueCode
): boolean {
  if (node.type !== type) return false;
  const issueCode = getOperatorConfigIssue(node)?.code;
  return issueCode === 'incomplete_config_rows' || issueCode === code;
}

const hasInvalidAggregateConfig = (node: DataWorkflowNode) =>
  hasIssue(node, 'aggregate', 'aggregate_incomplete_field');
const hasInvalidCalculateFieldConfig = (node: DataWorkflowNode) =>
  hasIssue(node, 'calculate_field', 'calculate_field_incomplete_field');
const hasInvalidDeduplicateConfig = (node: DataWorkflowNode) =>
  hasIssue(node, 'deduplicate', 'deduplicate_incomplete_field');
const hasInvalidFieldMappingConfig = (node: DataWorkflowNode) =>
  hasIssue(node, 'field_mapping', 'field_mapping_incomplete_field');
const hasInvalidFieldSelectConfig = (node: DataWorkflowNode) =>
  hasIssue(node, 'field_select', 'field_select_missing_field');
const hasInvalidFilterConfig = (node: DataWorkflowNode) =>
  hasIssue(node, 'filter', 'filter_incomplete_field');
const hasInvalidJoinConditionConfig = (node: DataWorkflowNode) =>
  hasIssue(node, 'join', 'join_incomplete_field');
const hasInvalidLimitConfig = (node: DataWorkflowNode) =>
  getOperatorConfigIssue(node)?.code === 'limit_incomplete_field';
const hasInvalidLimitPercent = (node: DataWorkflowNode) =>
  getOperatorConfigIssue(node)?.code === 'limit_percent_error';
const hasInvalidMissingValueConfig = (node: DataWorkflowNode) =>
  hasIssue(node, 'missing_value', 'missing_value_incomplete_field');
const hasInvalidPivotConfig = (node: DataWorkflowNode) =>
  hasIssue(node, 'pivot', 'pivot_incomplete_field');
const hasInvalidSetOpConfig = (node: DataWorkflowNode) =>
  hasIssue(node, 'set_op', 'set_op_incomplete_field');
const hasInvalidSortConfig = (node: DataWorkflowNode) =>
  hasIssue(node, 'sort', 'sort_incomplete_field');
const hasInvalidTypeConvertConfig = (node: DataWorkflowNode) =>
  hasIssue(node, 'type_convert', 'type_convert_incomplete_field');
const hasInvalidUnnestConfig = (node: DataWorkflowNode) =>
  hasIssue(node, 'unnest', 'unnest_incomplete_field');
const hasInvalidUnpivotConfig = (node: DataWorkflowNode) =>
  hasIssue(node, 'unpivot', 'unpivot_incomplete_field');

function makeNode(
  type: DataWorkflowNode['type'],
  config: Record<string, unknown>
): DataWorkflowNode {
  return {
    id: 'n',
    pipelineId: 't',
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
        conversions: [{ field: '  ', type: 'float' }],
      });
      expect(hasInvalidTypeConvertConfig(node)).toBe(true);
    });

    it('accepts a complete conversion', () => {
      const node = makeNode('type_convert', {
        conversions: [{ field: 'amount', type: 'float' }],
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
      const node = makeNode('unpivot', { fields: ['q1', 'q2'] });
      expect(hasInvalidUnpivotConfig(node)).toBe(false);
    });
  });

  describe('unnest', () => {
    it('flags a missing column', () => {
      expect(hasInvalidUnnestConfig(makeNode('unnest', {}))).toBe(true);
      expect(hasInvalidUnnestConfig(makeNode('unnest', { field: ' ' }))).toBe(true);
    });

    it('flags a list unnest without an alias', () => {
      const node = makeNode('unnest', { sourceKind: 'list', field: 'items' });
      expect(hasInvalidUnnestConfig(node)).toBe(true);
    });

    it('accepts a list unnest with column and alias', () => {
      const node = makeNode('unnest', { sourceKind: 'list', field: 'items', alias: 'item' });
      expect(hasInvalidUnnestConfig(node)).toBe(false);
    });

    it('accepts a json unnest without an alias', () => {
      const node = makeNode('unnest', { sourceKind: 'json', field: 'payload' });
      expect(hasInvalidUnnestConfig(node)).toBe(false);
    });

    it('ignores withIndex for a json unnest (json mode has no index column)', () => {
      const node = makeNode('unnest', {
        sourceKind: 'json',
        field: 'payload',
        withIndex: '',
      });
      expect(hasInvalidUnnestConfig(node)).toBe(false);
    });

    it('flags withIndex set to an empty string', () => {
      const node = makeNode('unnest', {
        sourceKind: 'list',
        field: 'items',
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
        rules: [{ field: ' ', method: 'literal_fill', value: 'x' }],
      });
      expect(hasInvalidMissingValueConfig(node)).toBe(true);
    });

    it('flags nullify_values without values', () => {
      const node = makeNode('missing_value', {
        rules: [{ field: 'a', method: 'nullify_values', values: [] }],
      });
      expect(hasInvalidMissingValueConfig(node)).toBe(true);
    });

    it('flags literal_fill without a value', () => {
      const node = makeNode('missing_value', {
        rules: [{ field: 'a', method: 'literal_fill', value: '' }],
      });
      expect(hasInvalidMissingValueConfig(node)).toBe(true);
    });

    it('accepts a complete column-mode rule', () => {
      const node = makeNode('missing_value', {
        strategy: 'by_column',
        rules: [{ field: 'a', method: 'literal_fill', value: 'x' }],
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
      expect(hasInvalidLimitConfig(makeNode('limit', { limit: 0 }))).toBe(true);
    });
  });

  describe('existing guards still behave correctly', () => {
    it('sort', () => {
      expect(hasInvalidSortConfig(makeNode('sort', {}))).toBe(true);
      expect(
        hasInvalidSortConfig(makeNode('sort', { orderBy: [{ field: 'a', direction: 'asc' }] }))
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
          makeNode('field_mapping', {
            mappings: [{ source: 'a', targetMode: 'rename', targetValue: 'b' }],
          })
        )
      ).toBe(false);
    });

    it('field_select', () => {
      expect(hasInvalidFieldSelectConfig(makeNode('field_select', {}))).toBe(true);
      expect(hasInvalidFieldSelectConfig(makeNode('field_select', { fields: ['a'] }))).toBe(false);
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
        'data.workflow.formLabels.typeConvert.typeConvertIncompleteField'
      );
      expect(incompleteConfigMessageKey(makeNode('unpivot', {}))).toBe(
        'data.workflow.formLabels.unpivot.unpivotIncompleteField'
      );
      expect(incompleteConfigMessageKey(makeNode('unnest', {}))).toBe(
        'data.workflow.formLabels.unnest.unnestIncompleteField'
      );
      expect(incompleteConfigMessageKey(makeNode('calculate_field', {}))).toBe(
        'data.workflow.formLabels.calculateField.calculateFieldIncompleteField'
      );
      expect(incompleteConfigMessageKey(makeNode('aggregate', {}))).toBe(
        'data.workflow.formLabels.aggregate.aggregateIncompleteField'
      );
      expect(incompleteConfigMessageKey(makeNode('set_op', {}))).toBe(
        'data.workflow.formLabels.setOp.setOpIncompleteField'
      );
      expect(incompleteConfigMessageKey(makeNode('missing_value', {}))).toBe(
        'data.workflow.formLabels.missingValue.missingValueIncompleteField'
      );
      expect(incompleteConfigMessageKey(makeNode('limit', {}))).toBe(
        'data.workflow.formLabels.limit.limitIncompleteField'
      );
    });

    it('returns null for a complete node', () => {
      const node = makeNode('type_convert', {
        conversions: [{ field: 'amount', type: 'float' }],
      });
      expect(incompleteConfigMessageKey(node)).toBeNull();
    });

    it('uses the generic incomplete-rows message when complete and incomplete entries coexist', () => {
      const cases: Array<[DataWorkflowNode['type'], Record<string, unknown>]> = [
        [
          'type_convert',
          {
            conversions: [
              { field: 'a', type: 'integer' },
              { field: '', type: 'text' },
            ],
          },
        ],
        ['sort', { orderBy: [{ field: 'a' }, { field: '' }] }],
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
              { source: 'a', targetMode: 'rename', targetValue: 'b' },
              { source: '', targetMode: 'rename', targetValue: '' },
            ],
          },
        ],
        [
          'missing_value',
          {
            strategy: 'by_column',
            rules: [
              { field: 'a', method: 'literal_fill', value: 'x' },
              { field: '', method: 'literal_fill', value: '' },
            ],
          },
        ],
        ['deduplicate', { strategy: 'by_columns', fields: ['a'], orderBy: [{ field: '' }] }],
      ];
      for (const [type, config] of cases) {
        expect(incompleteConfigMessageKey(makeNode(type, config)), `operator ${type}`).toBe(
          'data.workflow.formLabels.common.incompleteConfigRows'
        );
      }
    });

    it('keeps the operator-specific message when only the required config is missing', () => {
      expect(incompleteConfigMessageKey(makeNode('type_convert', {}))).toBe(
        'data.workflow.formLabels.typeConvert.typeConvertIncompleteField'
      );
      expect(incompleteConfigMessageKey(makeNode('pivot', { using: [] }))).toBe(
        'data.workflow.formLabels.pivot.pivotIncompleteField'
      );
    });

    it('treats an empty deduplicate orderBy as optional', () => {
      const node = makeNode('deduplicate', {
        strategy: 'by_columns',
        fields: ['a'],
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
        'data.workflow.formLabels.common.incompleteConfigRows'
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
        fields: ['', 'a'],
        orderBy: [],
      });
      expect(incompleteConfigMessageKey(node)).toBe(
        'data.workflow.formLabels.deduplicate.dedupIncompleteField'
      );
    });
  });
});
