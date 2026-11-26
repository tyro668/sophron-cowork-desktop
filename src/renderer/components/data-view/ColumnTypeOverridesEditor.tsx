import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import {
  DATA_FIELD_TYPES,
  type DataColumnTypeInfo,
  type DataFieldType,
} from '../../../shared/data-field-types';
import { useDataFieldTypeLabel } from '../../hooks/useDataFieldTypeLabel';
import type { DataRawTableColumnTypeOverride } from '../../types';
import { GlassSelect } from '../GlassSelect';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { RawTableCheckbox } from './shared';

export function RawTableConfigRow({
  label,
  children,
  align = 'center',
}: {
  label: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center';
}) {
  return (
    <div className="ui-form-row">
      <div className={`ui-form-label ${align === 'start' ? 'items-start pt-2.5' : 'items-center'}`}>
        {label}
      </div>
      <div className="ui-form-value">{children}</div>
    </div>
  );
}

export function ColumnTypeOverridesEditor({
  overrides,
  onChange,
  disabled,
  loadColumns,
}: {
  overrides: DataRawTableColumnTypeOverride[];
  onChange: (next: DataRawTableColumnTypeOverride[] | undefined) => void;
  disabled?: boolean;
  loadColumns: () => Promise<DataColumnTypeInfo[]>;
}) {
  const { t } = useTranslation();
  const dataTypeLabel = useDataFieldTypeLabel();
  const [fileColumns, setFileColumns] = useState<DataColumnTypeInfo[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const configuredNames = useMemo(
    () => new Set(overrides.map((entry) => entry.name.trim()).filter(Boolean)),
    [overrides]
  );
  const setOverride = (index: number, patch: Partial<DataRawTableColumnTypeOverride>) => {
    onChange(overrides.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  };
  const openPicker = async () => {
    setPicked(new Set());
    setPickerOpen(true);
    setPickerLoading(true);
    try {
      const columns = await loadColumns();
      setFileColumns(columns);
    } finally {
      setPickerLoading(false);
    }
  };
  const selectableColumns = fileColumns.filter((column) => !configuredNames.has(column.name));
  const confirmPicked = () => {
    const additions = fileColumns
      .filter((column) => picked.has(column.name) && !configuredNames.has(column.name))
      .map((column) => ({ name: column.name, type: column.type }));
    if (additions.length > 0) {
      onChange([...overrides, ...additions]);
    }
    setPickerOpen(false);
  };
  return (
    <div className="flex flex-1 flex-col" data-testid="column-type-overrides">
      {overrides.map((entry, index) => (
        <div
          key={index}
          className="grid min-h-[35px] grid-cols-[minmax(0,1fr)_9rem_40px] border-b border-border-subtle"
        >
          <input
            type="text"
            value={entry.name}
            placeholder={t('data.rawTables.editor.columnTypeNamePlaceholder')}
            disabled={disabled}
            onChange={(event) => setOverride(index, { name: event.target.value })}
            className="h-full w-full border-0 bg-transparent px-[10px] text-[12.5px] text-text-primary outline-none placeholder:text-text-muted hover:bg-surface-hover focus:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="flex border-l border-border-subtle">
            <GlassSelect
              value={entry.type}
              onValueChange={(value) => setOverride(index, { type: value as DataFieldType })}
              options={DATA_FIELD_TYPES.map((type) => ({
                value: type,
                label: dataTypeLabel(type),
              }))}
              disabled={disabled}
              triggerClassName="!h-full !min-h-[35px] w-full justify-between !rounded-none !border-0 !bg-transparent !shadow-none !px-[10px] text-text-primary hover:!bg-surface-hover disabled:opacity-60"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const next = overrides.filter((_, i) => i !== index);
              onChange(next.length > 0 ? next : undefined);
            }}
            aria-label={t('data.rawTables.editor.removeColumnType')}
            title={t('data.rawTables.editor.removeColumnType')}
            className="flex items-center justify-center border-l border-border-subtle text-text-muted transition-colors hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex min-h-[35px] items-stretch">
        <span className="ui-flush-text">
          {overrides.length > 0
            ? t('data.rawTables.editor.columnTypesCount', { count: overrides.length })
            : t('data.rawTables.editor.columnTypesAuto')}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void openPicker()}
          className="ui-accent-cell w-[120px] flex-shrink-0 border-l border-border-subtle"
        >
          <Eye className="h-3.5 w-3.5" />
          {t('data.rawTables.editor.pickColumnsFromFile')}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange([...overrides, { name: '', type: 'text' }])}
          className="ui-accent-cell w-[120px] flex-shrink-0 border-l border-border-subtle"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('data.rawTables.editor.addColumnType')}
        </button>
      </div>
      <Dialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        ariaLabel={t('data.rawTables.editor.pickColumnsTitle')}
        className="w-full max-w-md p-5"
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[14px] font-semibold text-text-primary">
            {t('data.rawTables.editor.pickColumnsTitle')}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPickerOpen(false)}
            className="text-text-muted hover:bg-accent-muted hover:text-accent"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {pickerLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-text-muted">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              {t('data.rawTables.editor.columnsLoading')}
            </div>
          ) : fileColumns.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-text-muted">
              {t('data.rawTables.editor.columnsEmpty')}
            </div>
          ) : (
            <div className="grid gap-0.5">
              {fileColumns.map((column) => {
                const isConfigured = configuredNames.has(column.name);
                const isPicked = picked.has(column.name);
                return (
                  <label
                    key={column.name}
                    className={`flex h-8 items-center gap-2 rounded-md px-2 text-[13px] ${
                      isConfigured
                        ? 'cursor-not-allowed text-text-muted/60'
                        : 'cursor-pointer text-text-primary hover:bg-surface-hover'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isConfigured || isPicked}
                      disabled={isConfigured}
                      onChange={(event) => {
                        setPicked((current) => {
                          const next = new Set(current);
                          if (event.target.checked) {
                            next.add(column.name);
                          } else {
                            next.delete(column.name);
                          }
                          return next;
                        });
                      }}
                      className="h-4 w-4 rounded border-border-muted text-accent focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{column.name}</span>
                    <span className="flex-shrink-0 text-[11px] text-text-muted">
                      {isConfigured
                        ? t('data.rawTables.editor.columnTypeAdded')
                        : dataTypeLabel(column.type)}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <RawTableCheckbox
            checked={
              selectableColumns.length > 0 && selectableColumns.every((c) => picked.has(c.name))
            }
            disabled={pickerLoading || selectableColumns.length === 0}
            label={t('common.selectAll')}
            onChange={(checked) =>
              setPicked(checked ? new Set(selectableColumns.map((c) => c.name)) : new Set())
            }
          />
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPickerOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={picked.size === 0}
              onClick={confirmPicked}
            >
              {t('data.rawTables.editor.confirmAddColumns', { count: picked.size })}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
