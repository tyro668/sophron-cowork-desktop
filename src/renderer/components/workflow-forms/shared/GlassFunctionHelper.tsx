import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

export interface HelperToken {
  label: string;
  apply: string;
  cursorOffset?: number;
  i18nDescKey?: string;
  params?: Array<{ name: string; type: string; optional?: boolean }>;
  returnType?: string;
  examples?: string[];
}

function functionToken(
  label: string,
  descKey?: string,
  params?: HelperToken['params'],
  returnType?: string,
  examples?: string[]
): HelperToken {
  return {
    label,
    apply: `${label}()`,
    cursorOffset: label.length + 1,
    i18nDescKey: descKey,
    params,
    returnType,
    examples,
  };
}

const FN_CHIP =
  'inline-flex h-6 cursor-pointer items-center rounded-md border border-border-muted/60 bg-background/20 px-1.5 font-mono text-[11px] text-text-secondary transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent';
const FN_CHIP_HOVERED =
  'inline-flex h-6 cursor-pointer items-center rounded-md border border-accent bg-accent/10 px-1.5 font-mono text-[11px] text-accent';

const FUNCTION_GROUPS: Array<{ i18nKey: string; tokens: HelperToken[] }> = [
  {
    i18nKey: 'calcFieldCategoryCondition',
    tokens: [
      {
        label: 'if … then … else … end',
        apply: 'if  then  else  end',
        cursorOffset: 3,
        i18nDescKey: 'calcFieldDesc_ifElseEnd',
        params: [
          { name: 'condition', type: 'boolean' },
          { name: 'thenExpr', type: 'any' },
          { name: 'elseExpr', type: 'any' },
        ],
        returnType: 'any',
        examples: ['if [revenue] > 0 then [profit] / [revenue] else 0 end'],
      },
      {
        label: 'if … then … end',
        apply: 'if  then  end',
        cursorOffset: 3,
        i18nDescKey: 'calcFieldDesc_ifEnd',
        params: [
          { name: 'condition', type: 'boolean' },
          { name: 'thenExpr', type: 'any' },
        ],
        returnType: 'any',
        examples: ['if [amount] < 0 then 0 end'],
      },
      {
        label: 'case … when … then … end',
        apply: 'case  when  then  end',
        cursorOffset: 5,
        i18nDescKey: 'calcFieldDesc_caseWhenEnd',
        params: [
          { name: 'value', type: 'any' },
          { name: 'match', type: 'any' },
          { name: 'result', type: 'any' },
        ],
        returnType: 'any',
        examples: ["case [status] when 'PAID' then 1 else 0 end"],
      },
    ],
  },
  {
    i18nKey: 'calcFieldCategoryWindow',
    tokens: [
      functionToken('row_number', 'calcFieldDesc_rowNumber', [], 'int', [
        'row_number() over(partition by [dept] order by [salary] desc)',
      ]),
      functionToken('rank', 'calcFieldDesc_rank', [], 'int', [
        'rank() over(order by [score] desc)',
      ]),
      functionToken(
        'lag',
        'calcFieldDesc_lag',
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
        'calcFieldDesc_lead',
        [
          { name: 'expr', type: 'any' },
          { name: 'offset', type: 'int', optional: true },
          { name: 'default', type: 'any', optional: true },
        ],
        'any',
        ['lead([amount])']
      ),
    ],
  },
  {
    i18nKey: 'calcFieldCategoryAggregate',
    tokens: [
      functionToken('sum', 'calcFieldDesc_sum', [{ name: 'expr', type: 'number' }], 'number', [
        'sum([amount])',
        'sum([quantity] * [price])',
      ]),
      functionToken('avg', 'calcFieldDesc_avg', [{ name: 'expr', type: 'number' }], 'number', [
        'avg([amount])',
      ]),
      functionToken('count', 'calcFieldDesc_count', [{ name: 'expr', type: 'any' }], 'int', [
        'count(*)',
        'count([order_id])',
      ]),
      functionToken('min', 'calcFieldDesc_min', [{ name: 'expr', type: 'any' }], 'any', [
        'min([amount])',
      ]),
      functionToken('max', 'calcFieldDesc_max', [{ name: 'expr', type: 'any' }], 'any', [
        'max([amount])',
      ]),
    ],
  },
  {
    i18nKey: 'calcFieldCategoryMath',
    tokens: [
      functionToken('abs', 'calcFieldDesc_abs', [{ name: 'expr', type: 'number' }], 'number', [
        'abs([amount])',
        'abs([profit] - [cost])',
      ]),
      functionToken(
        'round',
        'calcFieldDesc_round',
        [
          { name: 'expr', type: 'number' },
          { name: 'precision', type: 'int', optional: true },
        ],
        'number',
        ['round([amount])', 'round([amount], 2)']
      ),
    ],
  },
  {
    i18nKey: 'calcFieldCategoryString',
    tokens: [
      functionToken('upper', 'calcFieldDesc_upper', [{ name: 'str', type: 'string' }], 'string', [
        'upper([name])',
      ]),
      functionToken('lower', 'calcFieldDesc_lower', [{ name: 'str', type: 'string' }], 'string', [
        'lower([name])',
      ]),
      functionToken('trim', 'calcFieldDesc_trim', [{ name: 'str', type: 'string' }], 'string', [
        'trim([name])',
      ]),
      functionToken('length', 'calcFieldDesc_length', [{ name: 'str', type: 'string' }], 'int', [
        'length([name])',
      ]),
      functionToken(
        'substr',
        'calcFieldDesc_substr',
        [
          { name: 'str', type: 'string' },
          { name: 'start', type: 'int' },
          { name: 'length', type: 'int', optional: true },
        ],
        'string',
        ['substr([name], 1, 3)', 'substr([code], 3)']
      ),
      functionToken(
        'split_part',
        'calcFieldDesc_splitPart',
        [
          { name: 'str', type: 'string' },
          { name: 'delimiter', type: 'string' },
          { name: 'part', type: 'int' },
        ],
        'string',
        ["split_part([name], ' ', 1)"]
      ),
      functionToken(
        'concat',
        'calcFieldDesc_concat',
        [
          { name: 'str', type: 'string' },
          { name: '...rest', type: 'string' },
        ],
        'string',
        ["concat([first], ' ', [last])"]
      ),
    ],
  },
  {
    i18nKey: 'calcFieldCategoryNull',
    tokens: [
      functionToken(
        'coalesce',
        'calcFieldDesc_coalesce',
        [
          { name: 'expr', type: 'any' },
          { name: '...rest', type: 'any' },
        ],
        'any',
        ['coalesce([phone], [email])', 'coalesce([discount], 0)']
      ),
      {
        label: 'nullif',
        apply: 'nullif( )',
        cursorOffset: 7,
        i18nDescKey: 'calcFieldDesc_nullif',
        params: [
          { name: 'expr1', type: 'any' },
          { name: 'expr2', type: 'any' },
        ],
        returnType: 'any',
        examples: ["nullif([status], 'CANCELLED')"],
      },
    ],
  },
  {
    i18nKey: 'calcFieldCategoryType',
    tokens: [
      {
        label: 'CAST',
        apply: 'CAST( AS )',
        cursorOffset: 5,
        i18nDescKey: 'calcFieldDesc_cast',
        params: [
          { name: 'expr', type: 'any' },
          { name: 'type', type: 'type' },
        ],
        returnType: 'any',
        examples: ['CAST([amount] AS double)', 'CAST([date] AS date)'],
      },
    ],
  },
];

interface GlassFunctionHelperProps {
  onInsert: (text: string, cursorOffset?: number) => void;
  excludeCategories?: string[];
  onTokenHover?: (token: HelperToken | null) => void;
}

export function GlassFunctionHelper({
  onInsert,
  excludeCategories,
  onTokenHover,
}: GlassFunctionHelperProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

  const [query, setQuery] = useState('');
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);

  const rawGroups = useMemo(
    () =>
      excludeCategories
        ? FUNCTION_GROUPS.filter((g) => !excludeCategories.includes(g.i18nKey))
        : FUNCTION_GROUPS,
    [excludeCategories]
  );

  const groups = useMemo(() => {
    if (!query.trim()) return rawGroups;
    const q = query.toLowerCase();
    return rawGroups
      .map((g) => ({
        ...g,
        tokens: g.tokens.filter((t) => t.label.toLowerCase().includes(q)),
      }))
      .filter((g) => g.tokens.length > 0);
  }, [rawGroups, query]);

  const handleHover = useCallback(
    (token: HelperToken, label: string) => {
      setHoveredLabel(label);
      onTokenHover?.(token);
    },
    [onTokenHover]
  );

  return (
    <div className="flex flex-col gap-2 min-h-0">
      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr('calcFieldFnSearchPlaceholder', '搜索函数')}
          className="h-7 w-full rounded-md border border-border-muted bg-background/42 pl-6 pr-2 text-[11px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
        />
      </div>
      <div className="space-y-2 flex-1 overflow-y-auto min-h-0">
        {groups.length === 0 ? (
          <div className="px-2 py-4 text-center text-[11px] text-text-muted">
            {tr('noMatch', '无匹配函数')}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.i18nKey}>
              <div className="mb-1 text-[11px] font-medium text-text-muted">
                {tr(group.i18nKey, group.i18nKey)}
              </div>
              <div className="flex flex-wrap gap-1">
                {group.tokens.map((token) => (
                  <button
                    key={token.label}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onInsert(token.apply, token.cursorOffset);
                    }}
                    onMouseEnter={() => handleHover(token, token.label)}
                    className={hoveredLabel === token.label ? FN_CHIP_HOVERED : FN_CHIP}
                  >
                    {token.label}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
