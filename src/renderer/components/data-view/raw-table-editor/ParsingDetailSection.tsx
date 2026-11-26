import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  DataColumnTypeInfo,
  DataRawTableConfig,
  DataRawTableCsvConfig,
  DataRawTableExcelConfig,
  DataRawTableFolderConfig,
  DataRawTableSourceKind,
} from '../../../types';
import { GlassSelect } from '../../GlassSelect';
import { ColumnTypeOverridesEditor, RawTableConfigRow } from '../ColumnTypeOverridesEditor';
import { RawTableCheckbox, RawTableSelect } from '../shared';

interface ParsingDetailSectionProps {
  localSourceKind: DataRawTableSourceKind;
  localConfig: DataRawTableConfig;
  excelConfig: DataRawTableExcelConfig;
  folderConfig: DataRawTableFolderConfig;
  disabled: boolean;
  onUpdateConfig: (next: DataRawTableConfig) => void;
  loadSourceColumns: () => Promise<DataColumnTypeInfo[]>;
}

export function ParsingDetailSection({
  localSourceKind,
  localConfig,
  excelConfig,
  folderConfig,
  disabled,
  onUpdateConfig,
  loadSourceColumns,
}: ParsingDetailSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface">
      <div className="ui-group ui-form-flush bg-surface">
        <div className="ui-group-title">{t('data.rawTables.editor.sectionParsingDetail')}</div>
        {localSourceKind === 'excel' ? (
          <>
            <RawTableConfigRow label={t('data.rawTables.editor.sheetName')}>
              <GlassSelect
                value={excelConfig.sheetName ?? ''}
                onValueChange={(value) =>
                  onUpdateConfig({
                    ...excelConfig,
                    sheetName: value,
                  })
                }
                options={(excelConfig.sheetNames.length > 0
                  ? excelConfig.sheetNames
                  : ['Sheet1']
                ).map((sheetName) => ({ value: sheetName, label: sheetName }))}
                disabled={disabled}
                triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
                contentClassName="w-[var(--radix-select-trigger-width)]"
              />
            </RawTableConfigRow>
            <RawTableConfigRow
              label={
                <span className="inline-flex items-center gap-1.5">
                  {t('data.rawTables.editor.headerRow')}
                  <span className="group relative inline-flex">
                    <button
                      type="button"
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-accent-muted hover:text-accent focus:bg-accent-muted focus:text-accent focus:outline-none"
                      aria-label={t('data.rawTables.editor.headerRowDetectHint')}
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                    <span className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-72 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-left text-[12px] font-medium leading-5 text-text-secondary shadow-elevated group-hover:block group-focus-within:block">
                      {t('data.rawTables.editor.headerRowDetectHint')}
                    </span>
                  </span>
                </span>
              }
            >
              <div
                className={`ui-flush-split grid flex-1 ${
                  excelConfig.headerMode === 'manual' ? 'grid-cols-[minmax(0,1fr)_10rem]' : ''
                }`}
              >
                <GlassSelect
                  value={excelConfig.headerMode}
                  onValueChange={(value) =>
                    onUpdateConfig({
                      ...excelConfig,
                      headerMode: value as DataRawTableExcelConfig['headerMode'],
                    })
                  }
                  options={[
                    { value: 'auto', label: t('data.rawTables.editor.smartDetect') },
                    {
                      value: 'manual',
                      label: t('data.rawTables.editor.manualSpecify'),
                    },
                  ]}
                  disabled={disabled}
                  triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
                  contentClassName="w-[var(--radix-select-trigger-width)]"
                />
                {excelConfig.headerMode === 'manual' ? (
                  <label className="relative block border-l border-border-subtle">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={excelConfig.headerRow}
                      onChange={(event) =>
                        onUpdateConfig({
                          ...excelConfig,
                          headerRow: Math.max(1, Math.floor(Number(event.target.value) || 1)),
                        })
                      }
                      disabled={disabled}
                      className="box-border h-full min-h-[35px] w-full border-0 bg-transparent pl-[10px] pr-10 text-[12.5px] text-text-primary outline-none placeholder:text-text-muted hover:bg-surface-hover focus:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-text-muted">
                      {t('data.rawTables.editor.rowUnit')}
                    </span>
                  </label>
                ) : null}
              </div>
            </RawTableConfigRow>
            <RawTableConfigRow label={t('data.rawTables.editor.columnTypes')}>
              <ColumnTypeOverridesEditor
                overrides={excelConfig.columnTypeOverrides ?? []}
                onChange={(columnTypeOverrides) =>
                  onUpdateConfig({ ...excelConfig, columnTypeOverrides })
                }
                disabled={disabled}
                loadColumns={loadSourceColumns}
              />
            </RawTableConfigRow>
          </>
        ) : null}

        {localSourceKind === 'csv' ? (
          <div>
            {[
              ['header', 'data.rawTables.editor.csvHeader'],
              ['dataRegion', 'data.rawTables.editor.csvDataRegion'],
              ['delimiter', 'data.rawTables.editor.csvDelimiter'],
            ].map(([key, labelKey]) => (
              <RawTableConfigRow key={key} label={t(labelKey)}>
                <span className="ui-flush-text">{t('data.rawTables.editor.autoDetected')}</span>
              </RawTableConfigRow>
            ))}
            <RawTableConfigRow label={t('data.rawTables.editor.csvEncoding')}>
              <RawTableSelect
                flush
                value={localConfig.sourceKind === 'csv' ? localConfig.encoding : 'auto'}
                disabled={disabled}
                onChange={(value) =>
                  localConfig.sourceKind === 'csv'
                    ? onUpdateConfig({
                        ...localConfig,
                        encoding: value as DataRawTableCsvConfig['encoding'],
                      })
                    : undefined
                }
                options={[
                  { value: 'auto', label: t('data.rawTables.editor.csvEncodingAuto') },
                  { value: 'utf-8', label: 'UTF-8' },
                  { value: 'gbk', label: t('data.rawTables.editor.csvEncodingGbk') },
                ]}
              />
            </RawTableConfigRow>
            <RawTableConfigRow label={t('data.rawTables.editor.columnTypes')}>
              <ColumnTypeOverridesEditor
                overrides={
                  localConfig.sourceKind === 'csv' ? (localConfig.columnTypeOverrides ?? []) : []
                }
                onChange={(columnTypeOverrides) =>
                  localConfig.sourceKind === 'csv'
                    ? onUpdateConfig({ ...localConfig, columnTypeOverrides })
                    : undefined
                }
                disabled={disabled}
                loadColumns={loadSourceColumns}
              />
            </RawTableConfigRow>
          </div>
        ) : null}

        {localSourceKind === 'folder' ? (
          <div>
            <RawTableConfigRow label={t('data.rawTables.editor.fileSelectionRange')}>
              <RawTableSelect
                flush
                value={folderConfig.fileRange}
                disabled={disabled}
                onChange={(value) =>
                  onUpdateConfig({
                    ...folderConfig,
                    fileRange: value as DataRawTableFolderConfig['fileRange'],
                  })
                }
                options={[
                  {
                    value: 'excel_csv',
                    label: t('data.rawTables.editor.includeExcelCsv'),
                  },
                  { value: 'excel', label: t('data.rawTables.editor.includeExcel') },
                  { value: 'csv', label: t('data.rawTables.editor.includeCsv') },
                ]}
              />
            </RawTableConfigRow>
            <div className="flex flex-wrap gap-3 border-b border-border-subtle px-3 py-2.5">
              <RawTableCheckbox
                checked={folderConfig.skipEmptyFiles}
                disabled={disabled}
                label={t('data.rawTables.editor.skipEmptyFiles')}
                onChange={(checked) => onUpdateConfig({ ...folderConfig, skipEmptyFiles: checked })}
              />
              <RawTableCheckbox
                checked={folderConfig.keepSourceFileName}
                disabled={disabled}
                label={t('data.rawTables.editor.keepSourceFileName')}
                onChange={(checked) =>
                  onUpdateConfig({ ...folderConfig, keepSourceFileName: checked })
                }
              />
            </div>
            <RawTableConfigRow label={t('data.rawTables.editor.columnTypes')}>
              <ColumnTypeOverridesEditor
                overrides={folderConfig.columnTypeOverrides ?? []}
                onChange={(columnTypeOverrides) =>
                  onUpdateConfig({ ...folderConfig, columnTypeOverrides })
                }
                disabled={disabled}
                loadColumns={loadSourceColumns}
              />
            </RawTableConfigRow>
          </div>
        ) : null}
      </div>
    </div>
  );
}
