import { useEffect, useMemo, useRef } from 'react';
import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
  type StringStream,
} from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { Decoration, EditorView, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { DataNormalizerProjectFile } from '../../types';
import type { TranslateFn } from './shared';

export type CodePreviewLanguageKind =
  'python' | 'javascript' | 'json' | 'toml' | 'markdown' | 'text';

export const CODE_PREVIEW_KEYWORDS: Record<
  Exclude<CodePreviewLanguageKind, 'text'>,
  Set<string>
> = {
  python: new Set([
    'and',
    'as',
    'async',
    'await',
    'break',
    'class',
    'continue',
    'def',
    'elif',
    'else',
    'except',
    'finally',
    'for',
    'from',
    'if',
    'import',
    'in',
    'is',
    'lambda',
    'not',
    'or',
    'pass',
    'raise',
    'return',
    'try',
    'while',
    'with',
    'yield',
  ]),
  javascript: new Set([
    'async',
    'await',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'default',
    'else',
    'export',
    'extends',
    'finally',
    'for',
    'from',
    'function',
    'if',
    'import',
    'let',
    'new',
    'return',
    'switch',
    'throw',
    'try',
    'var',
    'while',
  ]),
  json: new Set(['true', 'false', 'null']),
  toml: new Set(['true', 'false']),
  markdown: new Set([]),
};

export const codePreviewHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--code-token-keyword)', fontWeight: '500' },
  { tag: tags.string, color: 'var(--code-token-string)' },
  { tag: tags.number, color: 'var(--code-token-number)' },
  { tag: tags.atom, color: 'var(--code-token-atom)' },
  { tag: tags.propertyName, color: 'var(--code-token-property)' },
  { tag: tags.variableName, color: 'var(--code-token-variable)' },
  { tag: tags.typeName, color: 'var(--code-token-property)', fontWeight: '500' },
  { tag: tags.heading, color: 'var(--code-token-keyword)', fontWeight: '600' },
  { tag: tags.strong, color: 'var(--code-token-variable)', fontWeight: '500' },
  { tag: tags.comment, color: 'var(--code-token-comment)', fontStyle: 'italic' },
]);

export const codePreviewTheme = EditorView.theme({
  '&': {
    height: '100%',
    minHeight: '100%',
    backgroundColor: 'var(--code-preview-background)',
    color: 'var(--code-preview-text)',
    fontSize: '11px',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    lineHeight: '1.55',
    overflow: 'auto',
  },
  '.cm-content': {
    minHeight: '100%',
    padding: '0.5rem 1rem 0.75rem 0.25rem',
  },
  '.cm-line': {
    padding: '0 0.125rem',
  },
  '.cm-gutters': {
    borderRight: '1px solid var(--code-preview-gutter-border)',
    backgroundColor: 'var(--code-preview-gutter-background)',
    color: 'var(--code-preview-muted)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '2.75rem',
    padding: '0 0.75rem 0 0.5rem',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--code-preview-selection) !important',
  },
  '.cm-scroller::-webkit-scrollbar': {
    width: '8px',
    height: '8px',
  },
  '.cm-scroller::-webkit-scrollbar-thumb': {
    backgroundColor: 'var(--code-preview-muted)',
    borderRadius: '999px',
  },
  '.cm-scroller::-webkit-scrollbar-track': {
    backgroundColor: 'transparent',
  },
});

export const codePreviewLanguages = {
  python: createCodePreviewStreamLanguage('python'),
  javascript: createCodePreviewStreamLanguage('javascript'),
  json: createCodePreviewStreamLanguage('json'),
  toml: createCodePreviewStreamLanguage('toml'),
  markdown: createCodePreviewStreamLanguage('markdown'),
};

export function createCodePreviewStreamLanguage(kind: Exclude<CodePreviewLanguageKind, 'text'>) {
  return StreamLanguage.define({
    name: kind,
    token(stream) {
      return tokenCodePreviewStream(stream, kind);
    },
  });
}

export function tokenCodePreviewStream(
  stream: StringStream,
  kind: Exclude<CodePreviewLanguageKind, 'text'>
): string | null {
  if (stream.eatSpace()) return null;
  if (kind === 'markdown' && stream.sol() && stream.match(/#{1,6}\s.*/)) return 'heading';
  if (kind === 'markdown' && stream.match(/\*\*[^*]+\*\*/)) return 'strong';
  if (kind === 'markdown' && stream.match(/`[^`]+`/)) return 'string';
  if ((kind === 'python' || kind === 'toml') && stream.match(/#.*/)) return 'comment';
  if (kind === 'javascript' && stream.match(/\/\/.*/)) return 'comment';
  if (kind === 'javascript' && stream.match(/\/\*.*?\*\//)) return 'comment';
  if (stream.match(/"(?:[^"\\]|\\.)*"/)) return 'string';
  if ((kind === 'python' || kind === 'javascript') && stream.match(/'(?:[^'\\]|\\.)*'/)) {
    return 'string';
  }
  if (kind === 'javascript' && stream.match(/`(?:[^`\\]|\\.)*`/)) return 'string';
  if (stream.match(/-?(?:0x[\da-f]+|\d+(?:\.\d+)?)(?:e[+-]?\d+)?/i)) return 'number';
  if ((kind === 'json' || kind === 'toml') && stream.match(/[A-Za-z0-9_.-]+(?=\s*=)/)) {
    return 'propertyName';
  }
  if (kind === 'json' && stream.match(/"(?:[^"\\]|\\.)*"(?=\s*:)/)) return 'propertyName';
  if (stream.match(/[A-Za-z_$][\w$]*/)) {
    const token = stream.current();
    if (CODE_PREVIEW_KEYWORDS[kind].has(token)) {
      return token === 'true' || token === 'false' || token === 'null' ? 'atom' : 'keyword';
    }
    if (/^[A-Z][A-Za-z0-9_]*$/.test(token)) return 'typeName';
    return 'variableName';
  }
  stream.next();
  return null;
}

const CODE_PREVIEW_LANGUAGE_LABELS: Record<CodePreviewLanguageKind, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  json: 'JSON',
  toml: 'TOML',
  markdown: 'Markdown',
  text: 'Text',
};

export function getCodePreviewLanguageKind(filePath: string): CodePreviewLanguageKind {
  const normalized = filePath.toLowerCase();
  if (/\.(py|pyw)$/.test(normalized)) return 'python';
  if (/\.(js|jsx|mjs|cjs|ts|tsx)$/.test(normalized)) return 'javascript';
  if (/\.json$/.test(normalized)) return 'json';
  if (/\.(toml|lock)$/.test(normalized)) return 'toml';
  if (/\.(md|markdown)$/.test(normalized)) return 'markdown';
  return 'text';
}

export function getCodePreviewLanguageLabel(filePath: string): string {
  return CODE_PREVIEW_LANGUAGE_LABELS[getCodePreviewLanguageKind(filePath)];
}

export function getCodePreviewLanguage(filePath: string) {
  const kind = getCodePreviewLanguageKind(filePath);
  return kind === 'text' ? [] : codePreviewLanguages[kind];
}

export function CodePreview({
  file,
  t,
  focusLine,
}: {
  file?: DataNormalizerProjectFile;
  t: TranslateFn;
  /** 1-based line to scroll to and highlight (报错 位置). */
  focusLine?: number;
}) {
  if (!file) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-xs font-medium text-text-muted">
        {t('data.rawTables.editor.selectedFileEmpty')}
      </div>
    );
  }
  return <CodeMirrorFilePreview file={file} focusLine={focusLine} />;
}

const focusLineDecoration = Decoration.line({
  attributes: { style: 'background-color: rgba(220, 38, 38, 0.12)', 'data-focus-line': 'true' },
});

export function CodeMirrorFilePreview({
  file,
  focusLine,
}: {
  file: DataNormalizerProjectFile;
  focusLine?: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const language = useMemo(() => getCodePreviewLanguage(file.path), [file.path]);
  const extensions = useMemo(
    () => [
      lineNumbers(),
      language,
      syntaxHighlighting(codePreviewHighlightStyle),
      codePreviewTheme,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      ...(focusLine
        ? [
            EditorView.decorations.of((view) => {
              if (focusLine < 1 || focusLine > view.state.doc.lines) return Decoration.none;
              return Decoration.set([
                focusLineDecoration.range(view.state.doc.line(focusLine).from),
              ]);
            }),
          ]
        : []),
    ],
    [language, focusLine]
  );

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({ doc: file.content, extensions }),
    });
    viewRef.current = view;
    // When the editor mounts before its 11px theme/layout settles (e.g. right after a step
    // switch), CodeMirror keeps the first line-height estimate and the line-number gutter drifts
    // away from the code. Force one real content measurement once layout has settled.
    const remeasure = () => {
      const state = (view as unknown as { viewState?: { mustMeasureContent?: boolean } }).viewState;
      if (state) state.mustMeasureContent = true;
      view.requestMeasure();
    };
    const frame = window.requestAnimationFrame(remeasure);
    const timer = window.setTimeout(remeasure, 300);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      view.destroy();
      viewRef.current = null;
    };
  }, [extensions, file.content]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === file.content) return;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: file.content,
      },
    });
  }, [file.content]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !focusLine || focusLine < 1 || focusLine > view.state.doc.lines) return;
    const line = view.state.doc.line(focusLine);
    view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
  }, [focusLine, file.content, extensions]);

  return <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />;
}
