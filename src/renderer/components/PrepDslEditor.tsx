import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import {
  autocompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { linter, type Diagnostic as CodeMirrorDiagnostic } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, keymap, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { DataWorkflowOperatorType } from '../types';
import { parsePrepOperatorDsl, type PrepDiagnostic } from '../../shared/prep-dsl';

interface PrepDslEditorProps {
  value: string;
  operatorType: DataWorkflowOperatorType;
  placeholderText: string;
  completionLabels: {
    keywords: string;
    snippets: string;
    types: string;
    fields: string;
  };
  fieldCompletions?: string[];
  formatDiagnostic: (diagnostic: PrepDiagnostic) => string;
  onChange: (value: string) => void;
  onDiagnosticsChange: (diagnostics: PrepDiagnostic[]) => void;
  editable?: boolean;
  height?: number;
}

const prepDslLanguage = StreamLanguage.define({
  name: 'prep-dsl',
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/#.*/)) return 'comment';
    if (stream.match(/"(?:[^"\\]|\\.)*"/)) return 'string';
    if (stream.match(/\[`(?:[^`\\]|\\.)*`\](?:\.\[`(?:[^`\\]|\\.)*`\])?/)) {
      return 'variableName';
    }
    if (stream.match(/\[[\p{L}_][\p{L}\p{N}_]*\](?:\.\[[\p{L}_][\p{L}\p{N}_]*\])?/u)) {
      return 'variableName';
    }
    if (stream.match(/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:ms|s|m|h|d)?/)) return 'number';
    if (
      stream.match(
        /\b(?:input|source|from|select|drop|map|rename|to|as|filter|deduplicate|by|keep|first|last|order|missing|value|row|when|all_null|any_null|nullify|values|fill|forward|backward|mean|median|mode|cast|on_error|sort|derive|aggregate|metrics|join|inner|left|right|full|cross|semi|anti|asof|on|and|direction|tolerance|suffix|right_prefix|expect|output|table|dataset|file|format|name)\b/
      )
    ) {
      return 'keyword';
    }
    if (stream.match(/\b(?:string|int|double|decimal|boolean|date|timestamp)\b/)) return 'typeName';
    if (stream.match(/\b(?:true|false|null)\b/)) return 'atom';
    if (stream.match(/[A-Za-z_][A-Za-z0-9_]*/)) return 'variableName';
    stream.next();
    return null;
  },
});

const prepDslHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#0f766e', fontWeight: '500' },
  { tag: tags.string, color: '#b45309' },
  { tag: tags.number, color: '#7c3aed' },
  { tag: tags.atom, color: '#2563eb' },
  { tag: tags.variableName, color: '#334155' },
  { tag: tags.typeName, color: '#0369a1', fontWeight: '500' },
  { tag: tags.comment, color: '#94a3b8', fontStyle: 'italic' },
]);

const prepDslTheme = EditorView.theme({
  '&': {
    height: 'var(--prep-dsl-editor-height, 180px)',
    border: '1px solid rgba(148, 163, 184, 0.22)',
    borderRadius: '0.625rem',
    backgroundColor: 'rgba(255, 255, 255, 0.86)',
    color: '#334155',
    fontSize: '12px',
  },
  '&.cm-focused': {
    outline: 'none',
    borderColor: 'rgba(25, 169, 154, 0.62)',
    boxShadow: '0 0 0 2px rgba(25, 169, 154, 0.12)',
  },
  '.cm-scroller': {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    lineHeight: '1.45',
    overflow: 'hidden auto',
  },
  '.cm-scroller::-webkit-scrollbar': {
    width: '0',
    height: '0',
  },
  '&:hover .cm-scroller::-webkit-scrollbar, &.cm-focused .cm-scroller::-webkit-scrollbar': {
    width: '6px',
    height: '6px',
  },
  '.cm-scroller::-webkit-scrollbar-thumb': {
    backgroundColor: 'rgba(148, 163, 184, 0.45)',
    borderRadius: '999px',
  },
  '.cm-scroller::-webkit-scrollbar-track': {
    backgroundColor: 'transparent',
  },
  '.cm-content': {
    boxSizing: 'border-box',
    minHeight: '100%',
    padding: '0.5rem 0.625rem',
  },
  '.cm-line': {
    padding: '0 0.125rem',
  },
  '.cm-placeholder': {
    color: '#94a3b8',
  },
  '.cm-tooltip': {
    border: '1px solid rgba(148, 163, 184, 0.28)',
    borderRadius: '0.5rem',
    boxShadow: '0 10px 30px rgba(15, 23, 42, 0.12)',
    overflow: 'hidden',
    fontSize: '11px',
  },
  '.cm-tooltip-autocomplete ul li': {
    padding: '0.25rem 0.5rem',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'rgba(25, 169, 154, 0.12)',
    color: '#0f766e',
  },
});

export function PrepDslEditor({
  value,
  operatorType,
  placeholderText,
  completionLabels,
  fieldCompletions = [],
  formatDiagnostic,
  onChange,
  onDiagnosticsChange,
  editable = true,
  height = 180,
}: PrepDslEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(value);
  const fieldCompletionsRef = useRef(fieldCompletions);
  const onChangeRef = useRef(onChange);
  const onDiagnosticsChangeRef = useRef(onDiagnosticsChange);
  const formatDiagnosticRef = useRef(formatDiagnostic);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    fieldCompletionsRef.current = fieldCompletions;
    const view = viewRef.current;
    if (editable && view && isFieldCompletionContext(view)) {
      startCompletion(view);
    }
  }, [editable, fieldCompletions]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onDiagnosticsChangeRef.current = onDiagnosticsChange;
  }, [onDiagnosticsChange]);

  useEffect(() => {
    formatDiagnosticRef.current = formatDiagnostic;
  }, [formatDiagnostic]);

  const extensions = useMemo(
    () => [
      drawSelection(),
      prepDslLanguage,
      syntaxHighlighting(prepDslHighlightStyle),
      prepDslTheme,
      placeholder(placeholderText),
      EditorState.readOnly.of(!editable),
      EditorView.editable.of(editable),
      keymap.of([...defaultKeymap, indentWithTab]),
      editable
        ? autocompletion({
            override: [
              (context) =>
                completePrepDsl(
                  context,
                  operatorType,
                  completionLabels,
                  fieldCompletionsRef.current
                ),
            ],
          })
        : [],
      editable
        ? linter((view) => {
            const result = parsePrepOperatorDsl(view.state.doc.toString(), operatorType);
            onDiagnosticsChangeRef.current(result.diagnostics);
            return result.diagnostics.map((diagnostic) =>
              toCodeMirrorDiagnostic(view.state, diagnostic, formatDiagnosticRef.current)
            );
          })
        : [],
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (editable && update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
          if (isFieldCompletionContext(update.view)) {
            startCompletion(update.view);
          }
        }
      }),
    ],
    [completionLabels, editable, operatorType, placeholderText]
  );

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({ doc: valueRef.current, extensions }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [extensions]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: value,
      },
    });
  }, [value]);

  return (
    <div
      ref={hostRef}
      style={{ '--prep-dsl-editor-height': `${height}px`, fontSize: '12px' } as CSSProperties}
    />
  );
}

function completePrepDsl(
  context: CompletionContext,
  operatorType: DataWorkflowOperatorType,
  completionLabels: PrepDslEditorProps['completionLabels'],
  fieldCompletions: string[]
): CompletionResult | null {
  const fieldRef = context.matchBefore(/\[[^\]\s,()]*/u);
  if (fieldRef && fieldRef.text.startsWith('[')) {
    const query = fieldRef.text.slice(1).replace(/^`/, '').toLocaleLowerCase();
    const options = uniqueFieldCompletions(fieldCompletions)
      .filter((field) => field.toLocaleLowerCase().includes(query))
      .map((field) =>
        completion(field, completionLabels.fields, formatFieldCompletion(field), 'variable')
      );
    if (options.length > 0) {
      return {
        from: fieldRef.from,
        options,
        validFor: /^\[[^\]\s,()]*/u,
      };
    }
  }

  const word = context.matchBefore(/[A-Za-z_]*/);
  if (!context.explicit && (!word || word.from === word.to)) return null;
  return {
    from: word?.from ?? context.pos,
    options: getCompletionOptions(operatorType, completionLabels),
    validFor: /^[A-Za-z_]*$/,
  };
}

function getCompletionOptions(
  operatorType: DataWorkflowOperatorType,
  labels: PrepDslEditorProps['completionLabels']
): Completion[] {
  return [...operatorCompletions(operatorType, labels), ...typeCompletions(labels)];
}

function operatorCompletions(
  operatorType: DataWorkflowOperatorType,
  labels: PrepDslEditorProps['completionLabels']
): Completion[] {
  const keyword = labels.keywords;
  const snippets = labels.snippets;
  const byType: Partial<Record<DataWorkflowOperatorType, Completion[]>> = {
    field_select: [
      completion('select', keyword, 'select [field]'),
      completion('drop', keyword, 'drop [field]'),
    ],
    field_mapping: [
      completion('map', keyword, 'map [source_field] to [target_field]'),
      completion('rename', keyword, 'rename [source_field] as [target_field]'),
    ],
    filter: [completion('filter', keyword, 'filter [field] = "value"')],
    deduplicate: [
      completion('deduplicate', snippets, 'deduplicate by [field] keep first'),
      completion(
        'deduplicate keep last',
        snippets,
        'deduplicate by [field] keep last order by [updated_at] desc'
      ),
    ],
    missing_value: [
      completion('missing value row drop', snippets, 'missing value row drop when all_null'),
      completion(
        'missing value nullify',
        snippets,
        'missing value [field] nullify values ("", "N/A")'
      ),
      completion('missing value fill', snippets, 'missing value [field] fill "UNKNOWN"'),
    ],
    type_convert: [
      completion('cast', keyword, 'cast [field] as string on_error null'),
      completion('cast date', snippets, 'cast [field] as date format "yyyy-MM-dd" on_error null'),
    ],
    sort: [completion('sort by', keyword, 'sort by [field] asc nulls last')],
    calculate_field: [
      completion('derive', keyword, 'derive [new_field] = [field]'),
      completion('derive if', snippets, 'derive [new_field] = if [field] = 0 then 0 else [field]'),
    ],
    aggregate: [
      completion('aggregate by', snippets, 'aggregate by [field] metrics count(*) as [row_count]'),
      completion('aggregate all', snippets, 'aggregate all metrics count(*) as [row_count]'),
    ],
    join: [
      completion(
        'join left',
        snippets,
        'join left right_source on [left].[id] = [right_source].[id]'
      ),
      completion(
        'join inner',
        snippets,
        'join inner right_source on [left].[id] = [right_source].[id]'
      ),
      completion(
        'join anti',
        snippets,
        'join anti right_source on [left].[id] = [right_source].[id]'
      ),
      completion(
        'join asof',
        snippets,
        'join asof right_source on [left].[time] >= [right_source].[time] by [left].[id] = [right_source].[id] tolerance 1d'
      ),
    ],
  };
  return byType[operatorType] ?? [];
}

function typeCompletions(labels: PrepDslEditorProps['completionLabels']): Completion[] {
  return ['string', 'int', 'double', 'decimal', 'boolean', 'date', 'timestamp'].map((type) =>
    completion(type, labels.types, type, 'type')
  );
}

function completion(
  label: string,
  detail: string,
  apply: string,
  type: Completion['type'] = 'keyword'
): Completion {
  return { label, detail, apply, type };
}

function uniqueFieldCompletions(fields: string[]): string[] {
  return Array.from(
    new Set(fields.map((field) => field.trim()).filter((field) => field.length > 0))
  );
}

function formatFieldCompletion(field: string): string {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(field)
    ? `[${field}]`
    : `[\`${field.replace(/`/g, '\\`')}\`]`;
}

function isFieldCompletionContext(view: EditorView): boolean {
  const position = view.state.selection.main.head;
  const line = view.state.doc.lineAt(position);
  return /\[[^\]\s,()]*$/u.test(line.text.slice(0, position - line.from));
}

function toCodeMirrorDiagnostic(
  state: EditorState,
  diagnostic: PrepDiagnostic,
  formatDiagnostic: (diagnostic: PrepDiagnostic) => string
): CodeMirrorDiagnostic {
  const lineNumber = Math.min(Math.max(diagnostic.line ?? 1, 1), state.doc.lines);
  const line = state.doc.line(lineNumber);
  const columnOffset = Math.max((diagnostic.column ?? 1) - 1, 0);
  const from = Math.min(line.from + columnOffset, line.to);
  return {
    from,
    to: Math.min(line.to, from + 1),
    severity: diagnostic.severity,
    message: formatDiagnostic(diagnostic),
  };
}
