import { Minus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  DataColumnTypeInfo,
  DataRawFolderSchemaStrategy,
  DataRawFolderSortBy,
  DataRawSystemFields,
  DataRawTableConfig,
  DataRawTableCsvConfig,
  DataRawTableExcelConfig,
  DataRawTableFolderConfig,
  DataRawTableSourceKind,
} from '../../../types';
import { GlassSelect } from '../../GlassSelect';
import { ColumnTypeOverridesEditor, RawTableConfigRow } from '../ColumnTypeOverridesEditor';
import { cellInputClass, OptionLabelWithTip, Toggle } from '../raw-source-wizard/shared';
import { RawTableSelect } from '../shared';

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
            <div className="ui-form-row !pr-0">
              <OptionLabelWithTip
                label={t('data.rawTables.editor.headerRow')}
                tip={t('data.rawTables.editor.headerRowDetectHint')}
                testId="raw-table-excel-header-row-tip"
              />
              <div className="ui-form-value">
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
              </div>
            </div>
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
            <RawTableConfigRow label={t('data.rawSources.folder.strategy')}>
              <div className="flex min-w-0 flex-1 items-stretch text-[12.5px]">
                <div className="w-[140px] flex-none border-r border-border-subtle">
                  <GlassSelect
                    ariaLabel={t('data.rawSources.folder.strategy')}
                    value={folderConfig.sheetSelector?.by ?? 'index'}
                    disabled={disabled || folderConfig.sheetStrategy === 'all'}
                    onValueChange={(value) => {
                      const nextSelector =
                        value === 'name'
                          ? {
                              by: 'name' as const,
                              name:
                                folderConfig.sheetSelector?.by === 'name'
                                  ? folderConfig.sheetSelector.name
                                  : '',
                            }
                          : {
                              by: 'index' as const,
                              index:
                                folderConfig.sheetSelector?.by === 'index'
                                  ? folderConfig.sheetSelector.index
                                  : 1,
                            };
                      onUpdateConfig({ ...folderConfig, sheetSelector: nextSelector });
                    }}
                    options={[
                      { value: 'name', label: t('data.rawSources.folder.byName') },
                      { value: 'index', label: t('data.rawSources.folder.byIndex') },
                    ]}
                    triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
                    contentClassName="w-[var(--radix-select-trigger-width)]"
                  />
                </div>
                {folderConfig.sheetSelector?.by === 'name' ? (
                  <input
                    value={folderConfig.sheetSelector.name}
                    placeholder={t('data.rawSources.folder.namePlaceholder')}
                    aria-label={t('data.rawSources.folder.byName')}
                    disabled={disabled || folderConfig.sheetStrategy === 'all'}
                    onChange={(event) =>
                      onUpdateConfig({
                        ...folderConfig,
                        sheetSelector: { by: 'name', name: event.target.value },
                      })
                    }
                    className={`${cellInputClass} min-w-0 flex-1`}
                    data-testid="raw-table-folder-sheet-name"
                  />
                ) : (
                  <div className="flex items-stretch">
                    <span className="flex flex-none items-stretch border-r border-border-subtle">
                      <button
                        type="button"
                        disabled={
                          disabled ||
                          folderConfig.sheetStrategy === 'all' ||
                          (folderConfig.sheetSelector?.by === 'index'
                            ? folderConfig.sheetSelector.index
                            : 1) <= 1
                        }
                        onClick={() => {
                          const current =
                            folderConfig.sheetSelector?.by === 'index'
                              ? folderConfig.sheetSelector.index
                              : 1;
                          onUpdateConfig({
                            ...folderConfig,
                            sheetSelector: { by: 'index', index: Math.max(1, current - 1) },
                          });
                        }}
                        className="px-2.5 text-text-secondary hover:bg-surface-hover disabled:opacity-40"
                        aria-label="-"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <input
                        value={
                          folderConfig.sheetSelector?.by === 'index'
                            ? folderConfig.sheetSelector.index
                            : 1
                        }
                        inputMode="numeric"
                        aria-label={t('data.rawSources.folder.byIndex')}
                        disabled={disabled || folderConfig.sheetStrategy === 'all'}
                        onChange={(event) => {
                          const parsed = Number.parseInt(event.target.value.replace(/\D/g, ''), 10);
                          onUpdateConfig({
                            ...folderConfig,
                            sheetSelector: {
                              by: 'index',
                              index: Number.isFinite(parsed) && parsed >= 1 ? parsed : 1,
                            },
                          });
                        }}
                        className={`${cellInputClass} !w-12 !px-0 text-center tabular-nums`}
                        data-testid="raw-table-folder-sheet-index"
                      />
                      <button
                        type="button"
                        disabled={disabled || folderConfig.sheetStrategy === 'all'}
                        onClick={() => {
                          const current =
                            folderConfig.sheetSelector?.by === 'index'
                              ? folderConfig.sheetSelector.index
                              : 1;
                          onUpdateConfig({
                            ...folderConfig,
                            sheetSelector: { by: 'index', index: current + 1 },
                          });
                        }}
                        className="px-2.5 text-text-secondary hover:bg-surface-hover disabled:opacity-40"
                        aria-label="+"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </span>
                    <span className="flex items-center px-2.5 text-[11.5px] text-text-muted">
                      {t('data.rawSources.folder.minOne')}
                    </span>
                  </div>
                )}
              </div>
            </RawTableConfigRow>
            <RawTableConfigRow label={t('data.rawSources.mode.fileType')}>
              <GlassSelect
                ariaLabel={t('data.rawSources.mode.fileType')}
                value={folderConfig.fileRange}
                disabled={disabled}
                onValueChange={(value) =>
                  onUpdateConfig({
                    ...folderConfig,
                    fileRange: value as DataRawTableFolderConfig['fileRange'],
                  })
                }
                options={(['excel_csv', 'excel', 'csv'] as const).map((value) => ({
                  value,
                  label: t(`data.rawSources.mode.fileRange.${value}`),
                }))}
                triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
                contentClassName="w-[var(--radix-select-trigger-width)]"
              />
            </RawTableConfigRow>
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

      {localSourceKind === 'folder' ? (
        <div className="ui-group ui-form-flush bg-surface" data-testid="raw-table-folder-options">
          <div className="ui-group-title">{t('data.rawSources.importOptions.title')}</div>
          <RawTableConfigRow label={t('data.rawSources.importOptions.recursive')}>
            <div className="flex flex-1 items-center px-2.5">
              <Toggle
                on={folderConfig.recursive !== false}
                disabled={disabled}
                onChange={(recursive) => onUpdateConfig({ ...folderConfig, recursive })}
                label={
                  folderConfig.recursive !== false
                    ? t('data.rawSources.importOptions.recursiveOn')
                    : t('data.rawSources.importOptions.recursiveOff')
                }
                testId="raw-table-folder-recursive"
              />
            </div>
          </RawTableConfigRow>
          <RawTableConfigRow label={t('data.rawSources.importOptions.sortBy')}>
            <GlassSelect
              ariaLabel={t('data.rawSources.importOptions.sortBy')}
              value={folderConfig.sortBy ?? 'locale'}
              disabled={disabled}
              onValueChange={(value) =>
                onUpdateConfig({
                  ...folderConfig,
                  sortBy: value as DataRawFolderSortBy,
                })
              }
              options={(['locale', 'name', 'natural', 'mtime', 'ctime'] as const).map((value) => ({
                value,
                label: t(`data.rawSources.importOptions.sort.${value}`),
              }))}
              triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </RawTableConfigRow>
          <RawTableConfigRow label={t('data.rawSources.importOptions.schema')}>
            <GlassSelect
              ariaLabel={t('data.rawSources.importOptions.schema')}
              value={folderConfig.schemaStrategy ?? 'align_by_name'}
              disabled={disabled}
              onValueChange={(value) =>
                onUpdateConfig({
                  ...folderConfig,
                  schemaStrategy: value as DataRawFolderSchemaStrategy,
                })
              }
              options={[
                { value: 'align_by_name', label: t('data.rawSources.importOptions.schemaName') },
                { value: 'align_by_index', label: t('data.rawSources.importOptions.schemaIndex') },
              ]}
              triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </RawTableConfigRow>
          <div className="ui-form-row !pr-0">
            <OptionLabelWithTip
              label={t('data.rawSources.importOptions.sheetAll')}
              tip={t('data.rawSources.importOptions.sheetAllHint')}
              testId="raw-table-folder-sheet-all-tip"
            />
            <div className="ui-form-value">
              <div className="flex flex-1 items-center px-2.5">
                <Toggle
                  on={folderConfig.sheetStrategy === 'all'}
                  disabled={disabled}
                  onChange={(on) =>
                    onUpdateConfig({
                      ...folderConfig,
                      sheetStrategy: on ? 'all' : 'selector',
                    })
                  }
                  label={
                    folderConfig.sheetStrategy === 'all'
                      ? t('data.rawSources.config.on')
                      : t('data.rawSources.config.off')
                  }
                  testId="raw-table-folder-sheet-all"
                />
              </div>
            </div>
          </div>
          <RawTableConfigRow label={t('data.rawSources.importOptions.header')}>
            <div
              className={`ui-flush-split grid flex-1 ${
                folderConfig.headerMode === 'manual' ? 'grid-cols-[minmax(0,1fr)_10rem]' : ''
              }`}
            >
              <GlassSelect
                ariaLabel={t('data.rawSources.importOptions.header')}
                value={folderConfig.headerMode === 'manual' ? 'manual' : 'auto'}
                disabled={disabled}
                onValueChange={(value) =>
                  onUpdateConfig({
                    ...folderConfig,
                    headerMode: value === 'manual' ? 'manual' : 'auto',
                    headerRow: value === 'manual' ? (folderConfig.headerRow ?? 1) : undefined,
                  })
                }
                options={[
                  { value: 'auto', label: t('data.rawSources.importOptions.headerAuto') },
                  { value: 'manual', label: t('data.rawSources.importOptions.headerManual') },
                ]}
                triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
                contentClassName="w-[var(--radix-select-trigger-width)]"
              />
              {folderConfig.headerMode === 'manual' ? (
                <label className="relative block border-l border-border-subtle">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={folderConfig.headerRow ?? 1}
                    disabled={disabled}
                    onChange={(event) =>
                      onUpdateConfig({
                        ...folderConfig,
                        headerRow: Math.max(1, Math.floor(Number(event.target.value) || 1)),
                      })
                    }
                    className="box-border h-full min-h-[35px] w-full border-0 bg-transparent pl-[10px] pr-10 text-[12.5px] text-text-primary outline-none placeholder:text-text-muted hover:bg-surface-hover focus:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="raw-table-folder-header-row"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-text-muted">
                    {t('data.rawTables.editor.rowUnit')}
                  </span>
                </label>
              ) : null}
            </div>
          </RawTableConfigRow>
          <RawTableConfigRow label={t('data.rawSources.importOptions.systemFields')}>
            <GlassSelect
              ariaLabel={t('data.rawSources.importOptions.systemFields')}
              value={
                folderConfig.systemFields ??
                (folderConfig.keepSourceFileName === false ? 'none' : 'source_file')
              }
              disabled={disabled}
              onValueChange={(value) => {
                const systemFields = value as DataRawSystemFields;
                onUpdateConfig({
                  ...folderConfig,
                  systemFields,
                  keepSourceFileName: systemFields !== 'none',
                });
              }}
              options={[
                {
                  value: 'source_file',
                  label: t('data.rawSources.importOptions.systemSourceFile'),
                },
                {
                  value: 'local_agent',
                  label: t('data.rawSources.importOptions.systemLocalAgent'),
                },
                { value: 'none', label: t('data.rawSources.importOptions.systemNone') },
              ]}
              triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </RawTableConfigRow>
          <div className="ui-form-row !pr-0">
            <OptionLabelWithTip
              label={t('data.rawSources.importOptions.allText')}
              tip={t('data.rawSources.importOptions.allTextHint')}
              testId="raw-table-folder-all-text-tip"
            />
            <div className="ui-form-value">
              <div className="flex flex-1 items-center px-2.5">
                <Toggle
                  on={folderConfig.fieldStrategy === 'all_text'}
                  disabled={disabled}
                  onChange={(on) =>
                    onUpdateConfig({
                      ...folderConfig,
                      fieldStrategy: on ? 'all_text' : 'auto',
                    })
                  }
                  label={
                    folderConfig.fieldStrategy === 'all_text'
                      ? t('data.rawSources.config.on')
                      : t('data.rawSources.config.off')
                  }
                  testId="raw-table-folder-all-text"
                />
              </div>
            </div>
          </div>
          <RawTableConfigRow label={t('data.rawSources.importOptions.password')}>
            <input
              type="password"
              value={folderConfig.password ?? ''}
              disabled={disabled}
              onChange={(event) =>
                onUpdateConfig({
                  ...folderConfig,
                  password: event.target.value || undefined,
                })
              }
              placeholder={
                folderConfig.hasPassword
                  ? t('data.rawSources.importOptions.passwordSavedPlaceholder')
                  : t('data.rawSources.importOptions.passwordPlaceholder')
              }
              className={cellInputClass}
              data-testid="raw-table-folder-password"
              autoComplete="off"
            />
          </RawTableConfigRow>
        </div>
      ) : null}
    </div>
  );
}
