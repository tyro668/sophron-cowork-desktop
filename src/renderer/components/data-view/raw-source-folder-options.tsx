import { Minus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  DataRawFolderSchemaStrategy,
  DataRawFolderSortBy,
  DataRawSource,
  DataRawSystemFields,
  DataRawTableFolderConfig,
  DataUpdateRawSourceConfigInput,
} from '../../types';
import { GlassSelect } from '../GlassSelect';
import { cellInputClass, OptionLabelWithTip, Toggle } from './raw-source-wizard/shared';

export interface FolderSourceOptionsDraft {
  fileRange: DataRawTableFolderConfig['fileRange'];
  sheetBy: 'name' | 'index';
  sheetName: string;
  sheetIndex: number;
  recursive: boolean;
  sortBy: DataRawFolderSortBy;
  schemaStrategy: DataRawFolderSchemaStrategy;
  sheetAll: boolean;
  headerMode: 'auto' | 'manual';
  headerRow: number;
  systemFields: DataRawSystemFields;
  allText: boolean;
  password: string;
}

export function folderOptionsFromSource(source: DataRawSource): FolderSourceOptionsDraft {
  const cfg = source.config;
  const selector = cfg.sheetSelector;
  return {
    fileRange: cfg.fileRange ?? 'excel_csv',
    sheetBy: selector?.by ?? 'index',
    sheetName: selector?.by === 'name' ? selector.name : '',
    sheetIndex: selector?.by === 'index' ? selector.index : 1,
    recursive: cfg.recursive !== false,
    sortBy: cfg.sortBy ?? 'locale',
    schemaStrategy: cfg.schemaStrategy ?? 'align_by_name',
    sheetAll: cfg.sheetStrategy === 'all',
    headerMode: cfg.headerMode === 'manual' ? 'manual' : 'auto',
    headerRow: cfg.headerRow ?? 1,
    systemFields: cfg.systemFields ?? 'source_file',
    allText: cfg.fieldStrategy === 'all_text',
    password: '',
  };
}

export function isFolderOptionsDirty(
  draft: FolderSourceOptionsDraft,
  source: DataRawSource
): boolean {
  const baseline = folderOptionsFromSource(source);
  return (
    draft.fileRange !== baseline.fileRange ||
    draft.sheetBy !== baseline.sheetBy ||
    (draft.sheetBy === 'name'
      ? draft.sheetName.trim() !== baseline.sheetName.trim()
      : draft.sheetIndex !== baseline.sheetIndex) ||
    draft.recursive !== baseline.recursive ||
    draft.sortBy !== baseline.sortBy ||
    draft.schemaStrategy !== baseline.schemaStrategy ||
    draft.sheetAll !== baseline.sheetAll ||
    draft.headerMode !== baseline.headerMode ||
    (draft.headerMode === 'manual' && draft.headerRow !== baseline.headerRow) ||
    draft.systemFields !== baseline.systemFields ||
    draft.allText !== baseline.allText ||
    draft.password.length > 0
  );
}

export function buildUpdateRawSourceConfigInput(
  sourceId: string,
  draft: FolderSourceOptionsDraft,
  isMerge: boolean
): DataUpdateRawSourceConfigInput {
  return {
    sourceId,
    fileRange: draft.fileRange,
    sheetSelector:
      draft.sheetBy === 'name'
        ? draft.sheetName.trim()
          ? { by: 'name', name: draft.sheetName.trim() }
          : undefined
        : { by: 'index', index: Math.max(1, draft.sheetIndex) },
    recursive: draft.recursive,
    headerMode: draft.headerMode,
    headerRow: draft.headerMode === 'manual' ? Math.max(1, draft.headerRow) : undefined,
    fieldStrategy: draft.allText ? 'all_text' : 'auto',
    ...(isMerge
      ? {
          sortBy: draft.sortBy,
          schemaStrategy: draft.schemaStrategy,
          sheetStrategy: draft.sheetAll ? 'all' : 'selector',
          systemFields: draft.systemFields,
        }
      : {}),
    ...(draft.password ? { password: draft.password } : {}),
  };
}

export function FolderSourceOptionsSection({
  draft,
  isMerge,
  disabled,
  error,
  onChange,
}: {
  draft: FolderSourceOptionsDraft;
  isMerge: boolean;
  disabled: boolean;
  error: string | null;
  onChange: (next: FolderSourceOptionsDraft) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => String(t(`data.rawSources.${key}`));
  const sheetDisabled = disabled || (isMerge && draft.sheetAll);

  return (
    <section className="ui-group ui-form-flush bg-surface" data-testid="raw-source-folder-options">
      <div className="ui-group-title">{tr('importOptions.title')}</div>
      <div className="ui-form-row !pr-0">
        <div className="ui-form-label items-center">{tr('folder.strategy')}</div>
        <div className="ui-form-value !flex-row items-stretch text-[12.5px]">
          <div className="w-[140px] flex-none border-r border-border-subtle">
            <GlassSelect
              ariaLabel={tr('folder.strategy')}
              value={draft.sheetBy}
              disabled={sheetDisabled}
              onValueChange={(value) =>
                onChange({ ...draft, sheetBy: value === 'name' ? 'name' : 'index' })
              }
              options={[
                { value: 'name', label: tr('folder.byName') },
                { value: 'index', label: tr('folder.byIndex') },
              ]}
              triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </div>
          {draft.sheetBy === 'name' ? (
            <input
              value={draft.sheetName}
              placeholder={tr('folder.namePlaceholder')}
              aria-label={tr('folder.byName')}
              disabled={sheetDisabled}
              onChange={(event) => onChange({ ...draft, sheetName: event.target.value })}
              className={`${cellInputClass} min-w-0 flex-1`}
              data-testid="raw-source-folder-sheet-name"
            />
          ) : (
            <div className="flex items-stretch">
              <span className="flex flex-none items-stretch border-r border-border-subtle">
                <button
                  type="button"
                  disabled={sheetDisabled || draft.sheetIndex <= 1}
                  onClick={() =>
                    onChange({ ...draft, sheetIndex: Math.max(1, draft.sheetIndex - 1) })
                  }
                  className="px-2.5 text-text-secondary hover:bg-surface-hover disabled:opacity-40"
                  aria-label="-"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <input
                  value={draft.sheetIndex}
                  inputMode="numeric"
                  aria-label={tr('folder.byIndex')}
                  disabled={sheetDisabled}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value.replace(/\D/g, ''), 10);
                    onChange({
                      ...draft,
                      sheetIndex: Number.isFinite(parsed) && parsed >= 1 ? parsed : 1,
                    });
                  }}
                  className={`${cellInputClass} !w-12 !px-0 text-center tabular-nums`}
                  data-testid="raw-source-folder-sheet-index"
                />
                <button
                  type="button"
                  disabled={sheetDisabled}
                  onClick={() => onChange({ ...draft, sheetIndex: draft.sheetIndex + 1 })}
                  className="px-2.5 text-text-secondary hover:bg-surface-hover disabled:opacity-40"
                  aria-label="+"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </span>
              <span className="flex items-center px-2.5 text-[11.5px] text-text-muted">
                {tr('folder.minOne')}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="ui-form-row !pr-0">
        <div className="ui-form-label items-center">{tr('mode.fileType')}</div>
        <div className="ui-form-value">
          <GlassSelect
            ariaLabel={tr('mode.fileType')}
            value={draft.fileRange}
            disabled={disabled}
            onValueChange={(value) =>
              onChange({ ...draft, fileRange: value as DataRawTableFolderConfig['fileRange'] })
            }
            options={(['excel_csv', 'excel', 'csv'] as const).map((value) => ({
              value,
              label: tr(`mode.fileRange.${value}`),
            }))}
            triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
        </div>
      </div>

      <div className="ui-form-row !pr-0">
        <div className="ui-form-label items-center">{tr('importOptions.recursive')}</div>
        <div className="ui-form-value">
          <div className="flex flex-1 items-center px-2.5">
            <Toggle
              on={draft.recursive}
              disabled={disabled}
              onChange={(recursive) => onChange({ ...draft, recursive })}
              label={
                draft.recursive ? tr('importOptions.recursiveOn') : tr('importOptions.recursiveOff')
              }
              testId="raw-source-folder-recursive"
            />
          </div>
        </div>
      </div>

      {isMerge && (
        <>
          <div className="ui-form-row !pr-0">
            <div className="ui-form-label items-center">{tr('importOptions.sortBy')}</div>
            <div className="ui-form-value">
              <GlassSelect
                ariaLabel={tr('importOptions.sortBy')}
                value={draft.sortBy}
                disabled={disabled}
                onValueChange={(value) =>
                  onChange({ ...draft, sortBy: value as DataRawFolderSortBy })
                }
                options={(['locale', 'name', 'natural', 'mtime', 'ctime'] as const).map(
                  (value) => ({
                    value,
                    label: tr(`importOptions.sort.${value}`),
                  })
                )}
                triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
                contentClassName="w-[var(--radix-select-trigger-width)]"
              />
            </div>
          </div>
          <div className="ui-form-row !pr-0">
            <div className="ui-form-label items-center">{tr('importOptions.schema')}</div>
            <div className="ui-form-value">
              <GlassSelect
                ariaLabel={tr('importOptions.schema')}
                value={draft.schemaStrategy}
                disabled={disabled}
                onValueChange={(value) =>
                  onChange({ ...draft, schemaStrategy: value as DataRawFolderSchemaStrategy })
                }
                options={[
                  { value: 'align_by_name', label: tr('importOptions.schemaName') },
                  { value: 'align_by_index', label: tr('importOptions.schemaIndex') },
                ]}
                triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
                contentClassName="w-[var(--radix-select-trigger-width)]"
              />
            </div>
          </div>
          <div className="ui-form-row !pr-0">
            <OptionLabelWithTip
              label={tr('importOptions.sheetAll')}
              tip={tr('importOptions.sheetAllHint')}
              testId="raw-source-folder-sheet-all-tip"
            />
            <div className="ui-form-value">
              <div className="flex flex-1 items-center px-2.5">
                <Toggle
                  on={draft.sheetAll}
                  disabled={disabled}
                  onChange={(sheetAll) => onChange({ ...draft, sheetAll })}
                  label={draft.sheetAll ? tr('config.on') : tr('config.off')}
                  testId="raw-source-folder-sheet-all"
                />
              </div>
            </div>
          </div>
        </>
      )}

      <div className="ui-form-row !pr-0">
        <div className="ui-form-label items-center">{tr('importOptions.header')}</div>
        <div className="ui-form-value !flex-row items-stretch">
          <div
            className={`ui-flush-split grid flex-1 ${
              draft.headerMode === 'manual' ? 'grid-cols-[minmax(0,1fr)_10rem]' : ''
            }`}
          >
            <GlassSelect
              ariaLabel={tr('importOptions.header')}
              value={draft.headerMode}
              disabled={disabled}
              onValueChange={(value) =>
                onChange({ ...draft, headerMode: value === 'manual' ? 'manual' : 'auto' })
              }
              options={[
                { value: 'auto', label: tr('importOptions.headerAuto') },
                { value: 'manual', label: tr('importOptions.headerManual') },
              ]}
              triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
            {draft.headerMode === 'manual' ? (
              <label className="relative block border-l border-border-subtle">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={draft.headerRow}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      headerRow: Math.max(1, Math.floor(Number(event.target.value) || 1)),
                    })
                  }
                  className="box-border h-full min-h-[35px] w-full border-0 bg-transparent pl-[10px] pr-10 text-[12.5px] text-text-primary outline-none placeholder:text-text-muted hover:bg-surface-hover focus:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="raw-source-folder-header-row"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-text-muted">
                  {t('data.rawTables.editor.rowUnit')}
                </span>
              </label>
            ) : null}
          </div>
        </div>
      </div>

      {isMerge && (
        <div className="ui-form-row !pr-0">
          <div className="ui-form-label items-center">{tr('importOptions.systemFields')}</div>
          <div className="ui-form-value">
            <GlassSelect
              ariaLabel={tr('importOptions.systemFields')}
              value={draft.systemFields}
              disabled={disabled}
              onValueChange={(value) =>
                onChange({ ...draft, systemFields: value as DataRawSystemFields })
              }
              options={[
                { value: 'source_file', label: tr('importOptions.systemSourceFile') },
                { value: 'local_agent', label: tr('importOptions.systemLocalAgent') },
                { value: 'none', label: tr('importOptions.systemNone') },
              ]}
              triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </div>
        </div>
      )}

      <div className="ui-form-row !pr-0">
        <OptionLabelWithTip
          label={tr('importOptions.allText')}
          tip={tr('importOptions.allTextHint')}
          testId="raw-source-folder-all-text-tip"
        />
        <div className="ui-form-value">
          <div className="flex flex-1 items-center px-2.5">
            <Toggle
              on={draft.allText}
              disabled={disabled}
              onChange={(allText) => onChange({ ...draft, allText })}
              label={draft.allText ? tr('config.on') : tr('config.off')}
              testId="raw-source-folder-all-text"
            />
          </div>
        </div>
      </div>

      <div className="ui-form-row !pr-0">
        <div className="ui-form-label items-center">{tr('importOptions.password')}</div>
        <div className="ui-form-value">
          <input
            type="password"
            value={draft.password}
            disabled={disabled}
            onChange={(event) => onChange({ ...draft, password: event.target.value })}
            placeholder={tr('importOptions.passwordPlaceholder')}
            className={cellInputClass}
            data-testid="raw-source-folder-password"
            autoComplete="off"
          />
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 text-[12px] text-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
