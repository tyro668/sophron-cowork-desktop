import {
  COMMON_EXPRESSION_FUNCTION_GROUPS,
  functionToken,
  type ExpressionFunctionGroup,
} from '../shared/GlassExpressionInput';

const CALCULATION_WINDOW_FUNCTION_GROUP: ExpressionFunctionGroup = {
  i18nKey: 'expressionFunctionCategoryWindow',
  tokens: [
    functionToken('row_number', 'expressionFunctionDesc_rowNumber', [], 'int', [
      'row_number() over(partition by [dept] order by [salary] desc)',
    ]),
    functionToken('rank', 'expressionFunctionDesc_rank', [], 'int', [
      'rank() over(order by [score] desc)',
    ]),
    functionToken('dense_rank', 'expressionFunctionDesc_dense_rank', [], 'int', [
      'dense_rank() over(order by [score] desc)',
    ]),
    functionToken(
      'ntile',
      'expressionFunctionDesc_ntile',
      [{ name: 'buckets', type: 'int' }],
      'int',
      ['ntile(2) over(order by [amount] desc)']
    ),
    functionToken(
      'first_value',
      'expressionFunctionDesc_first_value',
      [{ name: 'expr', type: 'any' }],
      'any',
      ['first_value([amount]) over(partition by [dept] order by [date])']
    ),
    functionToken(
      'last_value',
      'expressionFunctionDesc_last_value',
      [{ name: 'expr', type: 'any' }],
      'any',
      ['last_value([amount]) over(partition by [dept] order by [date])']
    ),
    functionToken(
      'lag',
      'expressionFunctionDesc_lag',
      [
        { name: 'expr', type: 'any' },
        { name: 'offset', type: 'int', optional: true },
        { name: 'default', type: 'any', optional: true },
      ],
      'any',
      ['lag([amount])', 'lag([amount], 2)']
    ),
    functionToken(
      'lead',
      'expressionFunctionDesc_lead',
      [
        { name: 'expr', type: 'any' },
        { name: 'offset', type: 'int', optional: true },
        { name: 'default', type: 'any', optional: true },
      ],
      'any',
      ['lead([amount])']
    ),
  ],
};

export const CALCULATE_FIELD_EXPRESSION_FUNCTION_GROUPS: ExpressionFunctionGroup[] = [
  ...COMMON_EXPRESSION_FUNCTION_GROUPS.slice(0, 2),
  CALCULATION_WINDOW_FUNCTION_GROUP,
  ...COMMON_EXPRESSION_FUNCTION_GROUPS.slice(2),
];
