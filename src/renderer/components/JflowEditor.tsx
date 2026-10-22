/**
 * CodeMirror 6 editor for jflow/1. All language intelligence comes from the Chevrotain-based
 * shared module: lexer tokens → decorations, parse/bind/validate → @codemirror/lint,
 * content assist + bound schema → @codemirror/autocomplete. Full reparse, debounced by lint.
 */
import { useEffect, useRef } from 'react';
import {
  autocompletion,
  startCompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { linter, lintGutter } from '@codemirror/lint';
import { Compartment, EditorState, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import {
  jflowCompletions,
  jflowHighlightTokens,
  jflowLintDiagnostics,
  jflowStepCompletions,
  jflowStepLint,
  type JflowCatalog,
  type JflowColumn,
} from '../../shared/jflow';
import type { JflowStepContext } from '../../shared/jflow';

const EMPTY_CATALOG: JflowCatalog = { tables: [] };

const marks = new Map<string, Decoration>();
const mark = (cls: string) => {
  let m = marks.get(cls);
  if (!m) marks.set(cls, (m = Decoration.mark({ class: `cm-jflow-${cls}` })));
  return m;
};

function buildDecorations(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();
  for (const t of jflowHighlightTokens(text)) {
    if (t.cls === 'operator' || t.to <= t.from) continue;
    b.add(t.from, Math.min(t.to, text.length), mark(t.cls));
  }
  return b.finish();
}

const jflowHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = buildDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations }
);

const jflowTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '12px' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: '1.5',
  },
  '.cm-jflow-verb': { color: '#0f766e', fontWeight: '600' },
  '.cm-jflow-keyword': { color: '#0369a1' },
  '.cm-jflow-type': { color: '#0369a1', fontWeight: '500' },
  '.cm-jflow-field': { color: '#7c2d12' },
  '.cm-jflow-string': { color: '#b45309' },
  '.cm-jflow-number': { color: '#7c3aed' },
  '.cm-jflow-comment': { color: '#94a3b8', fontStyle: 'italic' },
  '.cm-jflow-pragma': { color: '#a1a1aa' },
  '.cm-jflow-ref': { color: '#2563eb', fontWeight: '500' },
  '.cm-jflow-param': { color: '#be185d' },
  '.cm-jflow-invalid': { textDecoration: 'underline wavy #dc2626' },
});

/** Single-step mode: the doc is one pipe step of a node with this type and input schema. */
export interface JflowEditorStep extends JflowStepContext {
  expectedType: string;
  columns: JflowColumn[] | null;
}

export interface JflowEditorProps {
  value: string;
  catalog?: JflowCatalog;
  step?: JflowEditorStep;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  className?: string;
}

export function JflowEditor({
  value,
  catalog = EMPTY_CATALOG,
  step,
  readOnly = false,
  onChange,
  className,
}: JflowEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const catalogRef = useRef(catalog);
  const stepRef = useRef(step);
  stepRef.current = step;
  const onChangeRef = useRef(onChange);
  const ro = useRef(new Compartment());
  catalogRef.current = catalog;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const complete = (ctx: CompletionContext): CompletionResult | null => {
      const doc = ctx.state.doc.toString();
      const r = stepRef.current
        ? jflowStepCompletions(doc, ctx.pos, stepRef.current.columns)
        : jflowCompletions(doc, ctx.pos, catalogRef.current);
      if (!r || r.options.length === 0) return null;
      if (
        !ctx.explicit &&
        r.from === ctx.pos &&
        !/[[('|]$/.test(ctx.state.sliceDoc(ctx.pos - 1, ctx.pos))
      )
        return null;
      return { from: r.from, options: r.options, validFor: undefined };
    };
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          jflowHighlight,
          jflowTheme,
          lintGutter(),
          linter(
            (ev) =>
              stepRef.current
                ? jflowStepLint(ev.state.doc.toString(), stepRef.current)
                : jflowLintDiagnostics(ev.state.doc.toString(), catalogRef.current),
            { delay: 300 }
          ),
          autocompletion({ override: [complete], activateOnTyping: true }),
          EditorView.inputHandler.of((ev, _from, _to, text) => {
            if (text === '[' || text === '|' || text === "'")
              setTimeout(() => startCompletion(ev), 0);
            return false;
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
          }),
          ro.current.of(EditorState.readOnly.of(readOnly)),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure(EditorState.readOnly.of(readOnly)) });
  }, [readOnly]);

  return <div ref={host} className={className} data-testid="jflow-editor" />;
}
