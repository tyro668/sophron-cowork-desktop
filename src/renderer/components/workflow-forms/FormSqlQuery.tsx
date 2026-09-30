import { useCallback, useRef } from 'react';
import { CornerDownLeft } from 'lucide-react';
import type { OperatorFormProps } from './types';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { DEFAULT_SQL_QUERY } from '../../../shared/sql-query';
import { SqlQueryEditor, type SqlQueryEditorHandle } from './sql-query/SqlQueryEditor';

const itemClass =
  'group flex w-full items-center justify-between gap-1 rounded-md px-2 py-1 text-left font-mono text-[11px] text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent';
const categoryClass =
  'px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-text-muted/80';

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
  const insertKeyword = useCallback((keyword: string) => {
    editorRef.current?.insertText(keyword);
  }, []);
  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-44 flex-shrink-0 flex-col overflow-hidden border-r border-border-muted">
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          <div className={categoryClass}>{tr('keywords')}</div>
          <button
            type="button"
            onClick={() => insertKeyword('input')}
            title={tr('insertKeyword', { name: 'input' })}
            className={itemClass}
          >
            <span className="truncate">input</span>
            <CornerDownLeft className="h-2.5 w-2.5 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
          </button>
          {fieldCompletions.length > 0 && (
            <>
              <div className={`${categoryClass} mt-1.5 border-t border-border-subtle`}>
                {tr('fields')}
              </div>
              {fieldCompletions.map((field) => (
                <button
                  key={field}
                  type="button"
                  onClick={() => insertField(field)}
                  title={tr('insertField', { name: field })}
                  className={itemClass}
                >
                  <span className="truncate">{field}</span>
                  <CornerDownLeft className="h-2.5 w-2.5 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                </button>
              ))}
            </>
          )}
        </div>
      </div>
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
