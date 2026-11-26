/**
 * Raw-table source wizard (1:N): 1 choose source → 2 build mode → 3 select & configure → 4 done.
 * Config pages show no data preview; the done step opens the created table's Data tab.
 * In rebuild mode (changing a source's build mode) the final step asks for an explicit
 * confirmation before the existing tables are deleted and recreated.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CloudDownload,
  FileSpreadsheet,
  Folder,
  Layers,
  Table2,
} from 'lucide-react';
import type {
  DataCreateRawSourceInput,
  DataRawSheetSelector,
  DataRawSource,
  DataRawSourceBuildMode,
  DataRawSourceCreateResult,
  DataRawSourceRebuildImpact,
  DataRawSourceScan,
} from '../../types';
import { dataClient } from '../../features/data/api/data-client';
import { formatDataErrorMessage } from '../../features/data/model/errors';
import { RebuildConfirmDialog } from './raw-source-rebuild-dialog';
import {
  cellInputClass,
  cellSelectClass,
  ConfigTabBar,
  ConfigTitleBar,
  type FileRange,
  footerClass,
  formatScanTime,
  groupClass,
  hasSameColumns,
  panelClass,
  primaryButton,
  secondaryButton,
  SELECT_CHEVRON,
  SourceCard,
  SourceGroup,
  SourceSummary,
  stemOf,
  type Step,
  titleCellClass,
  Toggle,
  type Tr,
} from './raw-source-wizard/shared';
import { SheetConfigurator } from './raw-source-wizard/SheetConfigurator';
import {
  DoneStep,
  FolderMergeTable,
  FolderPerFileTable,
  ImportOptionsPanel,
  SheetStrategyRow,
} from './raw-source-wizard/FolderAndOptionsPanels';

export {
  cellSelectClass,
  formatScanTime,
  groupClass,
  SELECT_CHEVRON,
  stemOf,
  titleCellClass,
  Toggle,
};

export interface RawSourceWizardProps {
  onBack: () => void;
  onOpenData: (tableId: string) => void;
  onOpenCloud: () => void;
  onCreated?: (result: DataRawSourceCreateResult) => void;
  onCreatePipeline?: (tableId: string) => void;
  /** Rebuild an existing source with a new build mode (tables are deleted after confirmation). */
  rebuild?: { source: DataRawSource; buildMode: DataRawSourceBuildMode };
  /**
   * Inline mode for changing the build mode from an edit page: no title bar, tabs, source
   * group or done step — the host page keeps its own header and drives 保存 / 取消 through
   * `onControls`. `rebuild.buildMode` may change while mounted (the host's mode select).
   */
  embedded?: boolean;
  onControls?: (controls: RawSourceWizardControls) => void;
}

export interface RawSourceWizardControls {
  canSave: boolean;
  saving: boolean;
  save: () => void;
}

export function RawSourceWizard({
  onBack,
  onOpenData,
  onOpenCloud,
  onCreated,
  onCreatePipeline,
  rebuild,
  embedded = false,
  onControls,
}: RawSourceWizardProps) {
  const { t } = useTranslation();
  const tr: Tr = useCallback(
    (key: string, options?: Record<string, unknown>) =>
      String(t(`data.rawSources.${key}`, options ?? {})),
    [t]
  );
  const [step, setStep] = useState<Step>(rebuild ? 3 : 1);
  const [path, setPath] = useState(rebuild?.source.sourcePath ?? '');
  const [pathInput, setPathInput] = useState('');
  const [scan, setScan] = useState<DataRawSourceScan | null>(null);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<DataRawSourceBuildMode | null>(rebuild?.buildMode ?? null);
  const [singleSheet, setSingleSheet] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [headerRows, setHeaderRows] = useState<Record<string, number | undefined>>({});
  const [mergeSheets, setMergeSheets] = useState(rebuild?.buildMode === 'excel_merge_sheets');
  const [autoInclude, setAutoInclude] = useState(true);
  const [mergedName, setMergedName] = useState('');
  const [selectorBy, setSelectorBy] = useState<'name' | 'index'>('index');
  const [selectorName, setSelectorName] = useState('');
  const [selectorIndex, setSelectorIndex] = useState(1);
  const [fileRange, setFileRange] = useState<FileRange>('excel_csv');
  const [recursive, setRecursive] = useState(rebuild?.source.config.recursive !== false);
  const [sortBy, setSortBy] = useState<'locale' | 'name' | 'natural' | 'mtime' | 'ctime'>(
    rebuild?.source.config.sortBy ?? 'locale'
  );
  const [schemaStrategy, setSchemaStrategy] = useState(
    rebuild?.source.config.schemaStrategy ?? 'align_by_name'
  );
  const [sheetAll, setSheetAll] = useState(rebuild?.source.config.sheetStrategy === 'all');
  const [fieldAllText, setFieldAllText] = useState(
    rebuild?.source.config.fieldStrategy === 'all_text'
  );
  const [systemFields, setSystemFields] = useState(
    rebuild?.source.config.systemFields ?? 'source_file'
  );
  const [folderHeaderMode, setFolderHeaderMode] = useState<'auto' | 'manual'>(
    rebuild?.source.config.headerMode === 'manual' ? 'manual' : 'auto'
  );
  const [folderHeaderRow, setFolderHeaderRow] = useState(rebuild?.source.config.headerRow ?? 1);
  const [password, setPassword] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [unchecked, setUnchecked] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<DataRawSourceCreateResult | null>(null);
  const [impact, setImpact] = useState<DataRawSourceRebuildImpact | null>(null);

  const selector: DataRawSheetSelector | undefined = useMemo(() => {
    if (selectorBy === 'name') {
      return selectorName.trim() ? { by: 'name', name: selectorName.trim() } : undefined;
    }
    return { by: 'index', index: Math.max(1, selectorIndex) };
  }, [selectorBy, selectorIndex, selectorName]);

  const runScan = useCallback(
    async (target: string, opts?: { keepStep?: boolean }) => {
      setScanning(true);
      setError(null);
      try {
        const next = await dataClient.scanRawSource({
          sourcePath: target,
          sheetSelector: selector,
          fileSheetOverrides: overrides,
          fileRange,
        });
        setScan(next);
        setScannedAt(Date.now());
        setPath(next.sourcePath);
        if (!opts?.keepStep) {
          const dataSheets = next.sheets.filter((sheet) => !sheet.empty);
          setSingleSheet(dataSheets[0]?.name ?? next.sheets[0]?.name ?? null);
          setChecked(dataSheets.map((sheet) => sheet.name));
          setMergedName(`${stemOf(next.name)}${t('data.rawSources.mergedNameSuffix')}`);
          setNames({});
          setUnchecked([]);
          if (next.kind === 'csv') {
            setMode('single');
            setStep(3);
          } else if (next.kind === 'excel' && next.sheets.length <= 1) {
            setMode('excel_single');
            setStep(3);
          } else {
            setMode(
              next.kind === 'excel'
                ? dataSheets.length <= 1
                  ? 'excel_single'
                  : 'excel_per_sheet'
                : 'folder_merge'
            );
            setStep(2);
          }
        }
      } catch (err) {
        setError(formatDataErrorMessage(err, t));
      } finally {
        setScanning(false);
      }
    },
    [fileRange, overrides, selector, t]
  );

  // Rebuild: start from the existing source's settings and scan it once.
  const rebuildScanned = useRef(false);
  useEffect(() => {
    if (!rebuild || rebuildScanned.current) return;
    rebuildScanned.current = true;
    const s = rebuild.source.config.sheetSelector;
    if (s?.by === 'name') {
      setSelectorBy('name');
      setSelectorName(s.name);
    } else if (s?.by === 'index') {
      setSelectorIndex(s.index);
    }
    if (rebuild.source.config.fileRange) setFileRange(rebuild.source.config.fileRange);
    void runScan(rebuild.source.sourcePath, { keepStep: true });
  }, [rebuild, runScan]);

  // Embedded: the host's mode select changes the target mode in place.
  const targetMode = rebuild?.buildMode;
  useEffect(() => {
    if (!targetMode) return;
    setMode(targetMode);
    setMergeSheets(targetMode === 'excel_merge_sheets');
  }, [targetMode]);

  useEffect(() => {
    if (!rebuild || !scan || scan.kind !== 'folder') return;
    setMergedName(
      (current) => current || `${stemOf(scan.name)}${t('data.rawSources.mergedNameSuffix')}`
    );
  }, [rebuild, scan, t]);

  useEffect(() => {
    if (!rebuild || !scan || scan.kind !== 'excel') return;
    setChecked((current) =>
      current.length ? current : scan.sheets.filter((s) => !s.empty).map((s) => s.name)
    );
    setSingleSheet((current) => current ?? scan.sheets.find((s) => !s.empty)?.name ?? null);
    setMergedName(
      (current) => current || `${stemOf(scan.name)}${t('data.rawSources.mergedNameSuffix')}`
    );
  }, [rebuild, scan, t]);

  // Folder: re-scan when the sheet strategy, overrides or file range change.
  const folderKey = JSON.stringify([selector, overrides, fileRange]);
  const lastFolderKey = useRef(folderKey);
  useEffect(() => {
    if (!scan || scan.kind !== 'folder' || lastFolderKey.current === folderKey) return;
    lastFolderKey.current = folderKey;
    const timer = window.setTimeout(() => void runScan(scan.sourcePath, { keepStep: true }), 300);
    return () => window.clearTimeout(timer);
  }, [folderKey, runScan, scan]);

  const pick = async (kind: 'excel' | 'folder') => {
    const picked = await dataClient.pickRawTableSourcePath(kind);
    if (picked) void runScan(picked);
  };

  const sourceName = scan?.name ?? rebuild?.source.name ?? '';
  const fileStem = stemOf(sourceName);
  const sheetByName = useMemo(
    () => new Map((scan?.sheets ?? []).map((sheet) => [sheet.name, sheet])),
    [scan]
  );
  const checkedSheets = checked.filter((name) => sheetByName.has(name));
  const mergeable =
    checkedSheets.length > 1 &&
    checkedSheets.every((name) =>
      hasSameColumns(sheetByName.get(name)!.columns, sheetByName.get(checkedSheets[0])!.columns)
    );
  const effectiveMode: DataRawSourceBuildMode | null =
    mode === 'excel_per_sheet' || mode === 'excel_merge_sheets'
      ? mergeSheets && mergeable
        ? 'excel_merge_sheets'
        : 'excel_per_sheet'
      : mode;

  const files = useMemo(() => scan?.files ?? [], [scan]);
  const perFileFiles = files.filter(
    (file) =>
      (file.status === 'ready' ||
        file.status === 'type_conflict' ||
        (file.status === 'missing_sheet' && overrides[file.relativePath])) &&
      !unchecked.includes(file.relativePath)
  );
  const willCreate =
    effectiveMode === 'excel_per_sheet'
      ? checkedSheets.length
      : effectiveMode === 'folder_per_file'
        ? perFileFiles.length
        : 1;

  const buildInput = (): DataCreateRawSourceInput | null => {
    if (!effectiveMode || !path) return null;
    const base = { sourcePath: path, buildMode: effectiveMode, autoInclude };
    switch (effectiveMode) {
      case 'single':
        return { ...base, tableName: names.__single || fileStem };
      case 'excel_single':
        return singleSheet
          ? {
              ...base,
              members: [
                {
                  key: singleSheet,
                  name: names[singleSheet] || fileStem,
                  headerRow: headerRows[singleSheet],
                },
              ],
              fieldStrategy: fieldAllText ? 'all_text' : 'auto',
              ...(password ? { password } : {}),
            }
          : null;
      case 'excel_per_sheet':
        return checkedSheets.length
          ? {
              ...base,
              sheets: checkedSheets,
              members: checkedSheets.map((key) => ({
                key,
                name: names[key] || `${fileStem} / ${key}`,
                headerRow: headerRows[key],
              })),
              fieldStrategy: fieldAllText ? 'all_text' : 'auto',
              ...(password ? { password } : {}),
            }
          : null;
      case 'excel_merge_sheets':
        return {
          ...base,
          sheets: checkedSheets,
          tableName: mergedName,
          fieldStrategy: fieldAllText ? 'all_text' : 'auto',
          ...(password ? { password } : {}),
        };
      case 'folder_merge':
        return {
          ...base,
          sheetSelector: selector,
          fileRange,
          tableName: mergedName,
          excludedFiles: unchecked,
          recursive,
          sortBy,
          schemaStrategy,
          sheetStrategy: sheetAll ? 'all' : 'selector',
          headerMode: folderHeaderMode,
          headerRow: folderHeaderRow,
          fieldStrategy: fieldAllText ? 'all_text' : 'auto',
          systemFields,
          ...(password ? { password } : {}),
        };
      case 'folder_per_file':
        return perFileFiles.length
          ? {
              ...base,
              sheetSelector: selector,
              fileRange,
              fileSheetOverrides: overrides,
              excludedFiles: unchecked,
              members: perFileFiles.map((file) => ({
                key: file.relativePath,
                name: names[file.relativePath] || `${fileStem} / ${stemOf(file.relativePath)}`,
                sheetName: overrides[file.relativePath],
              })),
            }
          : null;
      case 'cloud_table':
        return null;
    }
  };

  const create = async (confirmed = false) => {
    const input = buildInput();
    if (!input) return;
    setError(null);
    if (rebuild && !confirmed) {
      try {
        setImpact(await dataClient.getRawSourceRebuildImpact(rebuild.source.id));
      } catch (err) {
        setError(formatDataErrorMessage(err, t));
      }
      return;
    }
    setCreating(true);
    try {
      const created = rebuild
        ? await dataClient.rebuildRawSource({
            ...input,
            sourceId: rebuild.source.id,
            name: rebuild.source.name,
            confirmDeleteExistingTables: true,
          })
        : await dataClient.createRawSource({ ...input, name: sourceName });
      setImpact(null);
      setResult(created);
      if (!embedded) setStep(4);
      onCreated?.(created);
    } catch (err) {
      setImpact(null);
      setError(formatDataErrorMessage(err, t));
    } finally {
      setCreating(false);
    }
  };

  const isFolder = scan?.kind === 'folder' || rebuild?.source.sourceKind === 'folder';
  const stepLabels = [
    tr('steps.source'),
    tr('steps.mode'),
    tr('steps.configure'),
    tr('steps.done'),
  ];
  const createLabel = rebuild
    ? tr('rebuild.confirm')
    : effectiveMode === 'excel_per_sheet' || effectiveMode === 'folder_per_file'
      ? tr('excel.createMany', { count: willCreate })
      : effectiveMode === 'excel_merge_sheets'
        ? tr('excel.createMerged')
        : tr('excel.create');
  const canCreate =
    !!buildInput() &&
    !creating &&
    !scanning &&
    (effectiveMode !== 'folder_merge' || (scan?.merge?.fileCount ?? 0) > 0);

  function configBody() {
    if (!scan) return null;
    return (
      <>
        {scan.kind === 'csv' && (
          <section className={groupClass}>
            <div className="ui-group-title">{tr('config.tableGroup')}</div>
            <div className="ui-form-row">
              <div className="ui-form-label items-center">{tr('excel.tableName')}</div>
              <div className="ui-form-value">
                <input
                  value={names.__single ?? fileStem}
                  onChange={(event) => setNames({ ...names, __single: event.target.value })}
                  className={cellInputClass}
                  data-testid="raw-source-table-name"
                />
              </div>
            </div>
          </section>
        )}
        {scan.kind === 'excel' && (
          <SheetConfigurator
            tr={tr}
            scan={scan}
            multi={effectiveMode !== 'excel_single'}
            singleSheet={singleSheet}
            setSingleSheet={setSingleSheet}
            checked={checkedSheets}
            setChecked={setChecked}
            names={names}
            setNames={setNames}
            headerRows={headerRows}
            setHeaderRows={setHeaderRows}
            fileStem={fileStem}
            mergeSheets={mergeSheets}
            setMergeSheets={setMergeSheets}
            mergeable={mergeable}
            mergedName={mergedName}
            setMergedName={setMergedName}
            autoInclude={autoInclude}
            setAutoInclude={setAutoInclude}
          />
        )}
        {scan.kind === 'excel' && (
          <ImportOptionsPanel
            tr={tr}
            kind="excel"
            recursive={recursive}
            setRecursive={setRecursive}
            sortBy={sortBy}
            setSortBy={setSortBy}
            schemaStrategy={schemaStrategy}
            setSchemaStrategy={setSchemaStrategy}
            sheetAll={sheetAll}
            setSheetAll={setSheetAll}
            fieldAllText={fieldAllText}
            setFieldAllText={setFieldAllText}
            systemFields={systemFields}
            setSystemFields={setSystemFields}
            folderHeaderMode={folderHeaderMode}
            setFolderHeaderMode={setFolderHeaderMode}
            folderHeaderRow={folderHeaderRow}
            setFolderHeaderRow={setFolderHeaderRow}
            password={password}
            setPassword={setPassword}
          />
        )}
        {scan.kind === 'folder' && (
          <section className={groupClass}>
            <div className="ui-group-title">{tr('config.importGroup')}</div>
            <SheetStrategyRow
              tr={tr}
              files={files}
              by={selectorBy}
              setBy={setSelectorBy}
              name={selectorName}
              setName={setSelectorName}
              index={selectorIndex}
              setIndex={setSelectorIndex}
            />
            <div className="ui-form-row">
              <div className="ui-form-label items-center">{tr('mode.fileType')}</div>
              <div className="ui-form-value !flex-row items-stretch">
                <select
                  value={fileRange}
                  onChange={(event) => setFileRange(event.target.value as FileRange)}
                  className={`${cellSelectClass} w-[220px] flex-none`}
                  style={{ backgroundImage: SELECT_CHEVRON }}
                  data-testid="raw-source-file-range"
                >
                  {(['excel_csv', 'excel', 'csv'] as const).map((value) => (
                    <option key={value} value={value}>
                      {tr(`mode.fileRange.${value}`)}
                    </option>
                  ))}
                </select>
                {effectiveMode === 'folder_per_file' && (
                  <div className="ml-auto flex items-center px-2.5">
                    <Toggle
                      on={autoInclude}
                      onChange={setAutoInclude}
                      label={tr('mode.autoIncludeFiles')}
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-3 border-t border-border-subtle p-2">
              {effectiveMode === 'folder_merge' ? (
                <>
                  <FolderMergeTable
                    tr={tr}
                    scan={scan}
                    mergedName={mergedName}
                    setMergedName={setMergedName}
                  />
                  <ImportOptionsPanel
                    tr={tr}
                    kind="folder"
                    recursive={recursive}
                    setRecursive={setRecursive}
                    sortBy={sortBy}
                    setSortBy={setSortBy}
                    schemaStrategy={schemaStrategy}
                    setSchemaStrategy={setSchemaStrategy}
                    sheetAll={sheetAll}
                    setSheetAll={setSheetAll}
                    fieldAllText={fieldAllText}
                    setFieldAllText={setFieldAllText}
                    systemFields={systemFields}
                    setSystemFields={setSystemFields}
                    folderHeaderMode={folderHeaderMode}
                    setFolderHeaderMode={setFolderHeaderMode}
                    folderHeaderRow={folderHeaderRow}
                    setFolderHeaderRow={setFolderHeaderRow}
                    password={password}
                    setPassword={setPassword}
                  />
                </>
              ) : (
                <FolderPerFileTable
                  tr={tr}
                  files={files}
                  fileStem={fileStem}
                  names={names}
                  setNames={setNames}
                  overrides={overrides}
                  setOverrides={setOverrides}
                  unchecked={unchecked}
                  setUnchecked={setUnchecked}
                  willCreate={willCreate}
                />
              )}
            </div>
          </section>
        )}
      </>
    );
  }

  const createRef = useRef(create);
  createRef.current = create;
  const save = useCallback(() => void createRef.current(), []);
  useEffect(() => {
    onControls?.({ canSave: canCreate, saving: creating, save });
  }, [canCreate, creating, onControls, save]);

  if (embedded) {
    return (
      <div className="flex min-h-0 flex-col" data-testid="raw-source-mode-editor">
        {error && (
          <div
            className="mb-2 rounded-md bg-error/[0.08] px-3 py-2 text-[12.5px] text-error"
            data-testid="raw-source-error"
          >
            {error}
          </div>
        )}
        {!scan ? (
          <div className="px-3 py-4 text-[12.5px] text-text-muted">{tr('source.scanning')}</div>
        ) : (
          configBody()
        )}
        {rebuild && impact && (
          <RebuildConfirmDialog
            open
            sourceName={rebuild.source.name}
            fromMode={tr(`modes.${rebuild.source.buildMode}`)}
            toMode={tr(`modes.${effectiveMode ?? rebuild.buildMode}`)}
            impact={impact}
            busy={creating}
            onCancel={() => setImpact(null)}
            onConfirm={() => void create(true)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="raw-source-wizard">
      {step === 3 && scan ? (
        <ConfigTitleBar
          tr={tr}
          name={sourceName}
          createLabel={createLabel}
          canCreate={canCreate}
          danger={!!rebuild}
          onBack={
            rebuild
              ? onBack
              : () =>
                  setStep(
                    scan.kind === 'csv'
                      ? 1
                      : scan.kind === 'folder' || scan.sheets.length > 1
                        ? 2
                        : 1
                  )
          }
          onCreate={() => void create()}
          onRechooseMode={
            !rebuild && scan.kind !== 'csv' && (scan.kind === 'folder' || scan.sheets.length > 1)
              ? () => setStep(2)
              : undefined
          }
        />
      ) : (
        <div className="flex h-11 flex-shrink-0 items-center gap-3 border-b border-border-subtle px-4">
          <button type="button" className={secondaryButton} onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" />
            {tr('back')}
          </button>
          <span className="text-[14px] font-medium text-text-primary">
            {rebuild ? rebuild.source.name : tr('newTitle')}
          </span>
          <div className="ml-auto flex items-center gap-2 text-[12.5px]">
            {stepLabels.map((label, index) => {
              const n = (index + 1) as Step;
              const state = n < step ? 'done' : n === step ? 'current' : 'todo';
              return (
                <span key={label} className="flex items-center gap-1.5">
                  {index > 0 && <span className="h-px w-5 bg-border-subtle" />}
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                      state === 'todo'
                        ? 'border border-border-subtle text-text-muted'
                        : 'bg-accent text-accent-foreground'
                    }`}
                  >
                    {state === 'done' ? <Check className="h-3 w-3" /> : n}
                  </span>
                  <span className={state === 'current' ? 'text-text-primary' : 'text-text-muted'}>
                    {label}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      )}
      {error && step !== 3 && (
        <div
          className="mx-4 mt-3 rounded-md bg-error/[0.08] px-3 py-2 text-[12.5px] text-error"
          data-testid="raw-source-error"
        >
          {error}
        </div>
      )}
      {step === 1 && (
        <div className={panelClass}>
          <div className="mx-auto w-full max-w-3xl px-6 py-8">
            <div className="mb-4 text-[15px] font-medium text-text-primary">
              {tr('source.question')}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <SourceCard
                icon={<FileSpreadsheet className="h-5 w-5" />}
                title={tr('source.file')}
                desc={tr('source.fileDesc')}
                ext={tr('source.fileExt')}
                action={tr('source.pick')}
                onClick={() => void pick('excel')}
                testId="raw-source-pick-file"
              />
              <SourceCard
                icon={<Folder className="h-5 w-5" />}
                title={tr('source.folder')}
                desc={tr('source.folderDesc')}
                ext={tr('source.folderExt')}
                action={tr('source.pickFolder')}
                onClick={() => void pick('folder')}
                testId="raw-source-pick-folder"
              />
              <SourceCard
                icon={<CloudDownload className="h-5 w-5" />}
                title={tr('source.cloud')}
                desc={tr('source.cloudDesc')}
                ext={tr('source.cloudExt')}
                action={tr('source.cloud')}
                onClick={onOpenCloud}
                testId="raw-source-pick-cloud"
              />
            </div>
            <input
              className="mt-4 h-9 w-full rounded-md border border-border-subtle bg-surface px-3 text-[13px]"
              placeholder={tr('source.pathPlaceholder')}
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && pathInput.trim()) void runScan(pathInput.trim());
              }}
              data-testid="raw-source-path-input"
            />
            {scanning && (
              <div className="mt-3 text-[12.5px] text-text-muted">{tr('source.scanning')}</div>
            )}
          </div>
        </div>
      )}
      {step === 2 && scan && (
        <div className={panelClass}>
          <div className="mx-auto w-full max-w-3xl px-6 py-6">
            <SourceSummary scan={scan} tr={tr} onChange={() => setStep(1)} />
            <div className="mb-3 mt-5 text-[15px] font-medium text-text-primary">
              {scan.kind === 'excel'
                ? tr('mode.excelQuestion', { count: scan.sheets.length })
                : tr('mode.folderQuestion', { count: scan.files.length })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(scan.kind === 'excel'
                ? [
                    ['excel_single', tr('mode.excelSingle'), tr('mode.excelSingleDesc')],
                    ['excel_per_sheet', tr('mode.excelMulti'), tr('mode.excelMultiDesc')],
                  ]
                : [
                    ['folder_merge', tr('mode.folderMerge'), tr('mode.folderMergeDesc')],
                    ['folder_per_file', tr('mode.folderPerFile'), tr('mode.folderPerFileDesc')],
                  ]
              ).map(([value, title, desc]) => {
                const active =
                  value === 'excel_per_sheet'
                    ? mode === 'excel_per_sheet' || mode === 'excel_merge_sheets'
                    : mode === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMode(value as DataRawSourceBuildMode)}
                    data-testid={`raw-source-mode-${value}`}
                    className={`rounded-lg border p-4 text-left ${
                      active ? 'border-accent bg-accent/[0.06]' : 'border-border-subtle'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-[13.5px] font-medium text-text-primary">
                      {value.includes('merge') ? (
                        <Layers className="h-4 w-4" />
                      ) : (
                        <Table2 className="h-4 w-4" />
                      )}
                      {title}
                    </div>
                    <div className="mt-1.5 text-[12.5px] leading-5 text-text-secondary">{desc}</div>
                  </button>
                );
              })}
            </div>
            {scan.kind === 'excel' && (
              <div className="mt-3 text-[12.5px] text-text-muted">{tr('mode.excelHint')}</div>
            )}
          </div>
        </div>
      )}
      {step === 3 && scan && (
        <div
          className="flex min-h-0 flex-1 flex-col overflow-auto bg-surface p-2"
          data-testid="raw-source-config"
        >
          {error && (
            <div
              className="mb-2 rounded-md bg-error/[0.08] px-3 py-2 text-[12.5px] text-error"
              data-testid="raw-source-error"
            >
              {error}
            </div>
          )}
          <SourceGroup
            tr={tr}
            scan={scan}
            scannedAt={scannedAt}
            onChange={rebuild ? undefined : () => setStep(1)}
          />
          {configBody()}
        </div>
      )}
      {step === 3 && scan && <ConfigTabBar tr={tr} />}
      {step === 4 && result && (
        <DoneStep
          tr={tr}
          result={result}
          isFolder={!!isFolder}
          onOpenData={onOpenData}
          onCreatePipeline={onCreatePipeline}
        />
      )}
      {step === 2 && (
        <div className={footerClass}>
          <span className="ml-auto" />
          {!rebuild && (
            <button type="button" className={secondaryButton} onClick={() => setStep(1)}>
              <ArrowLeft className="h-3.5 w-3.5" />
              {tr('back')}
            </button>
          )}
          <button
            type="button"
            className={primaryButton}
            disabled={!mode}
            onClick={() => setStep(3)}
            data-testid="raw-source-next"
          >
            {tr('steps.configure')}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {rebuild && impact && (
        <RebuildConfirmDialog
          open
          sourceName={rebuild.source.name}
          fromMode={tr(`modes.${rebuild.source.buildMode}`)}
          toMode={tr(`modes.${effectiveMode ?? rebuild.buildMode}`)}
          impact={impact}
          busy={creating}
          onCancel={() => setImpact(null)}
          onConfirm={() => void create(true)}
        />
      )}
    </div>
  );
}
