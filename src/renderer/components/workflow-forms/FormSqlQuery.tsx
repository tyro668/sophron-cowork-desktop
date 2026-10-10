import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignLeft,
  Calendar,
  CircleCheck,
  CornerDownLeft,
  Hash,
  Search,
  Table2,
  ToggleLeft,
  Type,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { OperatorFormProps } from './types';
import { useFormTranslation } from '../../hooks/useFormTranslation';
import { useUpdateConfig } from '../../hooks/useUpdateConfig';
import { DEFAULT_SQL_QUERY, formatSqlQuery } from '../../../shared/sql-query';
import type { DataFieldType } from '../../../shared/data-field-types';
import { SqlQueryEditor, type SqlQueryEditorHandle } from './sql-query/SqlQueryEditor';

const itemClass =
  'group flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left font-mono text-[11px] text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent';
const categoryClass =
  'px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-text-muted/80';
const toolButtonClass =
  'inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-2.5 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-accent';

const FIELD_TYPE_ICONS: Record<DataFieldType, LucideIcon> = {
  text: Type,
  integer: Hash,
  float: Hash,
  decimal: Hash,
  date: Calendar,
  datetime: Calendar,
  boolean: ToggleLeft,
};

function fieldTypeIcon(type: DataFieldType | undefined): LucideIcon {
  return (type && FIELD_TYPE_ICONS[type]) || Type;
}

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
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!status) return undefined;
    const timeoutId = window.setTimeout(() => setStatus(null), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [status]);

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
    (sql: string) => updateConfig((config) => ({ ...config, sql })),
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
    const result = editorRef.current?.validate();
    if (result === 'ok') {
      setStatus({ kind: 'ok', text: tr('validatePassed') });
    } else {
      setStatus({ kind: 'error', text: tr(result === 'invalid' ? 'invalid' : 'syntaxError') });
    }
  }, [tr]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-center justify-end gap-2 border-b border-border-muted px-2 py-1.5">
        {status ? (
          <span
            className={`mr-auto text-[11px] ${
              status.kind === 'ok' ? 'text-success' : 'text-error'
            }`}
          >
            {status.text}
          </span>
        ) : null}
        <button type="button" onClick={formatSql} className={toolButtonClass}>
          <AlignLeft className="h-3 w-3" />
          {tr('format')}
        </button>
        <button type="button" onClick={validateSql} className={toolButtonClass}>
          <CircleCheck className="h-3 w-3" />
          {tr('validate')}
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-48 flex-shrink-0 flex-col overflow-hidden border-r border-border-muted">
          <div className={categoryClass}>{tr('rawTable')}</div>
          <button
            type="button"
            onClick={() => insertKeyword('input')}
            title={tr('insertKeyword', { name: 'input' })}
            className="group mx-1.5 flex h-7 items-center gap-1.5 rounded-md border border-border-muted bg-surface px-2 text-[12px] text-text-primary transition-colors hover:border-accent/40 hover:text-accent"
          >
            <Table2 className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
            <span className="truncate">input</span>
            <CornerDownLeft className="ml-auto h-2.5 w-2.5 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
          </button>
          <div className="relative mx-1.5 mt-2">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={tr('searchFields')}
              className="h-7 w-full rounded-md border border-border-muted bg-surface pl-7 pr-2 text-[11px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
            />
          </div>
          <div
            className={`${categoryClass} mt-1.5 flex items-center justify-between border-t border-border-subtle`}
          >
            {tr('fields')}
            <span className="tabular-nums">{fieldCompletions.length}</span>
          </div>
          <div className="scrollbar-hover min-h-0 flex-1 overflow-y-auto px-1 pb-1">
            {filteredFields.map((field) => {
              const TypeIcon = fieldTypeIcon(typeByName.get(field));
              return (
                <button
                  key={field}
                  type="button"
                  onClick={() => insertField(field)}
                  title={tr('insertField', { name: field })}
                  className={itemClass}
                >
                  <TypeIcon className="h-3 w-3 flex-shrink-0 text-text-muted/70" />
                  <span className="truncate">{field}</span>
                  <CornerDownLeft className="ml-auto h-2.5 w-2.5 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                </button>
              );
            })}
            {filteredFields.length === 0 ? (
              <div className="px-2 py-1 text-[11px] text-text-muted">{tr('noMatchingFields')}</div>
            ) : null}
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
    </div>
  );
}
