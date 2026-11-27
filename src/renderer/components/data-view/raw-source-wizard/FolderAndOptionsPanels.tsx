import { Check, Minus, Plus, Table2 } from 'lucide-react';
import type {
  DataRawFolderMergeReport,
  DataRawSourceCreateResult,
  DataRawSourceFileScan,
  DataRawSourceScan,
} from '../../../types';
import {
  cellInputClass,
  cellSelectClass,
  groupClass,
  NameField,
  OptionLabelWithTip,
  panelClass,
  primaryButton,
  secondaryButton,
  SELECT_CHEVRON,
  stemOf,
  Toggle,
  type Tr,
} from './shared';

export function SheetStrategyRow(props: {
  tr: Tr;
  files: DataRawSourceFileScan[];
  by: 'name' | 'index';
  setBy: (by: 'name' | 'index') => void;
  name: string;
  setName: (name: string) => void;
  index: number;
  setIndex: (index: number) => void;
}) {
  const { tr, files, by } = props;
  const ready = files.filter((file) => file.status === 'ready' || file.status === 'type_conflict');
  const missing = files.filter((file) => file.status === 'missing_sheet');
  return (
    <div className="ui-form-row" data-testid="raw-source-sheet-strategy">
      <div className="ui-form-label items-center">{tr('folder.strategy')}</div>
      <div className="ui-form-value !flex-row items-stretch text-[12.5px]">
        <select
          value={by}
          onChange={(event) => props.setBy(event.target.value as 'name' | 'index')}
          aria-label={tr('folder.strategy')}
          className={`${cellSelectClass} w-[140px] flex-none border-r border-border-subtle`}
          style={{ backgroundImage: SELECT_CHEVRON }}
          data-testid="raw-source-selector-by"
        >
          <option value="name">{tr('folder.byName')}</option>
          <option value="index">{tr('folder.byIndex')}</option>
        </select>
        {by === 'name' ? (
          <input
            value={props.name}
            placeholder={tr('folder.namePlaceholder')}
            onChange={(event) => props.setName(event.target.value)}
            aria-label={tr('folder.byName')}
            data-testid="raw-source-selector-name"
            className={`${cellInputClass} !w-[200px] flex-none border-r border-border-subtle`}
          />
        ) : (
          <span className="flex flex-none items-stretch border-r border-border-subtle">
            <button
              type="button"
              disabled={props.index <= 1}
              onClick={() => props.setIndex(Math.max(1, props.index - 1))}
              className="px-2.5 text-text-secondary hover:bg-surface-hover disabled:opacity-40"
              aria-label="-"
            >
              <Minus className="h-3 w-3" />
            </button>
            <input
              value={props.index}
              inputMode="numeric"
              aria-label={tr('folder.byIndex')}
              onChange={(event) => {
                const value = Number.parseInt(event.target.value.replace(/\D/g, ''), 10);
                props.setIndex(Number.isFinite(value) && value >= 1 ? value : 1);
              }}
              data-testid="raw-source-selector-index"
              className={`${cellInputClass} !w-12 !px-0 text-center tabular-nums`}
            />
            <button
              type="button"
              onClick={() => props.setIndex(props.index + 1)}
              className="px-2.5 text-text-secondary hover:bg-surface-hover"
              aria-label="+"
            >
              <Plus className="h-3 w-3" />
            </button>
          </span>
        )}
        {by === 'index' && (
          <span className="flex items-center px-2.5 text-[11.5px] text-text-muted">
            {tr('folder.minOne')}
          </span>
        )}
        <span
          className={`ml-auto flex items-center whitespace-nowrap px-2.5 ${missing.length ? 'text-warning' : 'text-success'}`}
        >
          {tr('folder.matchSummary', { ready: ready.length, missing: missing.length })}
        </span>
      </div>
    </div>
  );
}

function statusText(tr: Tr, file: DataRawSourceFileScan): string {
  switch (file.status) {
    case 'ready':
      return tr('folder.statusReady');
    case 'missing_sheet':
      return file.reason || tr('folder.statusMissing');
    case 'type_conflict':
      return tr('folder.statusConflict', { columns: (file.conflictColumns ?? []).join('、') });
    case 'skipped':
      return tr('folder.tempFile');
    case 'unreadable':
      return file.reason || tr('folder.statusUnreadable');
  }
}

function statusTone(file: DataRawSourceFileScan): string {
  if (file.status === 'ready') return 'text-success';
  if (file.status === 'skipped') return 'text-text-muted';
  return file.status === 'missing_sheet' ? 'text-warning' : 'text-error';
}

export function FolderMergeTable({
  tr,
  scan,
  mergedName,
  setMergedName,
}: {
  tr: Tr;
  scan: DataRawSourceScan;
  mergedName: string;
  setMergedName: (name: string) => void;
}) {
  const files = scan.files;
  const ready = files.filter((file) => file.status === 'ready');
  const missing = files.filter((file) => file.status === 'missing_sheet').length;
  const conflict = files.filter((file) => file.status === 'type_conflict').length;
  const filled = scan.merge?.filledColumns ?? [];
  const allColumns = Array.from(new Set(ready.flatMap((file) => file.columns)));
  return (
    <div data-testid="raw-source-folder-merge">
      <NameField
        label={tr('folder.mergedName')}
        value={mergedName}
        onChange={setMergedName}
        testId="raw-source-merged-name"
      />
      <div className="mt-3 rounded-lg border border-border-subtle">
        <div className="flex h-9 items-center border-b border-border-subtle px-3 text-[12.5px]">
          <span className="font-medium text-text-primary">{tr('folder.compat')}</span>
          <span className="ml-auto text-text-muted">
            {tr('folder.compatSummary', {
              total: files.length,
              ready: scan.merge?.fileCount ?? 0,
              rows: scan.merge?.rowCount ?? 0,
            })}
          </span>
        </div>
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead>
            <tr className="h-8 border-b border-border-subtle text-text-muted">
              <th className="px-3 font-medium">{tr('folder.colFile')}</th>
              <th className="px-2 font-medium">{tr('folder.colSheet')}</th>
              <th className="w-16 px-2 text-right font-medium">{tr('folder.colRows')}</th>
              <th className="px-2 font-medium">{tr('folder.colStructure')}</th>
              <th className="px-2 font-medium">{tr('folder.colStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => {
              const lacking =
                file.status === 'ready'
                  ? allColumns.filter((column) => !file.columns.includes(column))
                  : [];
              return (
                <tr
                  key={file.relativePath}
                  className={`h-9 border-b border-dashed border-border-muted ${file.status === 'skipped' ? 'opacity-60' : ''}`}
                >
                  <td className="truncate px-3 text-text-primary">{file.relativePath}</td>
                  <td className="px-2 text-text-secondary">{file.usedSheet ?? '—'}</td>
                  <td className="px-2 text-right tabular-nums">
                    {file.status === 'ready' || file.status === 'type_conflict'
                      ? file.rowCount
                      : '—'}
                  </td>
                  <td className="px-2 text-text-secondary">
                    {file.status !== 'ready'
                      ? '—'
                      : lacking.length
                        ? tr('folder.fills', { count: lacking.length, columns: lacking.join('、') })
                        : tr('folder.consistent')}
                  </td>
                  <td className={`px-2 ${statusTone(file)}`}>{statusText(tr, file)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filled.length > 0 && (
        <div
          className="mt-2 text-[12.5px] text-text-secondary"
          data-testid="raw-source-filled-notice"
        >
          {tr('folder.filledNotice', { columns: filled.map((item) => item.name).join('、') })}
        </div>
      )}
      {missing + conflict > 0 && (
        <div className="mt-1 text-[12.5px] text-warning">
          {tr('folder.notMerged', { count: missing + conflict, missing, conflict })}
        </div>
      )}
    </div>
  );
}

export function FolderPerFileTable(props: {
  tr: Tr;
  files: DataRawSourceFileScan[];
  fileStem: string;
  names: Record<string, string>;
  setNames: (names: Record<string, string>) => void;
  overrides: Record<string, string>;
  setOverrides: (overrides: Record<string, string>) => void;
  unchecked: string[];
  setUnchecked: (paths: string[]) => void;
  willCreate: number;
}) {
  const { tr, files } = props;
  return (
    <div
      className="rounded-lg border border-border-subtle"
      data-testid="raw-source-folder-per-file"
    >
      <div className="flex h-9 items-center border-b border-border-subtle px-3 text-[12.5px]">
        <span className="font-medium text-text-primary">{tr('folder.detected')}</span>
        <span className="ml-auto text-text-muted">
          {tr('folder.detectedSummary', { total: files.length, count: props.willCreate })}
        </span>
      </div>
      <table className="w-full border-collapse text-left text-[12.5px]">
        <thead>
          <tr className="h-8 border-b border-border-subtle text-text-muted">
            <th className="w-8 px-3" />
            <th className="px-2 font-medium">{tr('folder.colFile')}</th>
            <th className="px-2 font-medium">{tr('folder.colUsedSheet')}</th>
            <th className="px-2 font-medium">{tr('folder.colTableName')}</th>
            <th className="w-16 px-2 text-right font-medium">{tr('folder.colRows')}</th>
            <th className="px-2 font-medium">{tr('folder.colStatus')}</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => {
            const key = file.relativePath;
            const override = props.overrides[key];
            const usable =
              file.status === 'ready' ||
              file.status === 'type_conflict' ||
              (file.status === 'missing_sheet' && !!override);
            const included = usable && !props.unchecked.includes(key);
            return (
              <tr
                key={key}
                className={`h-9 border-b border-dashed border-border-muted ${usable ? '' : 'opacity-70'}`}
              >
                <td className="px-3">
                  <input
                    type="checkbox"
                    checked={included}
                    disabled={!usable}
                    onChange={() =>
                      props.setUnchecked(
                        included
                          ? [...props.unchecked, key]
                          : props.unchecked.filter((item) => item !== key)
                      )
                    }
                  />
                </td>
                <td className="truncate px-2 text-text-primary">{key}</td>
                <td className="px-2">
                  {file.sheetNames.length > 1 ? (
                    <select
                      value={override ?? ''}
                      onChange={(event) => {
                        const next = { ...props.overrides };
                        if (event.target.value) next[key] = event.target.value;
                        else delete next[key];
                        props.setOverrides(next);
                      }}
                      data-testid={`raw-source-override-${key}`}
                      className="h-7 max-w-[10rem] rounded-md border border-border-subtle bg-surface px-1.5"
                    >
                      <option value="">{file.usedSheet ?? tr('folder.pickSheet')}</option>
                      {file.sheetNames.map((sheet) => (
                        <option key={sheet} value={sheet}>
                          {sheet}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-text-secondary">{file.usedSheet ?? '—'}</span>
                  )}
                </td>
                <td className="px-2">
                  {usable ? (
                    <input
                      value={props.names[key] ?? `${props.fileStem} / ${stemOf(key)}`}
                      onChange={(event) =>
                        props.setNames({ ...props.names, [key]: event.target.value })
                      }
                      className="h-7 w-full rounded-md border border-border-subtle bg-surface px-2"
                    />
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-2 text-right tabular-nums">{usable ? file.rowCount : '—'}</td>
                <td
                  className={`px-2 ${override && file.status === 'missing_sheet' ? 'text-success' : statusTone(file)}`}
                >
                  {file.status === 'type_conflict'
                    ? tr('folder.statusReady')
                    : override && file.status === 'missing_sheet'
                      ? tr('folder.statusReady')
                      : statusText(tr, file)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DoneStep({
  tr,
  result,
  isFolder,
  onOpenData,
  onCreatePipeline,
}: {
  tr: Tr;
  result: DataRawSourceCreateResult;
  isFolder: boolean;
  onOpenData: (tableId: string) => void;
  onCreatePipeline?: (tableId: string) => void;
}) {
  const { source, tables, skipped } = result;
  const merged = source.buildMode === 'folder_merge' || source.buildMode === 'excel_merge_sheets';
  const title =
    tables.length > 1
      ? tr('done.createdMany', { count: tables.length })
      : merged
        ? tr('done.createdMerged', { name: tables[0]?.name ?? '' })
        : tr('done.createdOne', { name: tables[0]?.name ?? '' });
  const report =
    source.buildMode === 'folder_merge'
      ? (tables[0]?.inputConfig as { mergeReport?: DataRawFolderMergeReport } | undefined)
          ?.mergeReport
      : undefined;
  return (
    <div className={panelClass} data-testid="raw-source-done">
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <div className="flex items-center gap-2 text-[16px] font-medium text-text-primary">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success text-success-foreground">
            <Check className="h-3.5 w-3.5" />
          </span>
          {title}
        </div>
        <div className="mt-2 text-[12.5px] text-text-muted">
          {tr('done.sourceLine', { name: source.name })}
          {source.config.autoInclude &&
            ` · ${isFolder ? tr('done.autoFilesOn') : tr('done.autoOn')}`}
        </div>
        {report && (
          <div className="mt-1 text-[12.5px] text-text-muted">
            {tr('done.mergedLine', {
              files: report.includedFiles.length,
              rows: tables[0]?.rowCount ?? 0,
              filled: report.filledColumns.length,
            })}
          </div>
        )}
        <div className="mt-4 rounded-lg border border-border-subtle">
          {tables.map((table) => (
            <div
              key={table.id}
              className="flex h-9 items-center gap-2 border-b border-dashed border-border-muted px-3 text-[13px] last:border-b-0"
            >
              <Table2 className="h-3.5 w-3.5 text-text-muted" />
              <span className="truncate text-text-primary">{table.name}</span>
              <span className="ml-auto tabular-nums text-text-muted">
                {tr('done.rowsValue', { rows: table.rowCount })}
              </span>
            </div>
          ))}
        </div>
        {skipped.length > 0 && (
          <div className="mt-2 text-[12.5px] text-warning">
            {tr('done.skipped', {
              items: skipped.map((item) => `${item.key}（${item.reason}）`).join('；'),
            })}
          </div>
        )}
        <div className="mt-6 flex items-center gap-2">
          {tables[0] && (
            <button
              type="button"
              className={primaryButton}
              onClick={() => onOpenData(tables[0].id)}
              data-testid="raw-source-open-data"
            >
              {tr('done.openData')}
            </button>
          )}
          {onCreatePipeline && tables[0] && (
            <button
              type="button"
              className={secondaryButton}
              onClick={() => onCreatePipeline(tables[0].id)}
            >
              {tr('done.newPipeline')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ImportOptionsPanel(props: {
  tr: Tr;
  kind: 'folder' | 'excel';
  recursive: boolean;
  setRecursive: (value: boolean) => void;
  sortBy: 'locale' | 'name' | 'natural' | 'mtime' | 'ctime';
  setSortBy: (value: 'locale' | 'name' | 'natural' | 'mtime' | 'ctime') => void;
  schemaStrategy: string;
  setSchemaStrategy: (value: 'align_by_name' | 'align_by_index') => void;
  sheetAll: boolean;
  setSheetAll: (value: boolean) => void;
  fieldAllText: boolean;
  setFieldAllText: (value: boolean) => void;
  systemFields: string;
  setSystemFields: (value: 'none' | 'source_file' | 'local_agent') => void;
  folderHeaderMode: 'auto' | 'manual';
  setFolderHeaderMode: (value: 'auto' | 'manual') => void;
  folderHeaderRow: number;
  setFolderHeaderRow: (value: number) => void;
  password: string;
  setPassword: (value: string) => void;
}) {
  const { tr } = props;
  return (
    <section className={groupClass} data-testid="raw-source-import-options">
      <div className="ui-group-title">{tr('importOptions.title')}</div>
      {props.kind === 'folder' && (
        <>
          <div className="ui-form-row">
            <div className="ui-form-label items-center">{tr('importOptions.recursive')}</div>
            <div className="ui-form-value">
              <div className="flex flex-1 items-center px-2.5">
                <Toggle
                  on={props.recursive}
                  onChange={props.setRecursive}
                  label={
                    props.recursive
                      ? tr('importOptions.recursiveOn')
                      : tr('importOptions.recursiveOff')
                  }
                  testId="raw-source-recursive"
                />
              </div>
            </div>
          </div>
          <div className="ui-form-row">
            <div className="ui-form-label items-center">{tr('importOptions.sortBy')}</div>
            <div className="ui-form-value">
              <select
                value={props.sortBy}
                onChange={(event) => props.setSortBy(event.target.value as typeof props.sortBy)}
                className={cellSelectClass}
                data-testid="raw-source-sort-by"
              >
                {(['locale', 'name', 'natural', 'mtime', 'ctime'] as const).map((value) => (
                  <option key={value} value={value}>
                    {tr(`importOptions.sort.${value}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="ui-form-row">
            <div className="ui-form-label items-center">{tr('importOptions.schema')}</div>
            <div className="ui-form-value">
              <select
                value={props.schemaStrategy}
                onChange={(event) =>
                  props.setSchemaStrategy(event.target.value as 'align_by_name' | 'align_by_index')
                }
                className={cellSelectClass}
                data-testid="raw-source-schema-strategy"
              >
                <option value="align_by_name">{tr('importOptions.schemaName')}</option>
                <option value="align_by_index">{tr('importOptions.schemaIndex')}</option>
              </select>
            </div>
          </div>
          <div className="ui-form-row">
            <OptionLabelWithTip
              label={tr('importOptions.sheetAll')}
              tip={tr('importOptions.sheetAllHint')}
              testId="raw-source-sheet-all-tip"
            />
            <div className="ui-form-value">
              <div className="flex flex-1 items-center px-2.5">
                <Toggle
                  on={props.sheetAll}
                  onChange={props.setSheetAll}
                  label={props.sheetAll ? tr('config.on') : tr('config.off')}
                  testId="raw-source-sheet-all-files"
                />
              </div>
            </div>
          </div>
          <div className="ui-form-row">
            <div className="ui-form-label items-center">{tr('importOptions.header')}</div>
            <div className="ui-form-value !flex-row items-stretch">
              <select
                value={props.folderHeaderMode}
                onChange={(event) =>
                  props.setFolderHeaderMode(event.target.value as 'auto' | 'manual')
                }
                className={cellSelectClass}
                data-testid="raw-source-folder-header-mode"
              >
                <option value="auto">{tr('importOptions.headerAuto')}</option>
                <option value="manual">{tr('importOptions.headerManual')}</option>
              </select>
              {props.folderHeaderMode === 'manual' && (
                <div className="w-20 flex-shrink-0 border-l border-border-subtle">
                  <input
                    type="number"
                    min={1}
                    value={props.folderHeaderRow}
                    onChange={(event) =>
                      props.setFolderHeaderRow(Math.max(1, Number(event.target.value) || 1))
                    }
                    className="h-full w-full bg-transparent px-2 text-[13px] outline-none"
                    data-testid="raw-source-folder-header-row"
                  />
                </div>
              )}
            </div>
          </div>
          <div className="ui-form-row">
            <div className="ui-form-label items-center">{tr('importOptions.systemFields')}</div>
            <div className="ui-form-value">
              <select
                value={props.systemFields}
                onChange={(event) =>
                  props.setSystemFields(
                    event.target.value as 'none' | 'source_file' | 'local_agent'
                  )
                }
                className={cellSelectClass}
                data-testid="raw-source-system-fields"
              >
                <option value="source_file">{tr('importOptions.systemSourceFile')}</option>
                <option value="local_agent">{tr('importOptions.systemLocalAgent')}</option>
                <option value="none">{tr('importOptions.systemNone')}</option>
              </select>
            </div>
          </div>
        </>
      )}
      <div className="ui-form-row">
        <OptionLabelWithTip
          label={tr('importOptions.allText')}
          tip={tr('importOptions.allTextHint')}
          testId="raw-source-all-text-tip"
        />
        <div className="ui-form-value">
          <div className="flex flex-1 items-center px-2.5">
            <Toggle
              on={props.fieldAllText}
              onChange={props.setFieldAllText}
              label={props.fieldAllText ? tr('config.on') : tr('config.off')}
              testId="raw-source-all-text"
            />
          </div>
        </div>
      </div>
      <div className="ui-form-row">
        <div className="ui-form-label items-center">{tr('importOptions.password')}</div>
        <div className="ui-form-value">
          <input
            type="password"
            value={props.password}
            onChange={(event) => props.setPassword(event.target.value)}
            placeholder={tr('importOptions.passwordPlaceholder')}
            className={cellInputClass}
            data-testid="raw-source-password"
            autoComplete="off"
          />
        </div>
      </div>
    </section>
  );
}
