import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronDown, Search } from 'lucide-react';
import { StreamLanguage } from '@codemirror/language';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, placeholder, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { Tag, tags } from '@lezer/highlight';
import { dataFieldTypeLabel } from '@/shared/data-field-types';
import { GlassFunctionHelper, type HelperToken } from './GlassFunctionHelper';

interface GlassExpressionEditorProps {
  value: string;
  onChange: (value: string) => void;
  fieldCompletions: string[];
  columnTypes?: Record<string, string>;
  onClose: () => void;
  excludeFunctionCategories?: string[];
}

function sortFields(fields: string[], query: string): string[] {
  const filtered = query.trim()
    ? fields.filter((f) => f.toLowerCase().includes(query.toLowerCase()))
    : fields;
  return ['*', ...filtered.sort((a, b) => a.localeCompare(b, 'zh-CN'))];
}

function FunctionDetailPanel({
  token,
  tr,
}: {
  token: HelperToken | null;
  tr: (key: string, fallback: string) => string;
}) {
  if (!token) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-text-muted px-3 text-center leading-5">
        {tr('calcFieldDetailHint', '将光标移至函数查看详情')}
      </div>
    );
  }

  return (
    <div className="space-y-2.5 text-[11px]">
      <div className="text-[13px] font-semibold text-text-primary font-mono">{token.label}</div>

      <div className="space-y-0.5">
        <div className="flex gap-2">
          <span className="text-text-muted shrink-0">{tr('calcFieldFunctionDesc', '用途')}:</span>
          <span className="text-text-secondary">
            {token.i18nDescKey ? tr(token.i18nDescKey, token.label) : '-'}
          </span>
        </div>
        {token.returnType && (
          <div className="flex gap-2">
            <span className="text-text-muted shrink-0">{tr('aggregateReturnType', '返回')}:</span>
            <code className="rounded bg-accent/10 px-1 text-accent">{token.returnType}</code>
          </div>
        )}
      </div>

      {token.params && token.params.length > 0 && (
        <div>
          <div className="mb-1 text-text-muted">{tr('calcFieldFnArg', '参数')}:</div>
          <div className="space-y-0.5">
            {token.params.map((p) => (
              <div
                key={p.name}
                className="flex items-center gap-2 rounded bg-background/30 px-2 py-1"
              >
                <code className="text-text-primary shrink-0">{p.name}</code>
                <code className="rounded bg-accent/10 px-1 text-[10px] text-accent">{p.type}</code>
                {p.optional && (
                  <span className="text-[10px] text-text-muted">{tr('optional', '可选')}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {token.examples && token.examples.length > 0 && (
        <div>
          <div className="mb-1 text-text-muted">{tr('calcFieldExampleLabel', '示例')}:</div>
          <div className="space-y-1">
            {token.examples.map((ex, i) => (
              <pre
                key={i}
                className="rounded-md border border-border-muted/60 bg-background/20 px-2 py-1 font-mono text-[11px] text-text-secondary leading-5 whitespace-pre-wrap break-all"
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
  excludeFunctionCategories,
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
  const [showDetail, setShowDetail] = useState(true);
  const [fieldQuery, setFieldQuery] = useState('');
  const [hoveredToken, setHoveredToken] = useState<HelperToken | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeCompartment = useRef(new Compartment());

  const sortedFields = useMemo(
    () => sortFields(fieldCompletions, fieldQuery),
    [fieldCompletions, fieldQuery]
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
      <div className="flex h-[36rem] max-h-[calc(100vh-3rem)] w-[56rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border-subtle bg-[var(--glass-card-strong)] shadow-card backdrop-blur-xl">
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
        <div className="flex flex-1 flex-col gap-3 overflow-hidden p-4">
          {/* CodeMirror editor */}
          <div ref={hostRef} />

          {/* Field picker + Function helper + Detail: 1:1:1.5 */}
          <div className="grid grid-cols-[1fr_1fr_1.5fr] gap-3 min-h-0 min-w-0 flex-1 overflow-hidden">
            {/* Field picker */}
            <div className="flex flex-col rounded-lg border border-border-muted/60 min-h-0">
              <button
                type="button"
                onClick={() => setShowFields(!showFields)}
                className="flex w-full items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-text-muted hover:text-text-secondary transition-colors border-b border-border-muted/60"
              >
                <ChevronDown
                  className={`h-3 w-3 transition-transform ${showFields ? 'rotate-180' : ''}`}
                />
                {tr('calcFieldTabFields', '字段选择')}
              </button>
              {showFields && (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="relative shrink-0 px-3 pt-2 pb-2">
                    <Search className="pointer-events-none absolute left-[22px] top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
                    <input
                      type="text"
                      value={fieldQuery}
                      onChange={(e) => setFieldQuery(e.target.value)}
                      placeholder={tr('calcFieldFieldSearchPlaceholder', '搜索字段')}
                      className="h-7 w-full rounded-md border border-border-muted bg-background/42 pl-7 pr-2 text-[11px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
                    />
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 min-h-0">
                    {sortedFields.length === 0 ? (
                      <div className="px-2 py-4 text-center text-[11px] text-text-muted">
                        {tr('noMatch', '无匹配字段')}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {sortedFields.map((col) => {
                          const isStar = col === '*';
                          const colType = isStar ? undefined : columnTypes?.[col];
                          return (
                            <button
                              key={col}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                if (isStar) {
                                  editAtCursor('*');
                                  return;
                                }
                                insertFieldRef(col);
                              }}
                              className={`inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border border-border-muted/60 bg-background/20 px-1.5 text-[11px] text-text-secondary transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent ${
                                isStar ? 'bg-accent/5 border-accent/30 font-semibold' : ''
                              }`}
                            >
                              {colType && (
                                <span className="rounded bg-background/60 px-0.5 text-[10px] leading-none text-text-muted">
                                  {dataFieldTypeLabel(colType)}
                                </span>
                              )}
                              <span>
                                {isStar ? tr('calcFieldAllFieldsStar', '*（表示全部字段）') : col}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
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
                  <GlassFunctionHelper
                    onInsert={editAtCursor}
                    excludeCategories={excludeFunctionCategories}
                    onTokenHover={setHoveredToken}
                  />
                </div>
              )}
            </div>

            {/* Function detail panel */}
            <div className="flex flex-col rounded-lg border border-border-muted/60 min-h-0">
              <button
                type="button"
                onClick={() => setShowDetail(!showDetail)}
                className="flex w-full items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-text-muted hover:text-text-secondary transition-colors"
              >
                <ChevronDown
                  className={`h-3 w-3 transition-transform ${showDetail ? 'rotate-180' : ''}`}
                />
                {tr('calcFieldDetailLabel', '函数详情')}
              </button>
              {showDetail && (
                <div className="flex-1 overflow-y-auto border-t border-border-muted/60 p-2 min-h-0">
                  <FunctionDetailPanel token={hoveredToken} tr={tr} />
                </div>
              )}
            </div>
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
