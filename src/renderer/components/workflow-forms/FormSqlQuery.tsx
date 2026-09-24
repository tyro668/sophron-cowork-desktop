import { useCallback, useRef } from 'react';
import { CircleHelp, CornerDownLeft } from 'lucide-react';
import type { OperatorFormProps } from './types';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { DEFAULT_SQL_QUERY } from '../../../shared/sql-query';
import { SqlQueryEditor, type SqlQueryEditorHandle } from './sql-query/SqlQueryEditor';

export default function FormSqlQuery({ node, fieldCompletions, onNodeChange }: OperatorFormProps) {
  const tr = useFormTranslation('sqlQuery');
  const updateConfig = useUpdateConfig(onNodeChange);
  const editorRef = useRef<SqlQueryEditorHandle>(null);
  const onChange = useCallback(
    (sql: string) => updateConfig((config) => ({ ...config, sql })),
    [updateConfig]
  );
  const insertField = useCallback((field: string) => {
    editorRef.current?.insertText(`"${field.replace(/"/g, '""')}"`);
  }, []);
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-text-secondary">
          <span>{tr('query')}</span>
          <span title={tr('help')} aria-label={tr('help')} tabIndex={0}>
            <CircleHelp className="h-3.5 w-3.5 text-text-muted" />
          </span>
        </div>
        <span className="text-text-muted">
          {tr('inputTable')} <code className="text-accent">input</code>
        </span>
      </div>
      {fieldCompletions.length > 0 && (
        <div className="flex flex-shrink-0 items-center gap-1 overflow-x-auto pb-0.5">
          <span className="flex-shrink-0 text-[11px] text-text-muted">{tr('columns')}</span>
          {fieldCompletions.map((field) => (
            <button
              key={field}
              type="button"
              onClick={() => insertField(field)}
              title={tr('insertField', { name: field })}
              className="group flex h-5 flex-shrink-0 items-center gap-1 rounded-md border border-border-subtle px-1.5 font-mono text-[11px] text-text-secondary transition-colors hover:border-accent/40 hover:bg-accent-muted hover:text-accent"
            >
              {field}
              <CornerDownLeft className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-60" />
            </button>
          ))}
        </div>
      )}
      <SqlQueryEditor
        key={node.id}
        ref={editorRef}
        value={typeof node.config.sql === 'string' ? node.config.sql : DEFAULT_SQL_QUERY}
        onChange={onChange}
        fields={fieldCompletions}
        label={tr('query')}
        syntaxErrorLabel={tr('syntaxError')}
      />
    </div>
  );
}
