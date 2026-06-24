import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronDown } from 'lucide-react';
import { StreamLanguage } from '@codemirror/language';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, placeholder, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { Tag, tags } from '@lezer/highlight';
import {
  dataFieldTypeLabel,
  isNumericDataFieldType,
  isTemporalDataFieldType,
  normalizeDataFieldType,
} from '@/shared/data-field-types';
import { GlassFunctionHelper } from './GlassFunctionHelper';

interface GlassExpressionEditorProps {
  value: string;
  onChange: (value: string) => void;
  fieldCompletions: string[];
  columnTypes?: Record<string, string>;
  onClose: () => void;
}

type FieldCategory = 'numeric' | 'temporal' | 'text' | 'boolean' | 'other';

function categorizeFields(
  fields: string[],
  types: Record<string, string> | undefined,
  tr: (key: string, fallback: string) => string
): Array<{ category: FieldCategory; label: string; fields: string[] }> {
  const groups: Record<string, string[]> = {};
  const unknown: string[] = [];
  for (const col of fields) {
    const raw = types?.[col];
    if (!raw) {
      unknown.push(col);
      continue;
    }
    const norm = normalizeDataFieldType(raw);
    if (isNumericDataFieldType(norm)) {
      (groups.numeric ??= []).push(col);
    } else if (isTemporalDataFieldType(norm)) {
      (groups.temporal ??= []).push(col);
    } else if (norm === 'text') {
      (groups.text ??= []).push(col);
    } else if (norm === 'boolean') {
      (groups.boolean ??= []).push(col);
    } else {
      unknown.push(col);
    }
  }
  const order: FieldCategory[] = ['numeric', 'temporal', 'text', 'boolean', 'other'];
  return order
    .filter((c) => (groups[c] ?? []).length > 0 || (c === 'other' && unknown.length > 0))
    .map((c) => ({
      category: c,
      label:
        c === 'numeric'
          ? tr('calcFieldCategoryNumeric', '数字')
          : c === 'temporal'
            ? tr('calcFieldCategoryDate', '日期')
            : c === 'text'
              ? tr('calcFieldCategoryText', '文本')
              : c === 'boolean'
                ? tr('calcFieldCategoryBoolean', '布尔')
                : tr('calcFieldCategoryOther', '其他'),
      fields: c === 'other' ? unknown : (groups[c] ?? []),
    }));
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
    minHeight: '80px',
    maxHeight: '104px',
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
  },
  '.cm-content': {
    boxSizing: 'border-box',
    minHeight: '80px',
    padding: '0.5rem 0.625rem',
    caretColor: '#334155',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-placeholder': {
    color: '#94a3b8',
  },
});

export function GlassExpressionEditor({
  value,
  onChange,
  fieldCompletions,
  columnTypes,
  onClose,
}: GlassExpressionEditorProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

  const [draft, setDraft] = useState(value);
  const initialDraftRef = useRef(value);
  const [showFields, setShowFields] = useState(true);
  const [showFn, setShowFn] = useState(true);
  const [showSyntax, setShowSyntax] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeCompartment = useRef(new Compartment());
  const fieldGroups = useMemo(
    () => categorizeFields(fieldCompletions, columnTypes, tr),
    [fieldCompletions, columnTypes, tr]
  );

  const placeholderText = useMemo(
    () => tr('calcFieldExpressionPlaceholder', '如 [revenue] - [cost] 或 if [a] > 0 then 1 else 0'),
    [tr]
  );

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
              if (update.docChanged) {
                const text = update.state.doc.toString();
                setDraft(text);
              }
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

  const insertFieldRef = useCallback(
    (col: string) => {
      editAtCursor(`[${col}]`);
    },
    [editAtCursor]
  );

  function handleConfirm() {
    onChange(draft);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/28 px-4 py-6"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[36rem] max-h-[calc(100vh-3rem)] w-[48rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border-subtle bg-[var(--glass-card-strong)] shadow-card backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h3 className="text-[14px] font-medium text-text-primary">
            {tr('aggregateExpressionEditor', '表达式编辑器')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-hover hover:text-text-secondary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          {/* CodeMirror editor */}
          <div ref={hostRef} />

          {/* Field picker + Function helper side by side */}
          <div className="grid grid-cols-2 gap-3 min-h-0">
            {/* Field picker */}
            <div className="flex flex-col rounded-lg border border-border-muted/60 min-h-0">
              <button
                type="button"
                onClick={() => setShowFields(!showFields)}
                className="flex w-full items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-text-muted hover:text-text-secondary transition-colors"
              >
                <ChevronDown
                  className={`h-3 w-3 transition-transform ${showFields ? 'rotate-180' : ''}`}
                />
                {tr('calcFieldTabFields', '字段选择')}
              </button>
              {showFields && (
                <div className="flex-1 overflow-y-auto border-t border-border-muted/60 p-2 min-h-0">
                  {fieldGroups.length === 0 ? (
                    <div className="px-2 py-2 text-center text-[11px] text-text-muted">
                      {tr('noFields', '暂无可用字段')}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {fieldGroups.map((group) => (
                        <div key={group.category}>
                          <div className="mb-1 text-[11px] font-medium text-text-muted">
                            {group.label}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {group.fields.map((col) => {
                              const colType = columnTypes?.[col];
                              return (
                                <button
                                  key={col}
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    insertFieldRef(col);
                                  }}
                                  className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border border-border-muted/60 bg-background/20 px-1.5 text-[11px] text-text-secondary transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
                                >
                                  {colType && (
                                    <span className="rounded bg-background/60 px-0.5 text-[10px] leading-none text-text-muted">
                                      {dataFieldTypeLabel(colType)}
                                    </span>
                                  )}
                                  <span>{col}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Function helper */}
            <div className="flex flex-col rounded-lg border border-border-muted/60 min-h-0">
              <button
                type="button"
                onClick={() => setShowFn(!showFn)}
                className="flex w-full items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-text-muted hover:text-text-secondary transition-colors"
              >
                <ChevronDown
                  className={`h-3 w-3 transition-transform ${showFn ? 'rotate-180' : ''}`}
                />
                {tr('calcFieldFnHelperLabel', '函数助手')}
              </button>
              {showFn && (
                <div className="flex-1 overflow-y-auto border-t border-border-muted/60 p-2 min-h-0">
                  <GlassFunctionHelper onInsert={editAtCursor} />
                </div>
              )}
            </div>
          </div>

          {/* Syntax reference */}
          <div className="rounded-lg border border-border-muted/60">
            <button
              type="button"
              onClick={() => setShowSyntax(!showSyntax)}
              className="flex w-full items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-text-muted hover:text-text-secondary transition-colors"
            >
              <ChevronDown
                className={`h-3 w-3 transition-transform ${showSyntax ? 'rotate-180' : ''}`}
              />
              {tr('calcFieldSyntaxHelp', '语法参考')}
            </button>
            {showSyntax && (
              <div className="border-t border-border-muted/60 bg-background/20 px-3 py-2 space-y-0.5 text-[11px] leading-5 text-text-secondary">
                <div>
                  <span className="text-text-muted">{tr('calcFieldSyntaxFields', '字段')}:</span>{' '}
                  <code className="rounded bg-background/40 px-1">[fieldName]</code>
                  <span className="text-text-muted">，</span>
                  <code className="rounded bg-background/40 px-1">*</code>
                  <span className="text-text-muted">
                    {tr('calcFieldDesc_allFields', '表示全部字段，如 count(*)')}
                  </span>
                </div>
                <div>
                  <span className="text-text-muted">{tr('calcFieldSyntaxLiteral', '字面量')}:</span>{' '}
                  <code className="rounded bg-background/40 px-1">123</code>{' '}
                  <code className="rounded bg-background/40 px-1">'text'</code>{' '}
                  <code className="rounded bg-background/40 px-1">true</code>
                </div>
                <div>
                  <span className="text-text-muted">{tr('calcFieldSyntaxArith', '运算')}:</span>{' '}
                  <code className="rounded bg-background/40 px-1">[a] + [b] * 2</code>
                </div>
                <div>
                  <span className="text-text-muted">{tr('calcFieldSyntaxFunc', '函数')}:</span>{' '}
                  <code className="rounded bg-background/40 px-1">sum([a])</code>
                </div>
                <div>
                  <span className="text-text-muted">{tr('calcFieldSyntaxCond', '条件')}:</span>{' '}
                  <code className="rounded bg-background/40 px-1">
                    if [a] &gt; 0 then [b] else 0 end
                  </code>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 items-center rounded-md border border-border-muted bg-background/42 px-3 text-[12px] text-text-secondary transition-colors hover:bg-surface-hover"
          >
            {tr('cancel', '取消')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="flex h-7 items-center rounded-md bg-accent px-3 text-[12px] text-white transition-colors hover:bg-accent/90"
          >
            {tr('confirm', '确定')}
          </button>
        </div>
      </div>
    </div>
  );
}
