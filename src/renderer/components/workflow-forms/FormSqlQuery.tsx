import { useCallback, useMemo, useRef, useState } from 'react';
import { AlignLeft, CircleAlert, CircleCheck, CornerDownLeft, Search, Table2 } from 'lucide-react';
import type { OperatorFormProps } from './types';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { DEFAULT_SQL_QUERY, formatSqlQuery } from '../../../shared/sql-query';
import { Cell, FormGrid } from './shared/FormGrid';
import { DataTypeIcon } from './shared/DataTypeIcon';
import { SQL_QUERY_GRID_COLUMNS } from './shared/gridColumns';
import { SqlQueryEditor, type SqlQueryEditorHandle } from './sql-query/SqlQueryEditor';
import { validateSqlText } from './sql-query/sqlLint';

const ROW = 'flex h-8 shrink-0 items-center gap-2 border-b border-border-subtle px-3';
const PANE_HEAD = `${ROW} h-[30px] bg-background-secondary text-[11.5px] font-medium text-text-muted`;
const FIELD_ROW = `${ROW} w-full cursor-pointer text-left text-[12.5px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary`;

export default function FormSqlQuery({
  node,
  fieldCompletions,
  fieldTypes,
  onNodeChange,
}: OperatorFormProps) {
  const tr = useFormTranslation('sqlQuery');
  const updateConfig = useUpdateConfig(onNodeChange);
  const editorRef = useRef<SqlQueryEditorHandle>(null);
  const [search, setSearch] = useState('');

  const sql = typeof node.config.sql === 'string' ? node.config.sql : DEFAULT_SQL_QUERY;
  // Validation result is always visible (it used to flash for 3s after a click).
  const status = useMemo(() => validateSqlText(sql), [sql]);

  const typeByName = useMemo(
    () => new Map((fieldTypes ?? []).map((column) => [column.name, column.type])),
    [fieldTypes]
  );
  const filteredFields = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return fieldCompletions;
    return fieldCompletions.filter((field) => field.toLowerCase().includes(query));
  }, [fieldCompletions, search]);

  const onChange = useCallback(
    (next: string) => updateConfig((config) => ({ ...config, sql: next })),
    [updateConfig]
  );
  const insertField = useCallback((field: string) => {
    editorRef.current?.insertText(`"${field.replace(/"/g, '""')}"`);
  }, []);
  const insertKeyword = useCallback((keyword: string) => {
    editorRef.current?.insertText(keyword);
  }, []);
  const formatSql = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const formatted = formatSqlQuery(editor.getValue());
    if (formatted !== editor.getValue()) editor.replaceAll(formatted);
  }, []);
  const validateSql = useCallback(() => {
    editorRef.current?.jumpToFirstError();
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <FormGrid
        columns={SQL_QUERY_GRID_COLUMNS}
        className="min-h-0 flex-1"
        style={{ gridTemplateRows: 'auto minmax(0,1fr) auto' }}
        testId="sql-form-grid"
      >
        <Cell v={['th']}>{tr('availableData')}</Cell>
        <Cell testId="sql-status">
          {status === 'ok' ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
              <CircleCheck className="h-3.5 w-3.5 shrink-0 text-success" />
              <span className="text-success">{tr('validatePassed')}</span>
              <span className="truncate text-text-muted">· {tr('validateOkDetail')}</span>
            </span>
          ) : (
            <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-error">
              <CircleAlert className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {tr(status === 'invalid' ? 'invalid' : 'syntaxError')}
              </span>
            </span>
          )}
        </Cell>
        <button type="button" onClick={formatSql} className="opg-c btns gap-1.5">
          <AlignLeft className="h-3.5 w-3.5" />
          {tr('format')}
        </button>
        <button
          type="button"
          onClick={validateSql}
          className="opg-c btns gap-1.5"
          title="Ctrl + Enter"
        >
          <CircleCheck className="h-3.5 w-3.5" />
          {tr('validate')}
        </button>

        <Cell v={['pane']} style={{ minHeight: 0 }}>
          <div className={PANE_HEAD}>{tr('rawTable')}</div>
          <button
            type="button"
            onClick={() => insertKeyword('input')}
            title={tr('insertKeyword', { name: 'input' })}
            className={`${ROW} w-full bg-accent-muted text-left text-[13px] font-medium text-accent`}
          >
            <Table2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">input</span>
            <span className="ml-auto flex items-center gap-1 text-[11px] font-normal text-text-muted">
              <CornerDownLeft className="h-3 w-3" />
              {tr('insertShort')}
            </span>
          </button>
          <div className={`${ROW} relative`}>
            <Search className="pointer-events-none h-3.5 w-3.5 shrink-0 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={tr('searchFields')}
              aria-label={tr('searchFields')}
              className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] text-text-primary outline-none placeholder:text-text-muted"
            />
          </div>
          <div className={`${PANE_HEAD} justify-between`}>
            {tr('fields')}
            <span className="tabular-nums">{fieldCompletions.length}</span>
          </div>
          <div className="fx-list min-h-0 flex-1">
            {filteredFields.map((field) => (
              <button
                key={field}
                type="button"
                onClick={() => insertField(field)}
                title={tr('insertField', { name: field })}
                className={FIELD_ROW}
              >
                <DataTypeIcon type={typeByName.get(field)} className="shrink-0" />
                <span className="truncate">{field}</span>
              </button>
            ))}
            {filteredFields.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-text-muted">{tr('noMatchingFields')}</div>
            ) : null}
          </div>
        </Cell>
        <Cell span={3} v={['pane']} style={{ minHeight: 0 }}>
          <SqlQueryEditor
            key={node.id}
            ref={editorRef}
            value={sql}
            onChange={onChange}
            fields={fieldCompletions}
            label={tr('query')}
            syntaxErrorLabel={tr('syntaxError')}
            onValidate={validateSql}
          />
        </Cell>

        <Cell
          span={4}
          v={['muted']}
          style={{ minHeight: 30, background: 'var(--color-surface-muted)' }}
        >
          {tr('statusLine')}
        </Cell>
      </FormGrid>
    </div>
  );
}
