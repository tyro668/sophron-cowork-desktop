import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useFormTranslation } from '../../../hooks/useFormTranslation';
import {
  AlertCircle,
  ChevronDown,
  Code2,
  CornerDownLeft,
  Plus,
  Search,
  SquareFunction,
  Wand2,
  X,
} from 'lucide-react';
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
import {
  autocompletion,
  startCompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { windowSuggestionAt } from '../../../../shared/expression/window-suggest';
import { expressionAggregateIssue, rewriteCaseExpression } from '../../../../shared/jflow';
import { tags } from '@lezer/highlight';
import { DataTypeIcon } from './DataTypeIcon';
import './form-grid.css';
import { closerFor, lintExpression, type ExpressionIssue } from './expressionLint';
import { isCalculationSceneDslId } from '../../../../shared/calculate-field/function-registry';
import { Dialog } from '../../ui/dialog';
import {
  analyzeExpression,
  analyzeExpressionList,
  lookupExpressionFunction,
} from '../../../../shared/expression';

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
        label: 'if … then … elseif … else … end',
        apply: 'if  then  elseif  then  else  end',
        cursorOffset: 3,
        i18nDescKey: 'expressionFunctionDesc_ifElseifEnd',
        params: [
          { name: 'condition', type: 'boolean' },
          { name: 'thenExpr', type: 'any' },
          { name: 'condition2', type: 'boolean' },
          { name: 'thenExpr2', type: 'any' },
          { name: 'elseExpr', type: 'any' },
        ],
        returnType: 'any',
        examples: [
          "if [status] = 'PAID' then 1 elseif [status] in ('PART', 'DUE') then 0.5 else 0 end",
        ],
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
  /**
   * Aggregate lint: `row` (derive / filter values — bare aggregates need `over (…)`, nested ones
   * a group) or `metric` (argument of an aggregate metric — any aggregate is nested).
   */
  aggregateContext?: 'row' | 'metric';
  /** Optional pre-expansion (e.g. calculation-field domain DSL → standard expression) before validation. */
  expandExpression?: (text: string) => string;
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
  'elseif',
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
  { tag: tags.variableName, color: 'var(--color-syntax-variable)' },
  { tag: tags.string, color: 'var(--color-syntax-string)' },
  { tag: tags.number, color: 'var(--color-syntax-number)' },
  { tag: tags.atom, color: 'var(--color-syntax-variable)' },
  { tag: tags.keyword, color: 'var(--color-syntax-keyword-strong)', fontWeight: '600' },
  { tag: tags.namespace, color: 'var(--color-syntax-namespace)', fontWeight: '600' },
  { tag: FUNCTION_CALL_TAG, color: 'var(--color-syntax-number)', fontWeight: '600' },
  { tag: tags.operator, color: 'var(--color-text-secondary)' },
  { tag: tags.punctuation, color: 'var(--color-text-muted)' },
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

const EDITOR_HEIGHT = 116;
const ROW_BORDER = 'border-b border-border-subtle';
const COL_BORDER = 'border-r border-border-subtle';
const PANE_HEADER = `flex h-8 shrink-0 items-center justify-between bg-surface-muted px-3 text-[11.5px] font-medium text-text-secondary ${ROW_BORDER}`;
const PANE_SEARCH = `relative flex h-8 shrink-0 items-center bg-surface ${ROW_BORDER}`;
const PANE_SEARCH_INPUT =
  'h-full w-full bg-transparent pl-8 pr-7 text-[12.5px] text-text-primary outline-none placeholder:text-text-muted';
const LIST_ROW = `group flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 px-3 text-left text-[12.5px] transition-colors ${ROW_BORDER} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30`;

const QUICK_OPERATORS: Array<{ label: string; apply: string; cursorOffset?: number }> = [
  { label: '+', apply: ' + ' },
  { label: '-', apply: ' - ' },
  { label: '*', apply: ' * ' },
  { label: '/', apply: ' / ' },
  { label: '( )', apply: '()', cursorOffset: 1 },
  { label: '=', apply: ' = ' },
  { label: '!=', apply: ' != ' },
  { label: '>', apply: ' > ' },
  { label: '<', apply: ' < ' },
  { label: 'and', apply: ' and ' },
  { label: 'or', apply: ' or ' },
];

/** Read-only formula highlighted with the editor's token palette. */
export function FormulaSyntaxText({ text, wrap = false }: { text: string; wrap?: boolean }) {
  const parts = text.split(/(\[[^\]]*\]|'[^']*'|\b[A-Za-z_][A-Za-z0-9_]*\b|\d+(?:\.\d+)?)/g);
  return (
    <code
      className={`min-w-0 font-mono text-[12.5px] leading-[1.55] text-text-primary ${
        wrap ? 'whitespace-pre-wrap break-all' : 'truncate whitespace-pre'
      }`}
      title={text}
    >
      {parts.map((part, i) => {
        if (!part) return null;
        let cls = '';
        if (part.startsWith('[')) cls = 'text-[var(--color-syntax-variable)]';
        else if (part.startsWith("'")) cls = 'text-[var(--color-syntax-string)]';
        else if (/^\d/.test(part)) cls = 'text-[var(--color-syntax-number)]';
        else if (/^[A-Za-z_]/.test(part)) {
          const lower = part.toLowerCase();
          const next = text.slice(parts.slice(0, i + 1).join('').length).trimStart();
          if (EXPR_KEYWORDS.has(lower)) {
            cls = 'font-semibold text-[var(--color-syntax-keyword-strong)]';
          } else if (next.startsWith('(')) {
            cls = isCalculationSceneDslId(lower)
              ? 'font-semibold text-[var(--color-syntax-namespace)]'
              : 'font-semibold text-[var(--color-syntax-number)]';
          } else {
            cls = 'text-[var(--color-syntax-variable)]';
          }
        }
        return (
          <span key={i} className={cls}>
            {part}
          </span>
        );
      })}
    </code>
  );
}

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
      <div className="flex flex-1 flex-col">
        <div className={PANE_HEADER}>
          <span>{tr('expressionFunctionDetailLabel')}</span>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 text-center text-[12.5px] text-text-muted">
          {tr('expressionFunctionDetailHint')}
        </div>
      </div>
    );
  }
  const aliases = lookupExpressionFunction(token.label)?.aliases ?? [];
  const examples = (token.examples ?? []).slice(0, 2);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <div
        className={`flex h-8 shrink-0 items-stretch justify-between bg-surface-muted ${ROW_BORDER}`}
      >
        <div className="flex min-w-0 items-center gap-1.5 px-3.5 text-[11.5px] font-medium text-text-secondary">
          <span className="shrink-0">{tr('expressionFunctionDetailLabel')}</span>
        </div>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsert(token.apply, token.cursorOffset)}
          className="ui-accent-cell h-full shrink-0 border-l border-border-subtle px-3 text-[12px]"
        >
          <CornerDownLeft className="h-3.5 w-3.5" />
          {tr('expressionInsertAtCursor')}
        </button>
      </div>

      <div className="fx-list min-h-0 flex-1 space-y-4 p-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-[14px] font-semibold text-text-primary">
              {tokenDisplayLabel(token, tr)}
            </code>
            {aliases.length > 0 && (
              <span className="inline-flex flex-wrap items-center gap-1">
                {aliases.map((alias) => (
                  <button
                    key={alias}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onInsert(`${alias}()`, alias.length + 1)}
                    className="border border-border-subtle bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] text-text-secondary transition-colors hover:border-accent/40 hover:text-accent"
                  >
                    {alias}()
                  </button>
                ))}
              </span>
            )}
          </div>
          <p className="text-[12.5px] leading-[1.6] text-text-secondary">
            {token.i18nDescKey ? tr(token.i18nDescKey) : '—'}
          </p>
        </div>

        <div className="border border-border-subtle bg-surface">
          <div className="grid grid-cols-[72px_minmax(0,1fr)] border-b border-border-subtle">
            <div className="flex items-center border-r border-border-subtle bg-surface-muted px-2.5 py-2 text-[11.5px] font-medium text-text-secondary">
              {tr('expressionDetailParams')}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-[12.5px]">
              {token.params && token.params.length > 0 ? (
                token.params.map((p) => (
                  <span key={p.name} className="inline-flex items-center gap-1.5 text-text-primary">
                    <span className="font-medium">{helpTerm(tr, 'params', p.name)}</span>
                    <span className="border border-accent/25 bg-accent-muted/70 px-1.5 py-0.5 text-[11px] leading-none text-accent">
                      {helpTerm(tr, 'types', p.type)}
                    </span>
                    {p.optional && (
                      <span className="text-[11px] text-text-muted">{tr('optional')}</span>
                    )}
                  </span>
                ))
              ) : (
                <span className="text-text-muted">—</span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-[72px_minmax(0,1fr)]">
            <div className="flex items-center border-r border-border-subtle bg-surface-muted px-2.5 py-2 text-[11.5px] font-medium text-text-secondary">
              {tr('expressionDetailReturn')}
            </div>
            <div className="flex min-w-0 items-center px-3 py-2 text-[12.5px] text-text-primary">
              {returnTypeText(token, tr)}
            </div>
          </div>
        </div>

        {examples.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11.5px] font-medium text-text-secondary">
              {tr('expressionDetailExample')}
            </div>
            <div className="space-y-1.5">
              {examples.map((ex, i) => {
                const localized = localizeExample(ex, tr);
                return (
                  <div
                    key={`ex-${i}`}
                    className="group flex items-start justify-between gap-2 border border-border-subtle bg-surface-muted/50 px-3 py-2"
                  >
                    <FormulaSyntaxText text={localized} wrap />
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onInsert(localized)}
                      className="shrink-0 text-[11.5px] font-medium text-accent opacity-80 transition-opacity hover:underline group-hover:opacity-100"
                    >
                      {tr('expressionInsertExample')}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
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

  const totalCount = useMemo(() => groups.reduce((acc, g) => acc + g.tokens.length, 0), [groups]);

  return (
    <>
      <div className={PANE_HEADER}>
        <span>{tr('expressionFunctionHelperLabel')}</span>
        <span className="tabular-nums text-[11px] text-text-muted">{totalCount}</span>
      </div>
      <div className={PANE_SEARCH}>
        <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr('expressionFunctionSearchPlaceholder')}
          aria-label={tr('expressionFunctionSearchPlaceholder')}
          className={PANE_SEARCH_INPUT}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label={tr('expressionClearFormula')}
            className="absolute right-2 inline-flex h-4 w-4 items-center justify-center text-text-muted hover:text-text-primary"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="fx-list min-h-0 flex-1" role="listbox">
        {groups.length === 0 ? (
          <div className="px-3 py-6 text-center text-[12px] text-text-muted">
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
                  className={`flex h-7 w-full items-center justify-between bg-surface-muted/75 px-3 text-left text-[11.5px] font-medium text-text-secondary transition-colors hover:text-text-primary ${ROW_BORDER}`}
                >
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <ChevronDown
                      className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${collapsed ? '-rotate-90' : ''}`}
                    />
                    <span className="truncate">{tr(group.i18nKey)}</span>
                  </span>
                  <span className="tabular-nums text-[11px] text-text-muted">
                    {group.tokens.length}
                  </span>
                </button>
                {!collapsed &&
                  group.tokens.map((token) => {
                    const isSelected = selected?.label === token.label;
                    return (
                      <div
                        key={token.label}
                        role="option"
                        aria-selected={isSelected}
                        tabIndex={0}
                        title={tr('expressionFunctionInsertHint')}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onSelect(token)}
                        onDoubleClick={() => onInsert(token.apply, token.cursorOffset)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelect(token);
                          }
                        }}
                        className={`${LIST_ROW} justify-between font-mono text-[12px] ${
                          isSelected
                            ? 'border-l-2 border-l-accent bg-accent-muted/80 pl-[10px] font-medium text-accent'
                            : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {tokenDisplayLabel(token, tr)}
                        </span>
                        <button
                          type="button"
                          tabIndex={-1}
                          title={tr('expressionInsertAtCursor')}
                          aria-label={tr('expressionInsertAtCursor')}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onInsert(token.apply, token.cursorOffset);
                          }}
                          className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-text-muted opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
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

export const EXPRESSION_PREVIEW_MAX_LINES = 3;

/** `avg([x]) ▌` → `over ()` / `over (by: …)`. */
function windowCompletionSource(ctx: CompletionContext): CompletionResult | null {
  const suggestion = windowSuggestionAt(ctx.state.sliceDoc(0, ctx.pos));
  if (!suggestion) return null;
  return {
    from: suggestion.from,
    options: suggestion.options.map((option) => ({
      label: option.label,
      apply: option.apply,
      detail: option.detail,
      type: 'keyword',
    })),
  };
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
  aggregateContext,
  expandExpression,
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
        className="relative flex h-full min-h-8 w-full cursor-pointer items-center bg-transparent px-2.5 py-1 pr-8 text-left font-mono text-ui-control leading-[18px] text-text-primary outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30"
      >
        {/* Long formulas wrap to up to 3 lines (full text in the tooltip/editor) instead of a one-line ellipsis. */}
        <span
          data-testid="expression-preview"
          className={`min-w-0 shrink whitespace-pre-wrap break-all${issueCount > 0 ? ' text-error' : ''}`}
          style={{
            display: '-webkit-box',
            WebkitLineClamp: EXPRESSION_PREVIEW_MAX_LINES,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
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
          aggregateContext={aggregateContext}
          expandExpression={expandExpression}
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
  aggregateContext,
  expandExpression,
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
  const expandedDraft = useMemo(() => {
    const trimmed = draft.trim();
    if (!trimmed) return { text: '', error: null as string | null };
    if (!expandExpression) return { text: draft, error: null as string | null };
    try {
      return { text: expandExpression(draft), error: null as string | null };
    } catch (err) {
      return {
        text: draft,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [draft, expandExpression]);
  const aggregateIssue = useMemo(
    () =>
      aggregateContext && !expandedDraft.error
        ? expressionAggregateIssue(expandedDraft.text, aggregateContext)
        : null,
    [aggregateContext, expandedDraft]
  );
  // Typed expression layer: result type (or first grammar error) for the status bar.
  const analysis = useMemo(() => {
    if (!draft.trim()) return null;
    if (expandedDraft.error) {
      return { ok: false, error: { message: expandedDraft.error, code: 'domain' } };
    }
    return aggregateContext === 'metric'
      ? analyzeExpressionList(expandedDraft.text, columnTypes ?? {})
      : analyzeExpression(expandedDraft.text, columnTypes ?? {});
  }, [aggregateContext, columnTypes, draft, expandedDraft]);
  const caseRewrite = useMemo(
    () => (/\bcase\b/i.test(draft) ? rewriteCaseExpression(draft) : null),
    [draft]
  );
  const applyCaseRewrite = useCallback(() => {
    const view = viewRef.current;
    if (!view || caseRewrite === null) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: caseRewrite } });
    view.focus();
  }, [caseRewrite]);
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
          autocompletion({ override: [windowCompletionSource], activateOnTyping: true }),
          EditorView.inputHandler.of((view, from, _to, text) => {
            if (text === ' ' && /\)\s*$/.test(view.state.sliceDoc(Math.max(0, from - 40), from)))
              setTimeout(() => startCompletion(view), 0);
            return false;
          }),
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

  // Never save an expression that failed lint or grammar validation.
  const confirmBlocked = issues.length > 0 || Boolean(analysis && !analysis.ok);
  const handleConfirm = useCallback(() => {
    if (confirmBlocked) return;
    onChange(draft);
    onClose();
  }, [confirmBlocked, draft, onChange, onClose]);
  confirmRef.current = handleConfirm;

  const requestClose = useCallback(() => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }, [dirty, onClose]);
  requestCloseRef.current = requestClose;

  const wizard = mode === 'wizard' && assistantPanel;

  const tabClass = (active: boolean) =>
    `inline-flex h-full w-[112px] shrink-0 items-center justify-center gap-1.5 border-l border-border-subtle text-[12.5px] font-medium transition-colors ${
      active
        ? 'bg-accent-muted/70 text-accent shadow-[inset_0_-2px_0_var(--color-accent)]'
        : 'bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary'
    }`;

  const footerButton =
    'inline-flex h-full shrink-0 items-center justify-center border-l border-border-subtle text-[13px] font-medium transition-colors';

  const discardFooter = confirmDiscard && (
    <div
      key="discard"
      className="flex h-11 shrink-0 items-stretch justify-between border-t border-border-subtle bg-surface"
    >
      <div
        className="flex min-w-0 flex-1 items-center gap-2 px-4 text-[12.5px] text-text-primary"
        role="alert"
      >
        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-warning" />
        <span className="truncate">{tr('expressionDiscardPrompt')}</span>
      </div>
      <div className="flex shrink-0 items-stretch">
        <button
          type="button"
          autoFocus
          onClick={() => setConfirmDiscard(false)}
          className={`${footerButton} w-[108px] bg-surface text-text-primary hover:bg-surface-hover`}
        >
          {tr('expressionKeepEditing')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className={`${footerButton} w-[116px] bg-error text-error-foreground hover:bg-error/90`}
        >
          {tr('expressionDiscardChanges')}
        </button>
      </div>
    </div>
  );

  return (
    <Dialog
      open
      onOpenChange={() => requestCloseRef.current()}
      closeOnOverlayClick
      closeOnEscape
      ariaLabel={title}
      overlayClassName="bg-black/28 px-4 py-6 dark:bg-black/50"
      className="flex h-[600px] max-h-[88vh] w-[960px] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-none border-border bg-surface p-0 shadow-elevated"
    >
      <div
        data-testid="formula-editor-grid"
        className="flex h-full min-h-0 w-full flex-col bg-surface"
      >
        <div
          className={`flex h-11 shrink-0 items-stretch justify-between bg-surface ${ROW_BORDER}`}
        >
          <div className="flex min-w-0 items-center gap-2.5 px-4">
            <SquareFunction className="h-4 w-4 shrink-0 text-accent" />
            <h3 className="shrink-0 text-[14px] font-semibold text-text-primary">{title}</h3>
            {subtitle && (
              <>
                <span className="h-3.5 w-px shrink-0 bg-border-subtle" aria-hidden />
                <span className="truncate text-[12px] text-text-muted">{subtitle}</span>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-stretch">
            {assistantPanel && (
              <>
                <button
                  key="tab-fn"
                  type="button"
                  aria-pressed={!wizard}
                  onClick={() => setMode('functions')}
                  className={tabClass(!wizard)}
                >
                  <Code2 className="h-3.5 w-3.5 shrink-0" />
                  {tr('expressionTabFunctions')}
                </button>
                <button
                  key="tab-wiz"
                  type="button"
                  aria-pressed={!!wizard}
                  onClick={() => setMode('wizard')}
                  className={tabClass(!!wizard)}
                >
                  <Wand2 className="h-3.5 w-3.5 shrink-0" />
                  {assistantPanel.openLabel}
                </button>
              </>
            )}
            <button
              key="close"
              type="button"
              onClick={requestClose}
              aria-label={tr('cancel')}
              className="inline-flex h-full w-11 shrink-0 items-center justify-center border-l border-border-subtle text-text-muted transition-colors hover:bg-accent-muted hover:text-accent"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Keep CodeMirror mounted while the wizard is shown so draft and cursor survive mode switches. */}
        <div className={wizard ? 'hidden' : 'flex shrink-0 flex-col'}>
          <div
            className={`flex h-8 shrink-0 items-center justify-between gap-2 bg-surface-muted/60 px-2.5 ${ROW_BORDER}`}
          >
            <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
              {QUICK_OPERATORS.map((op) => (
                <button
                  key={op.label}
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    editAtCursor(op.apply, op.cursorOffset);
                  }}
                  className="inline-flex h-6 shrink-0 items-center justify-center px-2 font-mono text-[11.5px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-accent"
                >
                  {op.label}
                </button>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {issues.length === 0 && analysis?.ok && analysis.type && (
                <span
                  data-testid="expression-result-type"
                  className="inline-flex shrink-0 items-center border border-accent/25 bg-accent-muted/70 px-2 py-0.5 text-[11.5px] font-medium text-accent"
                >
                  {tr('expressionResultType', {
                    type: helpTerm(tr, 'types', EXPR_TYPE_HELP[analysis.type] ?? 'any'),
                  })}
                </span>
              )}
              {draft.trim().length > 0 && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => replaceExpression('')}
                  className="inline-flex h-6 items-center px-1.5 text-[11.5px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
                >
                  {tr('expressionClearFormula')}
                </button>
              )}
            </div>
          </div>

          <div
            key="editor"
            ref={hostRef}
            aria-label={title}
            style={{ height: EDITOR_HEIGHT }}
            className={`min-h-0 shrink-0 focus-within:shadow-[inset_0_0_0_1px_var(--color-accent)] ${ROW_BORDER}`}
          />
        </div>

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
                className={`flex h-8 shrink-0 items-center gap-2 bg-error/[0.06] px-3.5 text-left text-[12px] text-error ${ROW_BORDER}`}
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
            {aggregateIssue && (
              <div
                key="aggregate-issue"
                data-testid="expression-aggregate-issue"
                className={`flex h-8 shrink-0 items-center gap-2 bg-warning/[0.08] px-3.5 text-[12px] text-text-primary ${ROW_BORDER}`}
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-warning" />
                <b className="shrink-0 font-semibold">{aggregateIssue.message}</b>
                <span className="min-w-0 truncate text-text-secondary" title={aggregateIssue.hint}>
                  {aggregateIssue.hint}
                </span>
                {aggregateIssue.fixText && (
                  <button
                    type="button"
                    data-testid="expression-aggregate-fix"
                    onClick={() => replaceExpression(aggregateIssue.fixText!)}
                    className="ml-auto shrink-0 border border-border-subtle bg-surface px-2 py-0.5 text-[11.5px] font-medium text-accent hover:bg-accent-muted"
                  >
                    {tr('expressionAddOverFix')}
                  </button>
                )}
              </div>
            )}

            <div className="grid min-h-0 flex-1 grid-cols-[204px_248px_minmax(0,1fr)] overflow-hidden">
              <div key="fields" className={`flex min-h-0 flex-col ${COL_BORDER}`}>
                <div className={PANE_HEADER}>
                  <span>{tr('expressionFieldsTab')}</span>
                  <span className="tabular-nums text-[11px] text-text-muted">
                    {sortedFields.length}
                  </span>
                </div>
                <div className={PANE_SEARCH}>
                  <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-text-muted" />
                  <input
                    type="text"
                    value={fieldQuery}
                    onChange={(e) => setFieldQuery(e.target.value)}
                    placeholder={tr('expressionFieldSearchPlaceholder')}
                    aria-label={tr('expressionFieldSearchPlaceholder')}
                    className={PANE_SEARCH_INPUT}
                  />
                  {fieldQuery && (
                    <button
                      type="button"
                      onClick={() => setFieldQuery('')}
                      aria-label={tr('expressionClearFormula')}
                      className="absolute right-2 inline-flex h-4 w-4 items-center justify-center text-text-muted hover:text-text-primary"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <div className="fx-list min-h-0 flex-1">
                  {sortedFields.length === 0 ? (
                    <div className="px-3 py-6 text-center text-[12px] text-text-muted">
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
                        className={`${LIST_ROW} justify-between text-text-primary hover:bg-surface-hover`}
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <DataTypeIcon type={columnTypes?.[col]} />
                          <span className="min-w-0 truncate">{col}</span>
                        </span>
                        <Plus className="h-3.5 w-3.5 shrink-0 text-accent opacity-0 transition-opacity group-hover:opacity-100" />
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div key="functions" className={`flex min-h-0 flex-col ${COL_BORDER}`}>
                <FunctionList
                  functionGroups={functionGroups}
                  excludeCategories={excludeFunctionCategories}
                  selected={selectedToken}
                  onSelect={setSelectedToken}
                  onInsert={editAtCursor}
                  tr={tr}
                />
              </div>

              <div key="detail" className="flex min-h-0 flex-col">
                <FunctionDetailPanel token={selectedToken} tr={tr} onInsert={editAtCursor} />
              </div>
            </div>

            {discardFooter || (
              <div className="flex h-11 shrink-0 items-stretch justify-between border-t border-border-subtle bg-surface">
                <div
                  key="status"
                  className="flex min-w-0 flex-1 items-center gap-2.5 px-3.5 text-[12px] text-text-muted"
                >
                  {issues.length > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 border border-error/25 bg-error/[0.07] px-2 py-0.5 text-[12px] text-error">
                      <span className="h-1.5 w-1.5 rounded-full bg-error" />
                      {tr('expressionIssueCount', { count: issues.length })}
                    </span>
                  )}
                  {issues.length === 0 && analysis && !analysis.ok && (
                    <span
                      data-testid="expression-grammar-error"
                      title={analysis.error?.message}
                      className="inline-flex min-w-0 items-center gap-1.5 truncate border border-error/25 bg-error/[0.07] px-2 py-0.5 text-[12px] text-error"
                    >
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{analysis.error?.message}</span>
                    </span>
                  )}
                  {caseRewrite !== null && (
                    <button
                      type="button"
                      data-testid="expression-case-quickfix"
                      onClick={applyCaseRewrite}
                      title={caseRewrite}
                      className="shrink-0 border border-accent/35 bg-accent-muted/50 px-2 py-0.5 text-[12px] font-medium text-accent transition-colors hover:bg-accent-muted"
                    >
                      {tr('expressionCaseQuickFix')}
                    </button>
                  )}
                  <span className="truncate">{tr('expressionShortcutHint')}</span>
                </div>
                <div className="flex shrink-0 items-stretch">
                  <button
                    key="cancel"
                    type="button"
                    onClick={requestClose}
                    className={`${footerButton} w-[100px] bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary`}
                  >
                    {tr('cancel')}
                  </button>
                  <button
                    key="confirm"
                    type="button"
                    onClick={handleConfirm}
                    disabled={confirmBlocked}
                    aria-disabled={confirmBlocked}
                    title={confirmBlocked ? tr('expressionConfirmBlocked') : undefined}
                    className={`${footerButton} w-[116px] bg-accent text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent`}
                  >
                    {tr('confirm')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
