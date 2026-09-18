import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useFormTranslation } from '../../../hooks/useFormTranslation';
import { Pencil, X, ChevronDown, Search, WandSparkles } from 'lucide-react';
import { StreamLanguage } from '@codemirror/language';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, placeholder, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { Tag, tags } from '@lezer/highlight';
import { DataTypeIcon } from './DataTypeIcon';
import { Button } from '../../ui/button';
import { Dialog } from '../../ui/dialog';

export interface ExpressionAssistantPanelContext {
  currentExpression: string;
  insertExpression: (expression: string) => void;
  replaceExpression: (expression: string) => void;
  closePanel: () => void;
}

export interface ExpressionAssistantPanel {
  openLabel: string;
  closeLabel: string;
  render: (context: ExpressionAssistantPanelContext) => ReactNode;
}

export interface HelperToken {
  label: string;
  apply: string;
  cursorOffset?: number;
  i18nDescKey?: string;
  params?: Array<{ name: string; type: string; optional?: boolean }>;
  returnType?: string;
  examples?: string[];
}

export function functionToken(
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
  'flex min-h-8 w-full cursor-pointer items-center px-3 text-left font-mono text-[12px] uppercase text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30';
const FN_CHIP_HOVERED =
  'flex min-h-8 w-full cursor-pointer items-center bg-accent-muted px-3 text-left font-mono text-[12px] uppercase text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30';
const MIN_EXPRESSION_EDITOR_HEIGHT = 80;
const DEFAULT_EXPRESSION_EDITOR_HEIGHT = 104;
const MAX_EXPRESSION_EDITOR_HEIGHT = 240;
const EXPRESSION_EDITOR_RESIZE_STEP = 16;

export interface ExpressionFunctionGroup {
  i18nKey: string;
  tokens: HelperToken[];
}

export const COMMON_EXPRESSION_FUNCTION_GROUPS: ExpressionFunctionGroup[] = [
  {
    i18nKey: 'expressionFunctionCategoryCondition',
    tokens: [
      {
        label: 'if … then … else … end',
        apply: 'if  then  else  end',
        cursorOffset: 3,
        i18nDescKey: 'expressionFunctionDesc_ifElseEnd',
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
        i18nDescKey: 'expressionFunctionDesc_ifEnd',
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
        i18nDescKey: 'expressionFunctionDesc_caseWhenEnd',
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
    i18nKey: 'expressionFunctionCategoryDate',
    tokens: [
      functionToken(
        'year',
        'expressionFunctionDesc_year',
        [{ name: 'date', type: 'date' }],
        'int',
        ['year([order_date])']
      ),
      functionToken(
        'month',
        'expressionFunctionDesc_month',
        [{ name: 'date', type: 'date' }],
        'int',
        ['month([order_date])']
      ),
      functionToken('day', 'expressionFunctionDesc_day', [{ name: 'date', type: 'date' }], 'int', [
        'day([order_date])',
      ]),
      ...[
        ['quarter', 'int'],
        ['week', 'int'],
        ['dayofweek', 'int'],
        ['dayofyear', 'int'],
        ['hour', 'int'],
        ['minute', 'int'],
        ['second', 'int'],
      ].map(([name, returnType]) =>
        functionToken(
          name,
          `expressionFunctionDesc_${name}`,
          [{ name: 'date', type: 'date/time' }],
          returnType,
          [`${name}([order_time])`]
        )
      ),
      functionToken(
        'date_diff',
        'expressionFunctionDesc_date_diff',
        [
          { name: 'part', type: 'string' },
          { name: 'start', type: 'date' },
          { name: 'end', type: 'date' },
        ],
        'int',
        ["date_diff('day', [start], [end])"]
      ),
      functionToken(
        'date_trunc',
        'expressionFunctionDesc_date_trunc',
        [
          { name: 'part', type: 'string' },
          { name: 'date', type: 'date' },
        ],
        'date',
        ["date_trunc('month', [date])"]
      ),
      functionToken(
        'strftime',
        'expressionFunctionDesc_strftime',
        [
          { name: 'date', type: 'date/time' },
          { name: 'format', type: 'string' },
        ],
        'string',
        ["strftime([order_date], '%Y-%m')"]
      ),
      functionToken(
        'last_day',
        'expressionFunctionDesc_last_day',
        [{ name: 'date', type: 'date' }],
        'date',
        ['last_day([order_date])']
      ),
      functionToken(
        'strptime',
        'expressionFunctionDesc_parse_date',
        [
          { name: 'str', type: 'string' },
          { name: 'format', type: 'string' },
        ],
        'date',
        ["strptime([dt], '%Y-%m-%d')", "strptime([dt], '%Y%m%d')"]
      ),
      {
        label: 'current_date',
        apply: 'current_date',
        cursorOffset: 12,
        i18nDescKey: 'expressionFunctionDesc_current_date',
        params: [],
        returnType: 'date',
        examples: ['current_date'],
      },
      {
        label: 'now',
        apply: 'now()',
        cursorOffset: 4,
        i18nDescKey: 'expressionFunctionDesc_now',
        params: [],
        returnType: 'timestamp',
        examples: ['now()'],
      },
    ],
  },
  {
    i18nKey: 'expressionFunctionCategoryMath',
    tokens: [
      functionToken(
        'abs',
        'expressionFunctionDesc_abs',
        [{ name: 'expr', type: 'number' }],
        'number',
        ['abs([amount])', 'abs([profit] - [cost])']
      ),
      functionToken(
        'round',
        'expressionFunctionDesc_round',
        [
          { name: 'expr', type: 'number' },
          { name: 'precision', type: 'int', optional: true },
        ],
        'number',
        ['round([amount])', 'round([amount], 2)']
      ),
      functionToken(
        'ceil',
        'expressionFunctionDesc_ceil',
        [{ name: 'expr', type: 'number' }],
        'number',
        ['ceil([amount])']
      ),
      functionToken(
        'floor',
        'expressionFunctionDesc_floor',
        [{ name: 'expr', type: 'number' }],
        'number',
        ['floor([amount])']
      ),
      functionToken(
        'trunc',
        'expressionFunctionDesc_trunc',
        [
          { name: 'expr', type: 'number' },
          { name: 'precision', type: 'int', optional: true },
        ],
        'number',
        ['trunc([amount])', 'trunc([amount], 2)']
      ),
      ...['sqrt', 'exp', 'ln', 'log10', 'sign'].map((name) =>
        functionToken(
          name,
          `expressionFunctionDesc_${name}`,
          [{ name: 'expr', type: 'number' }],
          'number',
          [`${name}([amount])`]
        )
      ),
      functionToken(
        'pow',
        'expressionFunctionDesc_pow',
        [
          { name: 'base', type: 'number' },
          { name: 'exponent', type: 'number' },
        ],
        'number',
        ['pow([amount], 2)']
      ),
      functionToken(
        'mod',
        'expressionFunctionDesc_mod',
        [
          { name: 'dividend', type: 'number' },
          { name: 'divisor', type: 'number' },
        ],
        'number',
        ['mod([amount], 10)']
      ),
      ...['greatest', 'least'].map((name) =>
        functionToken(
          name,
          `expressionFunctionDesc_${name}`,
          [
            { name: 'expr', type: 'comparable' },
            { name: '...rest', type: 'comparable' },
          ],
          'any',
          [`${name}([actual], [target])`]
        )
      ),
    ],
  },
  {
    i18nKey: 'expressionFunctionCategoryString',
    tokens: [
      functionToken(
        'upper',
        'expressionFunctionDesc_upper',
        [{ name: 'str', type: 'string' }],
        'string',
        ['upper([name])']
      ),
      functionToken(
        'lower',
        'expressionFunctionDesc_lower',
        [{ name: 'str', type: 'string' }],
        'string',
        ['lower([name])']
      ),
      functionToken(
        'trim',
        'expressionFunctionDesc_trim',
        [{ name: 'str', type: 'string' }],
        'string',
        ['trim([name])']
      ),
      functionToken(
        'length',
        'expressionFunctionDesc_length',
        [{ name: 'str', type: 'string' }],
        'int',
        ['length([name])']
      ),
      functionToken(
        'substr',
        'expressionFunctionDesc_substr',
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
        'expressionFunctionDesc_splitPart',
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
        'expressionFunctionDesc_concat',
        [
          { name: 'str', type: 'string' },
          { name: '...rest', type: 'string' },
        ],
        'string',
        ["concat([first], ' ', [last])"]
      ),
      functionToken(
        'concat_ws',
        'expressionFunctionDesc_concat_ws',
        [
          { name: 'separator', type: 'string' },
          { name: 'str', type: 'string' },
          { name: '...rest', type: 'string' },
        ],
        'string',
        ["concat_ws('-', [province], [city], [district])"]
      ),
      ...['left', 'right'].map((name) =>
        functionToken(
          name,
          `expressionFunctionDesc_${name}`,
          [
            { name: 'str', type: 'string' },
            { name: 'count', type: 'int' },
          ],
          'string',
          [`${name}([code], 3)`]
        )
      ),
      functionToken(
        'contains',
        'expressionFunctionDesc_contains',
        [
          { name: 'str', type: 'string' },
          { name: 'substr', type: 'string' },
        ],
        'boolean',
        ["contains([name], 'abc')"]
      ),
      functionToken(
        'starts_with',
        'expressionFunctionDesc_starts_with',
        [
          { name: 'str', type: 'string' },
          { name: 'prefix', type: 'string' },
        ],
        'boolean',
        ["starts_with([code], 'A')"]
      ),
      functionToken(
        'ends_with',
        'expressionFunctionDesc_ends_with',
        [
          { name: 'str', type: 'string' },
          { name: 'suffix', type: 'string' },
        ],
        'boolean',
        ["ends_with([email], '.cn')"]
      ),
      functionToken(
        'replace',
        'expressionFunctionDesc_replace',
        [
          { name: 'str', type: 'string' },
          { name: 'search', type: 'string' },
          { name: 'replacement', type: 'string' },
        ],
        'string',
        ["replace([phone], '-', '')"]
      ),
      functionToken(
        'regexp_replace',
        'expressionFunctionDesc_regexp_replace',
        [
          { name: 'str', type: 'string' },
          { name: 'pattern', type: 'string' },
          { name: 'replacement', type: 'string' },
        ],
        'string',
        ["regexp_replace([phone], '[^0-9]', '')"]
      ),
      functionToken(
        'regexp_extract',
        'expressionFunctionDesc_regexp_extract',
        [
          { name: 'str', type: 'string' },
          { name: 'pattern', type: 'string' },
          { name: 'group', type: 'int', optional: true },
        ],
        'string',
        ["regexp_extract([code], '([0-9]+)', 1)"]
      ),
      functionToken(
        'regexp_matches',
        'expressionFunctionDesc_regexp_matches',
        [
          { name: 'str', type: 'string' },
          { name: 'pattern', type: 'string' },
        ],
        'boolean',
        ["regexp_matches([email], '^[^@]+@[^@]+$')"]
      ),
      functionToken(
        'lpad',
        'expressionFunctionDesc_lpad',
        [
          { name: 'str', type: 'string' },
          { name: 'len', type: 'int' },
          { name: 'pad', type: 'string' },
        ],
        'string',
        ["lpad([code], 6, '0')"]
      ),
      functionToken(
        'rpad',
        'expressionFunctionDesc_rpad',
        [
          { name: 'str', type: 'string' },
          { name: 'len', type: 'int' },
          { name: 'pad', type: 'string' },
        ],
        'string',
        ["rpad([code], 10, ' ')"]
      ),
      functionToken(
        'reverse',
        'expressionFunctionDesc_reverse',
        [{ name: 'str', type: 'string' }],
        'string',
        ['reverse([name])']
      ),
      functionToken(
        'repeat',
        'expressionFunctionDesc_repeat',
        [
          { name: 'str', type: 'string' },
          { name: 'count', type: 'int' },
        ],
        'string',
        ['repeat([ch], 3)']
      ),
    ],
  },
  {
    i18nKey: 'expressionFunctionCategoryNull',
    tokens: [
      functionToken(
        'coalesce',
        'expressionFunctionDesc_coalesce',
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
        i18nDescKey: 'expressionFunctionDesc_nullif',
        params: [
          { name: 'expr1', type: 'any' },
          { name: 'expr2', type: 'any' },
        ],
        returnType: 'any',
        examples: ["nullif([status], 'CANCELLED')", "nullif([name], '')"],
      },
      functionToken(
        'ifnull',
        'expressionFunctionDesc_ifnull',
        [
          { name: 'expr', type: 'any' },
          { name: 'fallback', type: 'any' },
        ],
        'any',
        ['ifnull([discount], 0)']
      ),
    ],
  },
  {
    i18nKey: 'expressionFunctionCategoryType',
    tokens: [
      {
        label: 'CAST',
        apply: 'CAST( AS )',
        cursorOffset: 5,
        i18nDescKey: 'expressionFunctionDesc_cast',
        params: [
          { name: 'expr', type: 'any' },
          { name: 'type', type: 'type' },
        ],
        returnType: 'any',
        examples: ['CAST([amount] AS double)', 'CAST([date] AS date)'],
      },
      {
        label: 'try_cast',
        apply: 'try_cast( AS )',
        cursorOffset: 9,
        i18nDescKey: 'expressionFunctionDesc_try_cast',
        params: [
          { name: 'expr', type: 'any' },
          { name: 'type', type: 'type' },
        ],
        returnType: 'any',
        examples: ['try_cast([amount] AS int)', 'try_cast([revenue] AS double)'],
      },
      functionToken(
        'typeof',
        'expressionFunctionDesc_typeof',
        [{ name: 'expr', type: 'any' }],
        'string',
        ['typeof([amount])']
      ),
    ],
  },
];

export interface GlassExpressionInputProps {
  value: string;
  onChange: (value: string) => void;
  fieldCompletions: string[];
  columnTypes?: Record<string, string>;
  placeholder?: string;
  excludeFunctionCategories?: string[];
  functionGroups?: ExpressionFunctionGroup[];
  assistantPanel?: ExpressionAssistantPanel;
}

const exprLanguage = StreamLanguage.define({
  name: 'aggregate-expr',
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/\[[^\]]*\]/)) return 'variableName';
    if (stream.match(/'(?:[^'\\]|\\.)*'/)) return 'string';
    if (stream.match(/"(?:[^"\\]|\\.)*"/)) return 'string';
    if (stream.match(/\d+(?:\.\d+)?/)) return 'number';
    if (stream.match(/\b(?:if|then|else|end|null|and|or|not|as|case|when)\b/)) return 'keyword';
    if (stream.match(/\b(?:true|false)\b/)) return 'atom';
    if (stream.match(/[A-Za-z_][A-Za-z0-9_]*/)) return 'function';
    if (stream.match(/[+\-*/%=<>!]+/)) return 'operator';
    if (stream.match(/[,;:()[\]]/)) return 'punctuation';
    stream.next();
    return null;
  },
});

const exprHighlightStyle = HighlightStyle.define([
  { tag: tags.variableName, color: '#2563eb' },
  { tag: tags.string, color: '#b45309' },
  { tag: tags.number, color: '#7c3aed' },
  { tag: tags.atom, color: '#2563eb' },
  { tag: tags.keyword, color: '#0f766e', fontWeight: '500' },
  { tag: tags.function as unknown as Tag, color: '#0891b2', fontWeight: '500' },
  { tag: tags.operator, color: '#dc2626' },
  { tag: tags.punctuation, color: '#64748b' },
]);

const exprTheme = EditorView.theme({
  '&': {
    border: '1px solid rgba(148, 163, 184, 0.44)',
    borderRadius: '0.5rem',
    backgroundColor: 'transparent',
    fontSize: '13px',
    height: '100%',
    minHeight: '80px',
  },
  '&.cm-focused': {
    outline: 'none',
    borderColor: 'var(--color-accent)',
    boxShadow: '0 0 0 2px rgba(25, 169, 154, 0.15)',
  },
  '.cm-scroller': {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    lineHeight: '1.6',
    overflow: 'auto',
    height: '100%',
  },
  '.cm-content': {
    boxSizing: 'border-box',
    minHeight: '80px',
    padding: '0.5rem 0.625rem',
    caretColor: '#334155',
  },
  '.cm-line': { padding: '0' },
  '.cm-placeholder': { color: '#94a3b8' },
});

function sortFields(fields: string[], query: string): string[] {
  const filtered = query.trim()
    ? fields.filter((f) => f.toLowerCase().includes(query.toLowerCase()))
    : fields;
  return [...filtered].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function FunctionDetailPanel({
  token,
  tr,
}: {
  token: HelperToken | null;
  tr: (key: string) => string;
}) {
  if (!token) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-text-muted px-3 text-center leading-5">
        {tr('expressionFunctionDetailHint')}
      </div>
    );
  }
  return (
    <div className="space-y-2.5 text-[11px]">
      <div className="text-[13px] font-semibold text-text-primary font-mono">{token.label}</div>
      <div className="space-y-0.5">
        <div className="flex gap-2">
          <span className="text-text-muted shrink-0">{tr('expressionFunctionDescription')}:</span>
          <span className="text-text-secondary">
            {token.i18nDescKey ? tr(token.i18nDescKey) : '-'}
          </span>
        </div>
        {token.returnType && (
          <div className="flex gap-2">
            <span className="text-text-muted shrink-0">{tr('aggregateReturnType')}:</span>
            <code className="rounded bg-accent-muted px-1 text-accent">{token.returnType}</code>
          </div>
        )}
      </div>
      {token.params && token.params.length > 0 && (
        <div>
          <div className="mb-1 text-text-muted">{tr('expressionFunctionArgument')}:</div>
          <div className="space-y-0.5">
            {token.params.map((p) => (
              <div key={p.name} className="flex items-center gap-2 rounded bg-surface px-2 py-1">
                <code className="text-text-primary shrink-0">{p.name}</code>
                <code className="rounded bg-accent-muted px-1 text-[10px] text-accent">
                  {p.type}
                </code>
                {p.optional && (
                  <span className="text-[10px] text-text-muted">{tr('optional')}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {token.examples && token.examples.length > 0 && (
        <div>
          <div className="mb-1 text-text-muted">{tr('expressionFunctionExampleLabel')}:</div>
          <div className="space-y-1">
            {token.examples.map((ex) => (
              <pre
                key={ex}
                className="rounded-md border border-border-muted/60 bg-surface px-2 py-1 font-mono text-[11px] text-text-secondary leading-5 whitespace-pre-wrap break-all"
              >
                {ex}
              </pre>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GlassFunctionHelper({
  onInsert,
  functionGroups,
  excludeCategories,
  onTokenHover,
}: {
  onInsert: (text: string, cursorOffset?: number) => void;
  functionGroups: ExpressionFunctionGroup[];
  excludeCategories?: string[];
  onTokenHover?: (token: HelperToken | null) => void;
}) {
  const tr = useFormTranslation('expression');
  const [query, setQuery] = useState('');
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  const rawGroups = useMemo(
    () =>
      excludeCategories
        ? functionGroups.filter((g) => !excludeCategories.includes(g.i18nKey))
        : functionGroups,
    [excludeCategories, functionGroups]
  );
  const groups = useMemo(() => {
    if (!query.trim()) return rawGroups;
    const q = query.toLowerCase();
    return rawGroups
      .map((g) => ({ ...g, tokens: g.tokens.filter((t) => t.label.toLowerCase().includes(q)) }))
      .filter((g) => g.tokens.length > 0);
  }, [rawGroups, query]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative shrink-0 border-b border-border-muted/60 p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr('expressionFunctionSearchPlaceholder')}
          className="h-8 w-full rounded-md border border-border-muted bg-surface pl-7 pr-2 text-[11px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
        />
      </div>
      <div className="scrollbar-hover flex-1 overflow-y-auto min-h-0">
        {groups.length === 0 ? (
          <div className="px-2 py-4 text-center text-[11px] text-text-muted">
            {tr('fieldPicker.noMatch')}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.i18nKey} className="border-b border-border-muted/60 last:border-b-0">
              <button
                type="button"
                aria-expanded={!collapsedGroups.has(group.i18nKey)}
                onClick={() => {
                  setCollapsedGroups((current) => {
                    const next = new Set(current);
                    if (next.has(group.i18nKey)) next.delete(group.i18nKey);
                    else next.add(group.i18nKey);
                    return next;
                  });
                }}
                className="flex w-full items-center gap-2 border-b border-border-muted/60 bg-surface px-3 py-2 text-left text-[11px] font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 transition-transform ${collapsedGroups.has(group.i18nKey) ? '-rotate-90' : ''}`}
                />
                <span>{tr(group.i18nKey)}</span>
              </button>
              {!collapsedGroups.has(group.i18nKey) && (
                <div className="divide-y divide-border-muted/60">
                  {group.tokens.map((token) => (
                    <button
                      key={token.label}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onInsert(token.apply, token.cursorOffset);
                      }}
                      onMouseEnter={() => {
                        setHoveredLabel(token.label);
                        onTokenHover?.(token);
                      }}
                      className={hoveredLabel === token.label ? FN_CHIP_HOVERED : FN_CHIP}
                    >
                      {token.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function GlassExpressionInput({
  value,
  onChange,
  fieldCompletions,
  columnTypes,
  placeholder: placeholderProp,
  excludeFunctionCategories,
  functionGroups = COMMON_EXPRESSION_FUNCTION_GROUPS,
  assistantPanel,
}: GlassExpressionInputProps) {
  const tr = useFormTranslation('expression');
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div
        onClick={() => setOpen(true)}
        className="relative h-8 w-full cursor-pointer rounded-md border border-border-muted bg-surface text-[12px] text-text-primary outline-none hover:border-accent/40 transition-colors"
      >
        <span className="block truncate px-1.5 leading-7">
          {value || (
            <span className="text-text-muted">
              {placeholderProp ?? tr('expressionPlaceholder')}
            </span>
          )}
        </span>
        <span className="absolute bottom-0 right-0 flex h-4 w-4 items-center justify-center rounded-tl bg-surface text-text-muted opacity-50 hover:opacity-100 transition-opacity">
          <Pencil className="h-3 w-3" />
        </span>
      </div>
    );
  }

  return (
    <ExpressionEditorDialog
      value={value}
      onChange={onChange}
      fieldCompletions={fieldCompletions}
      columnTypes={columnTypes}
      onClose={() => setOpen(false)}
      excludeFunctionCategories={excludeFunctionCategories}
      functionGroups={functionGroups}
      assistantPanel={assistantPanel}
      tr={tr}
    />
  );
}

function ExpressionEditorDialog({
  value,
  onChange,
  fieldCompletions,
  columnTypes,
  onClose,
  excludeFunctionCategories,
  functionGroups = COMMON_EXPRESSION_FUNCTION_GROUPS,
  assistantPanel,
  tr,
}: GlassExpressionInputProps & {
  onClose: () => void;
  tr: (key: string) => string;
}) {
  const [draft, setDraft] = useState(value);
  const initialDraftRef = useRef(value);
  const [showAssistantPanel, setShowAssistantPanel] = useState(false);
  const [editorHeight, setEditorHeight] = useState(DEFAULT_EXPRESSION_EDITOR_HEIGHT);
  const editorResizeRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);
  const [fieldQuery, setFieldQuery] = useState('');
  const [hoveredToken, setHoveredToken] = useState<HelperToken | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeCompartment = useRef(new Compartment());

  const sortedFields = useMemo(
    () => sortFields(fieldCompletions, fieldQuery),
    [fieldCompletions, fieldQuery]
  );
  const placeholderText = useMemo(() => tr('expressionPlaceholder'), [tr]);

  useLayoutEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialDraftRef.current,
        extensions: [
          exprLanguage,
          syntaxHighlighting(exprHighlightStyle),
          exprTheme,
          placeholder(placeholderText),
          keymap.of(defaultKeymap),
          EditorView.lineWrapping,
          onChangeCompartment.current.of(
            EditorView.updateListener.of((update) => {
              if (update.docChanged) setDraft(update.state.doc.toString());
            })
          ),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [placeholderText]);

  const editAtCursor = useCallback((text: string, cursorOffset?: number) => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + (cursorOffset ?? text.length) },
    });
    view.focus();
  }, []);

  const replaceExpression = useCallback((text: string) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: text.length },
    });
    view.focus();
  }, []);

  const clampEditorHeight = useCallback(
    (height: number) =>
      Math.min(MAX_EXPRESSION_EDITOR_HEIGHT, Math.max(MIN_EXPRESSION_EDITOR_HEIGHT, height)),
    []
  );

  const handleEditorResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      editorResizeRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight: editorHeight,
      };
    },
    [editorHeight]
  );

  const handleEditorResizeMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resize = editorResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      setEditorHeight(clampEditorHeight(resize.startHeight + event.clientY - resize.startY));
    },
    [clampEditorHeight]
  );

  const handleEditorResizeEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (editorResizeRef.current?.pointerId !== event.pointerId) return;
    editorResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  function handleConfirm() {
    onChange(draft);
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={onClose}
      closeOnOverlayClick
      closeOnEscape={false}
      ariaLabel={tr('aggregateExpressionEditor')}
      overlayClassName="bg-black/28 px-4 py-6"
      className="h-[36rem] w-[56rem] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-xl p-0 shadow-card"
    >
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[14px] font-medium text-text-primary">
            {tr('aggregateExpressionEditor')}
          </h3>
          {assistantPanel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAssistantPanel((current) => !current)}
              className={`gap-1 border px-2 text-[11px] ${
                showAssistantPanel
                  ? 'border-accent/30 bg-accent-muted text-accent hover:bg-accent-muted hover:text-accent'
                  : 'border-border-muted bg-surface'
              }`}
            >
              <WandSparkles className="h-3.5 w-3.5" />
              {showAssistantPanel ? assistantPanel.closeLabel : assistantPanel.openLabel}
            </Button>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="text-text-muted"
          aria-label={tr('cancel')}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden p-4">
        <div ref={hostRef} className="shrink-0" style={{ height: editorHeight }} />
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-valuemin={MIN_EXPRESSION_EDITOR_HEIGHT}
          aria-valuemax={MAX_EXPRESSION_EDITOR_HEIGHT}
          aria-valuenow={editorHeight}
          tabIndex={0}
          onPointerDown={handleEditorResizeStart}
          onPointerMove={handleEditorResizeMove}
          onPointerUp={handleEditorResizeEnd}
          onPointerCancel={handleEditorResizeEnd}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            const delta =
              event.key === 'ArrowUp'
                ? -EXPRESSION_EDITOR_RESIZE_STEP
                : EXPRESSION_EDITOR_RESIZE_STEP;
            setEditorHeight((current) => clampEditorHeight(current + delta));
          }}
          className="group flex h-4 shrink-0 cursor-row-resize items-center justify-center outline-none"
        >
          <span className="h-px w-full bg-border-muted/60 transition-colors group-hover:bg-accent/50 group-focus-visible:bg-accent" />
        </div>
        {showAssistantPanel && assistantPanel ? (
          assistantPanel.render({
            currentExpression: draft,
            insertExpression: editAtCursor,
            replaceExpression,
            closePanel: () => setShowAssistantPanel(false),
          })
        ) : (
          <div className="grid grid-cols-[1fr_1fr_1.5fr] min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-border-muted/60">
            <div className="flex flex-col border-r border-border-muted/60 min-h-0">
              <div className="flex w-full items-center px-3 py-1.5 text-[11px] font-medium text-text-muted border-b border-border-muted/60">
                {tr('expressionFieldsTab')}
              </div>
              <div className="flex-1 flex flex-col min-h-0">
                <div className="relative shrink-0 px-3 pt-2 pb-2">
                  <Search className="pointer-events-none absolute left-[22px] top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
                  <input
                    type="text"
                    value={fieldQuery}
                    onChange={(e) => setFieldQuery(e.target.value)}
                    placeholder={tr('expressionFieldSearchPlaceholder')}
                    className="h-8 w-full rounded-md border border-border-muted bg-surface pl-7 pr-2 text-[11px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
                  />
                </div>
                <div className="scrollbar-hover flex-1 overflow-y-auto min-h-0">
                  {sortedFields.length === 0 ? (
                    <div className="px-2 py-4 text-center text-[11px] text-text-muted">
                      {tr('fieldPicker.noMatch')}
                    </div>
                  ) : (
                    <div className="divide-y divide-border-muted/60">
                      {sortedFields.map((col) => {
                        const colType = columnTypes?.[col];
                        return (
                          <button
                            key={col}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              editAtCursor(`[${col}]`);
                            }}
                            className="flex min-h-8 w-full cursor-pointer items-center justify-between gap-2 px-3 text-left text-[12px] text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <DataTypeIcon type={colType} />
                              <span className="min-w-0 truncate">{col}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-col border-r border-border-muted/60 min-h-0">
              <div className="flex w-full items-center px-3 py-1.5 text-[11px] font-medium text-text-muted">
                {tr('expressionFunctionHelperLabel')}
              </div>
              <div className="flex-1 border-t border-border-muted/60 min-h-0">
                <GlassFunctionHelper
                  onInsert={editAtCursor}
                  functionGroups={functionGroups}
                  excludeCategories={excludeFunctionCategories}
                  onTokenHover={setHoveredToken}
                />
              </div>
            </div>
            <div className="flex flex-col min-h-0">
              <div className="flex w-full items-center px-3 py-1.5 text-[11px] font-medium text-text-muted">
                {tr('expressionFunctionDetailLabel')}
              </div>
              <div className="scrollbar-hover flex-1 overflow-y-auto border-t border-border-muted/60 p-2 min-h-0">
                <FunctionDetailPanel token={hoveredToken} tr={tr} />
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
        <Button variant="secondary" size="sm" onClick={onClose} className="text-[12px]">
          {tr('cancel')}
        </Button>
        <Button variant="primary" size="sm" onClick={handleConfirm} className="text-[12px]">
          {tr('confirm')}
        </Button>
      </div>
    </Dialog>
  );
}
