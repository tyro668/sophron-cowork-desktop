// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorState } from '@codemirror/state';
import { autocompletion } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { PostgreSQL, sql } from '@codemirror/lang-sql';
import {
  SqlQueryEditor,
  type SqlQueryEditorHandle,
} from '../../src/renderer/components/workflow-forms/sql-query/SqlQueryEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function hasErrorNode(doc: string): boolean {
  const state = EditorState.create({ doc, extensions: [sql({ dialect: PostgreSQL })] });
  let found = false;
  syntaxTree(state)
    .cursor()
    .iterate((node) => {
      if (node.type.isError) found = true;
    });
  return found;
}

describe('SqlQueryEditor', () => {
  it('mounts, edits, and exposes insertText via ref', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onChange = vi.fn();
    const ref = { current: null as SqlQueryEditorHandle | null };
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(SqlQueryEditor, {
          ref,
          value: 'SELECT *\nFROM input',
          onChange,
          fields: ['name', 'amount'],
          label: 'SQL',
          syntaxErrorLabel: 'syntax error',
        })
      );
    });
    expect(host.querySelector('.cm-editor')).not.toBeNull();
    expect(host.textContent).toContain('SELECT');

    ref.current?.insertText('"name"');
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.lastCall?.[0]).toContain('"name"');

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('registers schema + keyword completion sources', () => {
    const state = EditorState.create({
      doc: 'SELECT  FROM input',
      extensions: [
        sql({
          dialect: PostgreSQL,
          schema: { input: ['name', 'amount'] },
          defaultTable: 'input',
          upperCaseKeywords: true,
        }),
        autocompletion(),
      ],
    });
    const sources = state.languageDataAt<unknown>('autocomplete', 7);
    expect(sources.length).toBeGreaterThan(0);
  });

  it('flags malformed SQL via error nodes while valid SQL stays clean', () => {
    expect(hasErrorNode('SELECT * FROM input')).toBe(false);
    expect(hasErrorNode('SELECT * FROM (')).toBe(true);
  });
});
