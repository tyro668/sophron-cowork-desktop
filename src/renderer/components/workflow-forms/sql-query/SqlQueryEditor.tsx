import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  syntaxTree,
} from '@codemirror/language';
import { linter, lintKeymap, type Diagnostic } from '@codemirror/lint';
import { PostgreSQL, sql } from '@codemirror/lang-sql';
import { tags } from '@lezer/highlight';
import { normalizeSqlQuery } from '@/shared/sql-query';

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--code-token-keyword)' },
  { tag: tags.string, color: 'var(--code-token-string)' },
  { tag: tags.number, color: 'var(--code-token-number)' },
  { tag: [tags.atom, tags.bool, tags.null], color: 'var(--code-token-atom)' },
  { tag: tags.propertyName, color: 'var(--code-token-property)' },
  { tag: [tags.variableName, tags.typeName], color: 'var(--code-token-variable)' },
  { tag: tags.comment, color: 'var(--code-token-comment)' },
]);
const theme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    lineHeight: '1.6',
  },
  '.cm-content': { padding: '8px 0', caretColor: 'var(--color-text-primary)' },
  '.cm-gutters': {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text-muted)',
    border: 'none',
    paddingRight: '6px',
  },
  '.cm-activeLine': { backgroundColor: 'var(--color-surface-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--color-surface-hover)' },
  '.cm-content ::selection, .cm-line ::selection': {
    backgroundColor: 'var(--code-preview-selection)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--code-preview-selection) !important',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border-muted)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'var(--color-accent-muted)',
    color: 'var(--color-accent)',
  },
  '.cm-lintRange-error': { textDecorationColor: 'var(--color-error)' },
  '.cm-diagnostic': {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border-muted)',
    fontFamily: 'inherit',
  },
});

function sqlSupport(fields: string[]) {
  return sql({
    dialect: PostgreSQL,
    schema: {
      input: fields.map((field) => ({ label: field, type: 'property' })),
    },
    defaultTable: 'input',
    upperCaseKeywords: true,
  });
}

function syntaxErrorLinter(message: () => string) {
  return linter((view) => {
    const diagnostics: Diagnostic[] = [];
    syntaxTree(view.state)
      .cursor()
      .iterate((node) => {
        if (node.type.isError) {
          diagnostics.push({
            from: node.from,
            to: Math.max(node.to, node.from + 1),
            severity: 'error',
            message: message(),
          });
        }
      });
    return diagnostics;
  });
}

export type SqlValidationResult = 'ok' | 'invalid' | 'syntax';

export interface SqlQueryEditorHandle {
  insertText: (text: string) => void;
  getValue: () => string;
  replaceAll: (text: string) => void;
  validate: () => SqlValidationResult;
  focus: () => void;
}

export const SqlQueryEditor = forwardRef<
  SqlQueryEditorHandle,
  {
    value: string;
    onChange: (sql: string) => void;
    fields: string[];
    label: string;
    syntaxErrorLabel: string;
  }
>(function SqlQueryEditor({ value, onChange, fields, label, syntaxErrorLabel }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const applyingValue = useRef(false);
  const change = useRef(onChange);
  change.current = onChange;
  const errorMessage = useRef(syntaxErrorLabel);
  errorMessage.current = syntaxErrorLabel;
  const initial = useRef({ value, fields, label });
  const completion = useRef(new Compartment());
  const attributes = useRef(new Compartment());
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial.current.value,
        extensions: [
          theme,
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          completion.current.of(sqlSupport(initial.current.fields)),
          syntaxHighlighting(highlight),
          autocompletion(),
          syntaxErrorLinter(() => errorMessage.current),
          keymap.of([
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...lintKeymap,
            indentWithTab,
          ]),
          attributes.current.of(
            EditorView.contentAttributes.of({ 'aria-label': initial.current.label })
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !applyingValue.current) {
              change.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      view.current = null;
      editor.destroy();
    };
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      insertText: (text: string) => {
        const editor = view.current;
        if (!editor) return;
        const range = editor.state.selection.main;
        editor.dispatch({
          changes: { from: range.from, to: range.to, insert: text },
          selection: { anchor: range.from + text.length },
        });
        editor.focus();
      },
      getValue: () => view.current?.state.doc.toString() ?? '',
      replaceAll: (text: string) => {
        const editor = view.current;
        if (!editor) return;
        editor.dispatch({
          changes: { from: 0, to: editor.state.doc.length, insert: text },
        });
        editor.focus();
      },
      validate: () => {
        const editor = view.current;
        if (!editor) return 'syntax';
        try {
          normalizeSqlQuery(editor.state.doc.toString());
        } catch {
          return 'invalid';
        }
        let hasError = false;
        syntaxTree(editor.state)
          .cursor()
          .iterate((node) => {
            if (node.type.isError) hasError = true;
          });
        return hasError ? 'syntax' : 'ok';
      },
      focus: () => view.current?.focus(),
    }),
    []
  );
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      applyingValue.current = true;
      try {
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
      } finally {
        applyingValue.current = false;
      }
    }
  }, [value]);
  useEffect(() => {
    view.current?.dispatch({
      effects: [
        completion.current.reconfigure(sqlSupport(fields)),
        attributes.current.reconfigure(EditorView.contentAttributes.of({ 'aria-label': label })),
      ],
    });
  }, [fields, label]);
  return <div ref={host} className="min-h-[160px] flex-1 overflow-hidden" />;
});
