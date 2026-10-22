import { describe, expect, it } from 'vitest';
import {
  expandCalculationDomainExpression,
  normalizeCalculationDomainExpression,
} from '../../src/shared/calculate-field/domain-dsl';
import { parseCalculationFunctionWizardInput } from '../../src/shared/calculate-field/wizard-input';
import { exportStep, parseStep } from '../helpers/jflow-step';

const aliases = [
  ['group(percentoftotal([Amount]))', 'group(percent_of_total([Amount]))'],
  ['group(stddev([Amount]))', 'group(stddev_samp([Amount]))'],
  ...[
    ['first', 'first_value', ''],
    ['last', 'last_value', ''],
    ['nth', 'nth_value', ', 2'],
    ['difference', 'offset_difference', ', 2'],
    ['rate', 'offset_rate', ', 2'],
  ].map(([oldName, newName, parameter]) => [
    `reference(${oldName}([Amount]${parameter})) over(order by [Date])`,
    `reference(${newName}([Amount]${parameter})) over(order by [Date])`,
  ]),
  ...['year', 'quarter', 'month', 'week'].map((period) => [
    `accumulate(${period}todate(sum([Amount]), [Date]))`,
    `accumulate(${period}_to_date(sum([Amount]), [Date]))`,
  ]),
  [
    `accumulate(rolling(sum([Amount]), [Date], 7, 'day'))`,
    `accumulate(rolling_time(sum([Amount]), [Date], 7, 'day'))`,
  ],
  ...['value', 'difference', 'percentchange'].flatMap((result) => {
    const canonicalResult = result === 'percentchange' ? 'change_rate' : result;
    return [
      [
        `compare(previous([Amount], [Date], '${result}'))`,
        `compare(previous_record([Amount], [Date], '${canonicalResult}'))`,
      ],
      [
        `compare(sameperiodlastyear([Amount], [Date], 'month', '${result}'))`,
        `compare(same_period_last_year([Amount], [Date], 'month', '${canonicalResult}'))`,
      ],
    ];
  }),
];

describe('canonical calculation names and compatibility', () => {
  it.each(aliases)('reads %s and writes %s without changing SQL', (legacy, canonical) => {
    expect(normalizeCalculationDomainExpression(legacy)).toBe(canonical);
    expect(normalizeCalculationDomainExpression(canonical)).toBe(canonical);
    expect(expandCalculationDomainExpression(legacy)).toBe(
      expandCalculationDomainExpression(canonical)
    );
    expect(parseCalculationFunctionWizardInput(legacy)).toEqual(
      parseCalculationFunctionWizardInput(canonical)
    );
    expect(parseCalculationFunctionWizardInput(canonical)).toBeDefined();
    const parsed = parseStep(`derive [result] = ${legacy}`, 'derive');
    expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(parsed.operator?.config.calculations).toEqual([
      { field: 'result', action: 'add', expression: canonical },
    ]);
    // Export a stored legacy config directly, without first parsing its DSL.
    expect(
      exportStep({
        id: 'test',
        type: 'derive',
        config: { calculations: [{ field: 'result', expression: legacy }] },
      })
    ).toBe(`derive [result] = ${canonical}`);
  });

  it('normalizes function casing without rewriting field names or literal data', () => {
    const source =
      "CONCAT(UPPER([CustomerName]), 'YEARTODATE(KeepCase)', CAST([Amount] AS VARCHAR))";
    const expected =
      "concat(upper([CustomerName]), 'YEARTODATE(KeepCase)', cast([Amount] AS VARCHAR))";
    expect(normalizeCalculationDomainExpression(source)).toBe(expected);
    expect(normalizeCalculationDomainExpression(expected)).toBe(expected);
    expect(normalizeCalculationDomainExpression('GROUP(SUM(ABS([Amount])))')).toBe(
      'group(sum(abs([Amount])))'
    );
    expect(normalizeCalculationDomainExpression('GROUP(PERCENTOFTOTAL([Amount]))')).toBe(
      'group(percent_of_total([Amount]))'
    );
  });

  it('preserves native SQL window expressions when exporting saved configs', () => {
    expect(
      exportStep({
        id: 'sql',
        type: 'derive',
        config: {
          calculations: [{ field: 'n', expression: 'ROW_NUMBER() OVER (ORDER BY [Date])' }],
        },
      })
    ).toBe('derive [n] = row_number() over (sort: [Date])');
  });

  it.each([
    `compare(previous([Amount], [Date], 'invalid'))`,
    'accumulate(yeartodate(sum([Amount]), [Date], 13))',
    'reference(nth([Amount], 0)) over(order by [Date])',
    'group(first([Amount]))',
    'reference(percentoftotal([Amount])) over(order by [Date])',
    `accumulate(rolling(sum([Amount]), [Date], 7, 'hour'))`,
  ])('does not let legacy aliases bypass validation: %s', (expression) => {
    expect(() => normalizeCalculationDomainExpression(expression)).toThrow();
    const parsed = parseStep(`derive [result] = ${expression}`, 'derive');
    expect(parsed.diagnostics.some((item) => item.severity === 'error')).toBe(true);
  });
});
