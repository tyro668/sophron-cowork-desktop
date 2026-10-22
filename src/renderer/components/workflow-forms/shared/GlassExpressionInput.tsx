import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useFormTranslation } from '../../../hooks/useFormTranslation';
import { AlertCircle, ChevronDown, Search, SquareFunction, X } from 'lucide-react';
import { StreamLanguage } from '@codemirror/language';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  lineNumbers,
  placeholder,
  keymap,
  type DecorationSet,
} from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { tags } from '@lezer/highlight';
import { DataTypeIcon } from './DataTypeIcon';
import './form-grid.css';
import { closerFor, lintExpression, type ExpressionIssue } from './expressionLint';
import { isCalculationSceneDslId } from '../../../../shared/calculate-field/function-registry';
import { Dialog } from '../../ui/dialog';
import { analyzeExpression, lookupExpressionFunction } from '../../../../shared/expression';

export interface ExpressionAssistantPanelContext {
  currentExpression: string;
  insertExpression: (expression: string) => void;
  replaceExpression: (expression: string) => void;
  closePanel: () => void;
  /** When set, the assistant must render this in place of its footer row. */
  footerOverride?: ReactNode;
}

export interface ExpressionAssistantPanel {
  openLabel: string;
  closeLabel: string;
  /** Grid template for the assistant mode; the dialog header is laid on it. */
  gridColumns: string;
  /** Number of columns the header title spans in assistant mode. */
  titleSpan: number;

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
        examples: ['if [amount] > 0 then [amount] / [quantity] else 0 end'],
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
        label: 'cast',
        apply: 'cast( as )',
        cursorOffset: 5,
        i18nDescKey: 'expressionFunctionDesc_cast',
        params: [
          { name: 'expr', type: 'any' },
          { name: 'type', type: 'type' },
        ],
        returnType: 'any',
        examples: ['cast([amount] as float)', 'cast([date] as date)'],
      },
      {
        label: 'try_cast',
        apply: 'try_cast( as )',
        cursorOffset: 9,
        i18nDescKey: 'expressionFunctionDesc_try_cast',
        params: [
          { name: 'expr', type: 'any' },
          { name: 'type', type: 'type' },
        ],
        returnType: 'any',
        examples: ['try_cast([amount] as integer)', 'try_cast([revenue] as float)'],
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
  /** Dialog title (defaults to the generic formula-editor title). */
  title?: string;
  /** Muted context shown next to the title, e.g. 「计算字段 · 第 1 行」. */
  subtitle?: string;
  /** Fields the linter treats as known (defaults to fieldCompletions). */
  lintFields?: string[];
}

const EXPR_KEYWORDS = new Set([
  // SQL/expression keywords
  'if',
  'then',
  'else',
  'end',
  'null',
  'and',
  'or',
  'not',
  'as',
  'case',
  'when',
  'in',
  'is',
  'like',
  'distinct',
  'between',
  // calculation DSL window/scene clause keywords
  'over',
  'partition',
  'by',
  'order',
  'asc',
  'desc',
  'unbounded',
  'preceding',
  'following',
  'current',
  'row',
  'rows',
  'range',
  'groups',
  'exclude',
  'interval',
  'no',
  'others',
  'ties',
]);

/** ExprType → helper vocabulary key used by the type chips. */
const EXPR_TYPE_HELP: Record<string, string> = {
  text: 'string',
  integer: 'int',
  float: 'number',
  decimal: 'number',
  boolean: 'boolean',
  date: 'date',
  datetime: 'date_time',
  null: 'any',
  unknown: 'any',
};

const FUNCTION_CALL_TAG = tags.function(tags.name);

export const exprLanguage = StreamLanguage.define({
  name: 'aggregate-expr',
  // `tags.function` is a modifier, not a Tag — route the token name through a
  // proper modified tag so call identifiers actually highlight.
  tokenTable: { function: FUNCTION_CALL_TAG },
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/\[[^\]]*\]/)) return 'variableName';
    if (stream.match(/'(?:[^'\\]|\\.)*'/)) return 'string';
    if (stream.match(/"(?:[^"\\]|\\.)*"/)) return 'string';
    if (stream.match(/\d+(?:\.\d+)?/)) return 'number';
    const identMatch = stream.match(/[A-Za-z_][A-Za-z0-9_]*/);
    if (identMatch) {
      const word = (Array.isArray(identMatch) ? String(identMatch[0]) : '').toLowerCase();
      if (word === 'true' || word === 'false') return 'atom';
      if (EXPR_KEYWORDS.has(word)) return 'keyword';
      if (stream.peek() === '(') {
        // scene(operation(...)) — scene wrappers get their own color
        return isCalculationSceneDslId(word) ? 'namespace' : 'function';
      }
      return 'variableName';
    }
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
  { tag: tags.keyword, color: '#1e1b4b', fontWeight: '600' },
  { tag: tags.namespace, color: '#db2777', fontWeight: '600' },
  { tag: FUNCTION_CALL_TAG, color: '#7c3aed', fontWeight: '600' },
  { tag: tags.operator, color: '#475569' },
  { tag: tags.punctuation, color: '#64748b' },
]);

const exprTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--color-surface)',
    fontSize: '13px',
    height: '100%',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    lineHeight: '22px',
    paddingTop: '8px',
    // Paint the gutter strip across the top padding too.
    background:
      'linear-gradient(to right, var(--color-background-secondary) 35px, var(--color-border-subtle) 35px 36px, transparent 36px)',
    overflow: 'auto',
    height: '100%',
  },
  '.cm-gutters': {
    width: '36px',
    backgroundColor: 'var(--color-background-secondary)',
    borderRight: '1px solid var(--color-border-subtle)',
    color: 'var(--color-text-muted)',
    fontSize: '11.5px',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '35px',
    padding: '0',
    textAlign: 'center',
  },
  '.cm-content': {
    boxSizing: 'border-box',
    padding: '0 12px 8px',
    caretColor: 'var(--color-accent)',
  },
  '.cm-line': { padding: '0' },
  '.cm-placeholder': { color: 'var(--color-text-muted)' },
  '.cm-expr-issue': {
    textDecoration: 'underline wavy var(--color-error)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '3px',
  },
  '.cm-expr-issue-field': { color: 'var(--color-error)' },
});

const setIssuesEffect = StateEffect.define<ExpressionIssue[]>();
const issueField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setIssuesEffect)) {
        const len = tr.state.doc.length;
        next = Decoration.set(
          effect.value
            .filter((issue) => issue.to <= len && issue.from < issue.to)
            .map((issue) =>
              Decoration.mark({
                class:
                  issue.kind === 'unknownField'
                    ? 'cm-expr-issue cm-expr-issue-field'
                    : 'cm-expr-issue',
              }).range(issue.from, issue.to)
            ),
          true
        );
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const FORMULA_EDITOR_GRID_COLUMNS =
  '36px minmax(0,1fr) minmax(0,1.13fr) 64px minmax(0,1fr) 96px 96px 44px';

const EDITOR_HEIGHT = 96;
const ROW_BORDER = 'border-b border-border-subtle';
const COL_BORDER = 'border-r border-border-subtle';
const PANE_HEADER = `flex h-[30px] shrink-0 items-center bg-background-secondary px-3 text-[11.5px] font-medium text-text-muted ${ROW_BORDER}`;
const PANE_SEARCH = `relative flex h-9 shrink-0 items-center ${ROW_BORDER}`;
const PANE_SEARCH_INPUT =
  'h-full w-full bg-transparent pl-8 pr-3 text-[12.5px] text-text-primary outline-none placeholder:text-text-muted';
const LIST_ROW = `flex h-9 w-full shrink-0 cursor-pointer items-center gap-2.5 px-2.5 text-left text-[13px] transition-colors ${ROW_BORDER} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30`;

function sortFields(fields: string[], query: string): string[] {
  const filtered = query.trim()
    ? fields.filter((f) => f.toLowerCase().includes(query.toLowerCase()))
    : fields;
  return [...filtered].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

type Tr = (key: string, params?: Record<string, unknown>) => string;

/** Localized helper vocabulary (param names, types, example fields). */
function helpTerm(tr: Tr, group: 'params' | 'types' | 'fields', name: string): string {
  return tr(`expressionHelp.${group}.${name.replace(/[^A-Za-z0-9_]/g, '_')}`, {
    defaultValue: name,
  });
}

function localizeExample(example: string, tr: Tr): string {
  return example.replace(/\[([A-Za-z_][A-Za-z0-9_]*)\]/g, (_m, name: string) => {
    return `[${helpTerm(tr, 'fields', name)}]`;
  });
}

/** Function-list label: `year(日期)` for plain calls, raw label for syntax forms. */
function tokenDisplayLabel(token: HelperToken, tr: Tr): string {
  if (!token.apply.endsWith('()') || !token.params) return token.label;
  return `${token.label}(${token.params.map((p) => helpTerm(tr, 'params', p.name)).join(', ')})`;
}

function returnTypeText(token: HelperToken, tr: Tr): string {
  if (!token.returnType) return '—';
  if (token.returnType === 'any') {
    const same = token.params?.find((p) => p.name === 'thenExpr' || p.name === 'result');
    const source = same ?? token.params?.find((p) => p.type === 'any');
    if (source) return tr('expressionReturnSameAs', { name: helpTerm(tr, 'params', source.name) });
  }
  return helpTerm(tr, 'types', token.returnType);
}

function FunctionDetailPanel({
  token,
  tr,
  onInsert,
}: {
  token: HelperToken | null;
  tr: Tr;
  onInsert: (text: string, cursorOffset?: number) => void;
}) {
  if (!token) {
    return (
      <div className="flex flex-1 items-center justify-center px-3 text-center text-[12px] text-text-muted">
        {tr('expressionFunctionDetailHint')}
      </div>
    );
  }
  const row = (label: string, body: ReactNode, key: string) => (
    <Fragment key={key}>
      <div
        className={`flex min-h-9 items-center bg-background-secondary px-3 text-[12px] text-text-muted ${ROW_BORDER} ${COL_BORDER}`}
      >
        {label}
      </div>
      <div className={`flex min-h-9 min-w-0 items-center px-3 py-1.5 text-[12.5px] ${ROW_BORDER}`}>
        {body}
      </div>
    </Fragment>
  );
  const aliases = lookupExpressionFunction(token.label)?.aliases ?? [];
  return (
    <div className="grid min-h-0 grid-cols-[64px_minmax(0,1fr)] content-start overflow-y-auto">
      {aliases.length > 0 &&
        row(
          tr('expressionDetailAliases'),
          <span className="flex flex-wrap gap-1.5 font-mono text-text-primary">
            {aliases.map((a) => (
              <button
                key={a}
                type="button"
                className="hover:text-accent"
                onClick={() => onInsert(`${a}()`, a.length + 1)}
              >
                {a}()
              </button>
            ))}
          </span>,
          'aliases'
        )}
      {row(
        tr('expressionDetailPurpose'),
        <span className="text-text-primary">
          {token.i18nDescKey ? tr(token.i18nDescKey) : '—'}
        </span>,
        'purpose'
      )}
      {row(
        tr('expressionDetailParams'),
        token.params && token.params.length > 0 ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {token.params.map((p) => (
              <span key={p.name} className="inline-flex items-center gap-1 text-text-primary">
                {helpTerm(tr, 'params', p.name)}
                <span className="rounded-full border border-accent/30 bg-accent-muted px-1.5 text-[11px] leading-[18px] text-accent">
                  {helpTerm(tr, 'types', p.type)}
                </span>
                {p.optional && (
                  <span className="text-[11px] text-text-muted">{tr('optional')}</span>
                )}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-text-muted">—</span>
        ),
        'params'
      )}
      {row(
        tr('expressionDetailReturn'),
        <span className="text-text-primary">{returnTypeText(token, tr)}</span>,
        'return'
      )}
      {(token.examples ?? [])
        .slice(0, 2)
        .map((ex, i) =>
          row(
            i === 0 ? tr('expressionDetailExample') : '',
            <code className="break-all font-mono text-[12.5px] text-text-primary">
              {localizeExample(ex, tr)}
            </code>,
            `ex-${i}`
          )
        )}
      {row(
        '',
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsert(token.apply, token.cursorOffset)}
          className="text-[12.5px] text-accent hover:underline"
        >
          {tr('expressionInsertAtCursor')}
        </button>,
        'insert'
      )}
    </div>
  );
}

function FunctionList({
  functionGroups,
  excludeCategories,
  selected,
  onSelect,
  onInsert,
  tr,
}: {
  functionGroups: ExpressionFunctionGroup[];
  excludeCategories?: string[];
  selected: HelperToken | null;
  onSelect: (token: HelperToken) => void;
  onInsert: (text: string, cursorOffset?: number) => void;
  tr: Tr;
}) {
  const [query, setQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const groups = useMemo(() => {
    const raw = excludeCategories
      ? functionGroups.filter((g) => !excludeCategories.includes(g.i18nKey))
      : functionGroups;
    if (!query.trim()) return raw;
    const q = query.toLowerCase();
    return raw
      .map((g) => ({
        ...g,
        tokens: g.tokens.filter(
          (t) =>
            t.label.toLowerCase().includes(q) || tokenDisplayLabel(t, tr).toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.tokens.length > 0);
  }, [excludeCategories, functionGroups, query, tr]);

  return (
    <>
      <div className={PANE_SEARCH}>
        <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr('expressionFunctionSearchPlaceholder')}
          aria-label={tr('expressionFunctionSearchPlaceholder')}
          className={PANE_SEARCH_INPUT}
        />
      </div>
      <div className="fx-list min-h-0 flex-1" role="listbox">
        {groups.length === 0 ? (
          <div className="px-3 py-4 text-center text-[12px] text-text-muted">
            {tr('fieldPicker.noMatch')}
          </div>
        ) : (
          groups.map((group) => {
            const collapsed = collapsedGroups.has(group.i18nKey);
            return (
              <div key={group.i18nKey}>
                <button
                  type="button"
                  aria-expanded={!collapsed}
                  onClick={() =>
                    setCollapsedGroups((current) => {
                      const next = new Set(current);
                      if (next.has(group.i18nKey)) next.delete(group.i18nKey);
                      else next.add(group.i18nKey);
                      return next;
                    })
                  }
                  className={`flex h-[30px] w-full items-center gap-1.5 bg-background-secondary px-3 text-left text-[12px] text-text-muted hover:text-text-secondary ${ROW_BORDER}`}
                >
                  <ChevronDown
                    className={`h-3.5 w-3.5 shrink-0 transition-transform ${collapsed ? '-rotate-90' : ''}`}
                  />
                  {tr(group.i18nKey)}
                </button>
                {!collapsed &&
                  group.tokens.map((token) => {
                    const isSelected = selected?.label === token.label;
                    return (
                      <button
                        key={token.label}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        title={tr('expressionFunctionInsertHint')}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onSelect(token)}
                        onDoubleClick={() => onInsert(token.apply, token.cursorOffset)}
                        className={`${LIST_ROW} font-mono text-[12.5px] ${
                          isSelected
                            ? 'bg-accent-muted text-accent'
                            : 'text-text-secondary hover:bg-surface-hover'
                        }`}
                      >
                        <span className="truncate">{tokenDisplayLabel(token, tr)}</span>
                      </button>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>
    </>
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
  title,
  subtitle,
  lintFields,
}: GlassExpressionInputProps) {
  const tr = useFormTranslation('expression');
  const [open, setOpen] = useState(false);
  const label = title ?? tr('expressionEditorTitle');
  const issueCount = useMemo(
    () => (value?.trim() ? lintExpression(value, lintFields ?? fieldCompletions).length : 0),
    [fieldCompletions, lintFields, value]
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={label}
        title={value || undefined}
        style={{ paddingLeft: 10 }}
        className="relative flex h-full min-h-8 w-full cursor-pointer items-center bg-transparent px-2.5 pr-8 text-left font-mono text-[12.5px] text-text-primary outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30"
      >
        <span className={`block min-w-0 shrink truncate${issueCount > 0 ? ' text-error' : ''}`}>
          {value || (
            <span className="font-sans text-text-muted">
              {placeholderProp ?? tr('expressionPlaceholder')}
            </span>
          )}
        </span>
        {issueCount > 0 && (
          <span className="ml-1.5 inline-flex h-[18px] shrink-0 items-center rounded-md bg-error/[0.08] px-1.5 font-sans text-[11px] text-error">
            {tr('expressionIssueCount', { count: issueCount })}
          </span>
        )}
        <SquareFunction className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
      </button>
      {open && (
        <ExpressionEditorDialog
          value={value}
          onChange={onChange}
          fieldCompletions={fieldCompletions}
          columnTypes={columnTypes}
          onClose={() => setOpen(false)}
          excludeFunctionCategories={excludeFunctionCategories}
          functionGroups={functionGroups}
          assistantPanel={assistantPanel}
          title={label}
          subtitle={subtitle}
          lintFields={lintFields}
          tr={tr}
        />
      )}
    </>
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
  title,
  subtitle,
  lintFields,
  tr,
}: GlassExpressionInputProps & {
  onClose: () => void;
  tr: Tr;
}) {
  const [draft, setDraft] = useState(value);
  const initialDraftRef = useRef(value);
  const [mode, setMode] = useState<'functions' | 'wizard'>('functions');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [fieldQuery, setFieldQuery] = useState('');
  const [selectedToken, setSelectedToken] = useState<HelperToken | null>(
    () => functionGroups[0]?.tokens[0] ?? null
  );
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeCompartment = useRef(new Compartment());

  const sortedFields = useMemo(
    () => sortFields(fieldCompletions, fieldQuery),
    [fieldCompletions, fieldQuery]
  );
  const issues = useMemo(
    () => lintExpression(draft, lintFields ?? fieldCompletions),
    [draft, fieldCompletions, lintFields]
  );
  // Typed expression layer: result type (or first grammar error) for the status bar.
  const analysis = useMemo(
    () => (draft.trim() ? analyzeExpression(draft, columnTypes ?? {}) : null),
    [draft, columnTypes]
  );
  const dirty = draft !== initialDraftRef.current;
  const placeholderText = useMemo(() => tr('expressionPlaceholder'), [tr]);

  const confirmRef = useRef<() => void>(() => undefined);
  const requestCloseRef = useRef<() => void>(() => undefined);

  useLayoutEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialDraftRef.current,
        extensions: [
          lineNumbers(),
          exprLanguage,
          syntaxHighlighting(exprHighlightStyle),
          exprTheme,
          issueField,
          placeholder(placeholderText),
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => {
                confirmRef.current();
                return true;
              },
            },
            ...defaultKeymap,
          ]),
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
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [placeholderText]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setIssuesEffect.of(issues) });
  }, [issues]);

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

  const jumpTo = useCallback((offset: number) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
    view.focus();
  }, []);

  const handleConfirm = useCallback(() => {
    if (issues.length > 0) return;
    onChange(draft);
    onClose();
  }, [draft, issues.length, onChange, onClose]);
  confirmRef.current = handleConfirm;

  const requestClose = useCallback(() => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }, [dirty, onClose]);
  requestCloseRef.current = requestClose;

  const wizard = mode === 'wizard' && assistantPanel;
  const columns = wizard ? assistantPanel.gridColumns : FORMULA_EDITOR_GRID_COLUMNS;
  const titleSpan = wizard ? assistantPanel.titleSpan : 5;
  const rows = wizard
    ? '44px 36px minmax(0,1fr) 48px'
    : `44px ${EDITOR_HEIGHT}px ${issues.map(() => '30px ').join('')}minmax(0,1fr) 48px`;

  const tabClass = (active: boolean) =>
    `flex items-center justify-center border-l border-border-subtle text-[12.5px] font-medium transition-colors ${ROW_BORDER} ${
      active
        ? 'bg-accent-muted text-accent'
        : 'bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary'
    }`;

  const footerButton = `flex items-center justify-center border-l border-border-subtle text-[12.5px] font-medium transition-colors`;

  const discardFooter = confirmDiscard && (
    <Fragment key="discard">
      <div
        style={{ gridColumn: `span ${titleSpan}` }}
        className="flex items-center gap-2 px-3 text-[12.5px] text-text-primary"
        role="alert"
      >
        <AlertCircle className="h-3.5 w-3.5 text-warning" />
        {tr('expressionDiscardPrompt')}
      </div>
      <button
        type="button"
        autoFocus
        onClick={() => setConfirmDiscard(false)}
        className={`${footerButton} bg-surface text-text-primary hover:bg-surface-hover`}
      >
        {tr('expressionKeepEditing')}
      </button>
      <button
        type="button"
        onClick={onClose}
        style={{ gridColumn: 'span 2' }}
        className={`${footerButton} bg-error text-white hover:bg-error/90`}
      >
        {tr('expressionDiscardChanges')}
      </button>
    </Fragment>
  );

  return (
    <Dialog
      open
      onOpenChange={() => requestCloseRef.current()}
      closeOnOverlayClick
      closeOnEscape
      ariaLabel={title}
      overlayClassName="bg-black/28 px-4 py-6"
      className={`${wizard ? 'h-[520px]' : 'h-[600px]'} w-[920px] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-xl p-0 shadow-card`}
    >
      <div
        data-testid="formula-editor-grid"
        className="grid h-full w-full min-h-0"
        style={{ gridTemplateColumns: columns, gridTemplateRows: rows }}
      >
        <div
          key="title"
          style={{ gridColumn: `span ${titleSpan}` }}
          className={`flex min-w-0 items-center gap-2.5 px-3 ${ROW_BORDER}`}
        >
          <h3 className="shrink-0 text-[14px] font-semibold text-text-primary">{title}</h3>
          {subtitle && <span className="truncate text-[12.5px] text-text-muted">{subtitle}</span>}
        </div>
        {assistantPanel ? (
          <>
            <button
              key="tab-fn"
              type="button"
              aria-pressed={!wizard}
              onClick={() => setMode('functions')}
              className={tabClass(!wizard)}
            >
              {tr('expressionTabFunctions')}
            </button>
            <button
              key="tab-wiz"
              type="button"
              aria-pressed={!!wizard}
              onClick={() => setMode('wizard')}
              className={tabClass(!!wizard)}
            >
              {assistantPanel.openLabel}
            </button>
          </>
        ) : (
          <div key="tab-blank" style={{ gridColumn: 'span 2' }} className={ROW_BORDER} />
        )}
        <button
          key="close"
          type="button"
          onClick={requestClose}
          aria-label={tr('cancel')}
          className={`flex items-center justify-center border-l border-border-subtle text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary ${ROW_BORDER}`}
        >
          <X className="h-4 w-4" />
        </button>

        {/* The CodeMirror host stays mounted while the wizard is shown so the
            draft and cursor survive the mode switch. */}
        <div
          key="editor"
          ref={hostRef}
          aria-label={title}
          style={{ gridColumn: '1 / -1' }}
          className={wizard ? 'hidden' : `min-h-0 ${ROW_BORDER}`}
        />

        {wizard ? (
          assistantPanel.render({
            currentExpression: draft,
            insertExpression: (text) => {
              editAtCursor(text);
              setMode('functions');
            },
            replaceExpression: (text) => {
              replaceExpression(text);
              setMode('functions');
            },
            closePanel: () => setMode('functions'),
            footerOverride: discardFooter || undefined,
          })
        ) : (
          <>
            {issues.map((issue) => (
              <button
                key={`issue-${issue.from}-${issue.kind}`}
                type="button"
                onClick={() => jumpTo(issue.from)}
                style={{ gridColumn: '1 / -1' }}
                className={`flex min-w-0 items-center gap-2 bg-error/[0.06] px-3 text-left text-[12px] text-error ${ROW_BORDER}`}
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <b className="shrink-0 font-semibold">
                  {tr('expressionLineCol', { line: issue.line, column: issue.column })}
                </b>
                <span className="truncate">
                  {issue.kind === 'unknownField'
                    ? tr('expressionLintUnknownField', { name: issue.detail })
                    : issue.kind === 'unclosed'
                      ? tr('expressionLintUnclosed', { closer: closerFor(issue.detail) })
                      : tr('expressionLintUnexpectedClose', { char: issue.detail })}
                </span>
              </button>
            ))}

            <div
              key="fields"
              style={{ gridColumn: 'span 2' }}
              className={`flex min-h-0 flex-col ${COL_BORDER} ${ROW_BORDER}`}
            >
              <div className={PANE_HEADER}>{tr('expressionFieldsTab')}</div>
              <div className={PANE_SEARCH}>
                <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-text-muted" />
                <input
                  type="text"
                  value={fieldQuery}
                  onChange={(e) => setFieldQuery(e.target.value)}
                  placeholder={tr('expressionFieldSearchPlaceholder')}
                  aria-label={tr('expressionFieldSearchPlaceholder')}
                  className={PANE_SEARCH_INPUT}
                />
              </div>
              <div className="fx-list min-h-0 flex-1">
                {sortedFields.length === 0 ? (
                  <div className="px-3 py-4 text-center text-[12px] text-text-muted">
                    {tr('fieldPicker.noMatch')}
                  </div>
                ) : (
                  sortedFields.map((col) => (
                    <button
                      key={col}
                      type="button"
                      title={tr('expressionFieldInsertHint')}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        editAtCursor(`[${col}]`);
                      }}
                      className={`${LIST_ROW} text-text-primary hover:bg-surface-hover`}
                    >
                      <DataTypeIcon type={columnTypes?.[col]} />
                      <span className="min-w-0 truncate">{col}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
            <div key="functions" className={`flex min-h-0 flex-col ${COL_BORDER} ${ROW_BORDER}`}>
              <div className={PANE_HEADER}>{tr('expressionFunctionHelperLabel')}</div>
              <FunctionList
                functionGroups={functionGroups}
                excludeCategories={excludeFunctionCategories}
                selected={selectedToken}
                onSelect={setSelectedToken}
                onInsert={editAtCursor}
                tr={tr}
              />
            </div>
            <div
              key="detail"
              style={{ gridColumn: 'span 5' }}
              className={`flex min-h-0 flex-col ${ROW_BORDER}`}
            >
              <div className={PANE_HEADER}>
                {tr('expressionFunctionDetailLabel')}
                {selectedToken && (
                  <span className="ml-1 truncate font-normal">· {selectedToken.label}</span>
                )}
              </div>
              <FunctionDetailPanel token={selectedToken} tr={tr} onInsert={editAtCursor} />
            </div>

            {discardFooter || (
              <>
                <div
                  key="status"
                  style={{ gridColumn: 'span 5' }}
                  className="flex min-w-0 items-center gap-2.5 px-3 text-[12px] text-text-muted"
                >
                  {issues.length > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-error/[0.08] px-2 py-0.5 text-[12.5px] text-error">
                      <span className="h-1.5 w-1.5 rounded-full bg-error" />
                      {tr('expressionIssueCount', { count: issues.length })}
                    </span>
                  )}
                  {issues.length === 0 && analysis?.ok && analysis.type && (
                    <span
                      data-testid="expression-result-type"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent-muted px-2 py-0.5 text-[12.5px] text-accent"
                    >
                      {tr('expressionResultType', {
                        type: helpTerm(tr, 'types', EXPR_TYPE_HELP[analysis.type] ?? 'any'),
                      })}
                    </span>
                  )}
                  {issues.length === 0 && analysis && !analysis.ok && (
                    <span
                      data-testid="expression-grammar-error"
                      title={analysis.error?.message}
                      className="inline-flex min-w-0 items-center gap-1.5 truncate rounded-md bg-error/[0.08] px-2 py-0.5 text-[12.5px] text-error"
                    >
                      {analysis.error?.message}
                    </span>
                  )}
                  <span className="truncate">{tr('expressionShortcutHint')}</span>
                </div>
                <button
                  key="cancel"
                  type="button"
                  onClick={requestClose}
                  className={`${footerButton} bg-surface text-text-primary hover:bg-surface-hover`}
                >
                  {tr('cancel')}
                </button>
                <button
                  key="confirm"
                  type="button"
                  onClick={handleConfirm}
                  disabled={issues.length > 0}
                  aria-disabled={issues.length > 0}
                  title={issues.length > 0 ? tr('expressionConfirmBlocked') : undefined}
                  style={{ gridColumn: 'span 2' }}
                  className={`${footerButton} bg-accent text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent`}
                >
                  {tr('confirm')}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
