/**
 * Raw-table source wizard (1:N): 1 choose source → 2 build mode → 3 select & configure → 4 done.
 * Config pages show no data preview; the done step opens the created table's Data tab.
 * In rebuild mode (changing a source's build mode) the final step asks for an explicit
 * confirmation before the existing tables are deleted and recreated.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CloudDownload,
  FileSpreadsheet,
  Folder,
  Info,
  Layers,
  Minus,
  Plus,
  RefreshCw,
  Table2,
} from 'lucide-react';
import type {
  DataCreateRawSourceInput,
  DataRawFolderMergeReport,
  DataRawSheetSelector,
  DataRawSource,
  DataRawSourceBuildMode,
  DataRawSourceCreateResult,
  DataRawSourceFileScan,
  DataRawSourceRebuildImpact,
  DataRawSourceScan,
} from '../../types';
import { dataClient } from '../../features/data/api/data-client';
import { formatDataErrorMessage } from '../../features/data/model/errors';
import { RebuildConfirmDialog } from './raw-source-rebuild-dialog';
import {
  bottomTabBarClass,
  bottomTabListClass,
  bottomTabTriggerClass,
  DataMoreMenu,
  RawTableStatusBadge,
} from './shared';

type Step = 1 | 2 | 3 | 4;
type FileRange = 'excel_csv' | 'excel' | 'csv';
type Tr = (key: string, options?: Record<string, unknown>) => string;

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

export function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function sameColumns(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((column, index) => column === b[index]);
}

const panelClass = 'flex min-h-0 flex-1 flex-col overflow-auto bg-surface';
const footerClass =
  'flex h-[3.25rem] flex-shrink-0 items-center gap-3 border-t border-border-subtle bg-surface px-4';
const primaryButton =
  'inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-3 text-[13px] text-text-primary hover:bg-surface-hover disabled:opacity-50';

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
          setMergedName(`${stemOf(next.name)}（合并）`);
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
    setMergedName((current) => current || `${stemOf(scan.name)}（合并）`);
  }, [rebuild, scan]);

  useEffect(() => {
    if (!rebuild || !scan || scan.kind !== 'excel') return;
    setChecked((current) =>
      current.length ? current : scan.sheets.filter((s) => !s.empty).map((s) => s.name)
    );
    setSingleSheet((current) => current ?? scan.sheets.find((s) => !s.empty)?.name ?? null);
    setMergedName((current) => current || `${stemOf(scan.name)}（合并）`);
  }, [rebuild, scan]);

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
      sameColumns(sheetByName.get(name)!.columns, sheetByName.get(checkedSheets[0])!.columns)
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
            }
          : null;
      case 'excel_merge_sheets':
        return { ...base, sheets: checkedSheets, tableName: mergedName };
      case 'folder_merge':
        return {
          ...base,
          sheetSelector: selector,
          fileRange,
          tableName: mergedName,
          excludedFiles: unchecked,
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
                <FolderMergeTable
                  tr={tr}
                  scan={scan}
                  mergedName={mergedName}
                  setMergedName={setMergedName}
                />
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

function SourceCard(props: {
  icon: ReactNode;
  title: string;
  desc: string;
  ext: string;
  action: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      data-testid={props.testId}
      className="flex flex-col gap-2 rounded-lg border border-border-subtle p-4 text-left hover:border-accent"
    >
      <span className="text-accent">{props.icon}</span>
      <span className="text-[13.5px] font-medium text-text-primary">{props.title}</span>
      <span className="text-[12.5px] leading-5 text-text-secondary">{props.desc}</span>
      <span className="text-[11.5px] text-text-muted">{props.ext}</span>
      <span className="mt-1 text-[12.5px] text-accent">{props.action}</span>
    </button>
  );
}

/** Config page (design raw_sheetcfg_v1): full-width groups in an 8px-padded content area. */
export const groupClass = 'ui-group ui-form-flush !mx-0 !mb-2 !mt-0 bg-surface';
/** Borderless control filling its table / form cell; focus draws an inner outline. */
const cellInputClass =
  'h-full min-h-[35px] w-full border-0 bg-transparent px-2.5 text-[12.5px] text-text-primary outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-accent)] disabled:text-text-muted';
export const cellSelectClass = `${'h-full min-h-[35px] border-0 bg-transparent px-2.5 text-[12.5px] text-text-primary outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-accent)]'} cursor-pointer appearance-none bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-7 hover:bg-surface-hover`;
export const titleCellClass =
  'inline-flex h-full items-center justify-center gap-1.5 whitespace-nowrap border-l border-border-subtle px-4 text-xs font-medium transition-colors hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50';

function ConfigTitleBar(props: {
  tr: Tr;
  name: string;
  createLabel: string;
  canCreate: boolean;
  danger: boolean;
  onBack: () => void;
  onCreate: () => void;
  onRechooseMode?: () => void;
}) {
  const { tr } = props;
  return (
    <div className="flex h-12 flex-shrink-0 items-stretch justify-between border-b border-border-subtle">
      <div className="flex min-w-0 items-stretch">
        <button
          type="button"
          onClick={props.onBack}
          className="inline-flex w-[104px] flex-shrink-0 items-center justify-center gap-1.5 border-r border-border-subtle text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {tr('back')}
        </button>
        <div className="flex min-w-0 items-center gap-2 border-r border-border-subtle px-3">
          <RawTableStatusBadge label={tr('config.pending')} tone="warning" />
          <span
            className="truncate text-[14px] font-semibold text-text-primary"
            title={props.name}
            data-testid="raw-source-config-name"
          >
            {props.name}
          </span>
        </div>
      </div>
      <div className="flex items-stretch">
        <button
          type="button"
          disabled={!props.canCreate}
          onClick={props.onCreate}
          data-testid="raw-source-create"
          className={`${titleCellClass} ${props.danger ? 'text-error hover:bg-error/[0.08]' : 'text-accent'}`}
        >
          <Check className="h-3.5 w-3.5" />
          {props.createLabel}
        </button>
        <DataMoreMenu
          items={
            props.onRechooseMode
              ? [
                  {
                    key: 'mode',
                    label: tr('config.rechooseMode'),
                    icon: <Layers className="h-3.5 w-3.5" />,
                    onClick: props.onRechooseMode,
                  },
                ]
              : []
          }
        />
      </div>
    </div>
  );
}

function ConfigTabBar({ tr }: { tr: Tr }) {
  const tabs: Array<[string, boolean]> = [
    [tr('config.tabConfig'), true],
    [tr('config.tabData'), false],
    [tr('config.tabAutomation'), false],
  ];
  return (
    <div className={`${bottomTabBarClass} justify-between`} data-testid="raw-source-config-tabs">
      <div className={bottomTabListClass} role="tablist">
        {tabs.map(([label, active]) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={!active}
            data-state={active ? 'active' : 'inactive'}
            className={`${bottomTabTriggerClass} inline-flex items-center disabled:cursor-not-allowed disabled:opacity-45`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center px-4 text-xs text-text-muted">
        {tr('config.afterCreate')}
      </div>
    </div>
  );
}

export function formatScanTime(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function SourceGroup({
  tr,
  scan,
  scannedAt,
  onChange,
}: {
  tr: Tr;
  scan: DataRawSourceScan;
  scannedAt: number | null;
  onChange?: () => void;
}) {
  const isFolder = scan.kind === 'folder';
  return (
    <section className={groupClass} data-testid="raw-source-source-group">
      <div className="ui-group-title">{tr('config.sourceGroup')}</div>
      <div className="ui-form-row">
        <div className="ui-form-label items-center">
          {isFolder ? tr('config.folder') : tr('config.file')}
        </div>
        <div className="ui-form-value !flex-row items-stretch">
          <div className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
            {isFolder ? (
              <Folder className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
            ) : (
              <FileSpreadsheet className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
            )}
            <span
              className="truncate font-mono text-[12px] text-text-primary"
              title={scan.sourcePath}
            >
              {scan.sourcePath}
            </span>
          </div>
          {onChange && (
            <button
              type="button"
              onClick={onChange}
              className="ui-accent-cell w-[112px] flex-shrink-0 border-l border-border-subtle"
              data-testid="raw-source-change-file"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {isFolder ? tr('config.changeFolder') : tr('config.changeFile')}
            </button>
          )}
        </div>
      </div>
      <div className="ui-form-row">
        <div className="ui-form-label items-center">{tr('config.scanResult')}</div>
        <div className="ui-form-value">
          <div className="flex flex-1 items-center gap-1.5 px-2.5 text-[12.5px] text-text-primary">
            {isFolder
              ? tr('config.files', { count: scan.files.length })
              : scan.kind === 'excel'
                ? tr('config.sheets', { count: scan.sheets.length })
                : scan.name}
            {scannedAt !== null && (
              <span className="text-[12px] text-text-muted">
                {tr('config.scannedAt', { time: formatScanTime(scannedAt) })}
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function InfoTip({ label }: { label: string }) {
  return (
    <span className="group relative inline-flex" data-testid="raw-source-merge-reason">
      <button
        type="button"
        aria-label={label}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-text-muted hover:text-accent focus:outline-none"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <span className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-[#1f1f2b] px-2.5 py-1.5 text-[12px] text-white shadow-elevated group-hover:block group-focus-within:block">
        {label}
      </span>
    </span>
  );
}

function SheetConfigurator(props: {
  tr: Tr;
  scan: DataRawSourceScan;
  multi: boolean;
  singleSheet: string | null;
  setSingleSheet: (name: string) => void;
  checked: string[];
  setChecked: (names: string[]) => void;
  names: Record<string, string>;
  setNames: (names: Record<string, string>) => void;
  headerRows: Record<string, number | undefined>;
  setHeaderRows: (rows: Record<string, number | undefined>) => void;
  fileStem: string;
  mergeSheets: boolean;
  setMergeSheets: (on: boolean) => void;
  mergeable: boolean;
  mergedName: string;
  setMergedName: (name: string) => void;
  autoInclude: boolean;
  setAutoInclude: (on: boolean) => void;
}) {
  const { tr, scan, multi, checked } = props;
  const toggle = (name: string) =>
    props.setChecked(
      checked.includes(name) ? checked.filter((item) => item !== name) : [...checked, name]
    );
  const merged = multi && props.mergeSheets && props.mergeable;
  const selectable = scan.sheets.filter((s) => !s.empty).map((s) => s.name);
  const allChecked = selectable.length > 0 && selectable.every((name) => checked.includes(name));
  const mergeReason =
    checked.length < 2
      ? tr('excel.mergeNeedTwo')
      : !props.mergeable
        ? tr('excel.mergeDisabled')
        : '';
  const showName = !merged;
  return (
    <>
      {multi && (
        <section className={groupClass} data-testid="raw-source-import-group">
          <div className="ui-group-title">{tr('config.importGroup')}</div>
          <div className="ui-form-row">
            <div className="ui-form-label items-center">{tr('config.mergeRow')}</div>
            <div className="ui-form-value">
              <div className="flex flex-1 items-center gap-2 px-2.5">
                <Toggle
                  on={merged}
                  disabled={!props.mergeable}
                  onChange={props.setMergeSheets}
                  label={merged ? tr('config.on') : tr('config.off')}
                  testId="raw-source-merge-sheets"
                />
                {mergeReason ? <InfoTip label={mergeReason} /> : null}
                {merged && (
                  <span className="text-[12px] text-text-muted">{tr('excel.mergeOn')}</span>
                )}
              </div>
            </div>
          </div>
          {merged ? (
            <div className="ui-form-row">
              <div className="ui-form-label items-center">{tr('excel.tableName')}</div>
              <div className="ui-form-value">
                <input
                  value={props.mergedName}
                  onChange={(event) => props.setMergedName(event.target.value)}
                  className={cellInputClass}
                  data-testid="raw-source-merged-name"
                />
              </div>
            </div>
          ) : (
            <div className="ui-form-row">
              <div className="ui-form-label items-center">{tr('config.newSheetRow')}</div>
              <div className="ui-form-value">
                <div className="flex flex-1 items-center px-2.5">
                  <Toggle
                    on={props.autoInclude}
                    onChange={props.setAutoInclude}
                    label={tr('excel.autoIncludeSheets')}
                    testId="raw-source-auto-include"
                  />
                </div>
              </div>
            </div>
          )}
        </section>
      )}
      <section className={groupClass} data-testid="raw-source-sheet-list">
        <div className="ui-group-title gap-2">
          <span>{tr('config.sheetGroup')}</span>
          {multi ? (
            <>
              <span className="font-normal text-text-muted" data-testid="raw-source-selected-count">
                {tr('excel.selected', { selected: checked.length, total: scan.sheets.length })}
              </span>
              <button
                type="button"
                className="ml-auto font-normal text-accent"
                onClick={() => props.setChecked(selectable)}
              >
                {tr('config.selectAll')}
              </button>
            </>
          ) : (
            <span className="font-normal text-text-muted">{tr('excel.pickOne')}</span>
          )}
        </div>
        <table className="w-full table-fixed border-collapse text-left text-[12.5px]">
          <colgroup>
            <col className="w-9" />
            <col className="w-[28%]" />
            {showName && <col />}
            <col className="w-[26%]" />
            <col className="w-[92px]" />
          </colgroup>
          <thead>
            <tr className="h-8 border-b border-border-subtle bg-surface-muted text-[12px] text-text-secondary">
              <th className="border-r border-border-subtle text-center">
                {multi ? (
                  <input
                    type="checkbox"
                    aria-label={tr('config.selectAll')}
                    checked={allChecked}
                    onChange={() => props.setChecked(allChecked ? [] : selectable)}
                    data-testid="raw-source-sheet-all"
                    className="accent-[var(--color-accent)] align-middle"
                  />
                ) : null}
              </th>
              <th className="border-r border-border-subtle px-2.5 font-medium">
                {tr('folder.colSheet')}
              </th>
              {showName && (
                <th className="border-r border-border-subtle px-2.5 font-medium">
                  {tr('excel.tableName')}
                </th>
              )}
              <th className="border-r border-border-subtle px-2.5 font-medium">
                {tr('excel.headerRow')}
              </th>
              <th className="px-2.5 text-right font-medium">{tr('excel.size')}</th>
            </tr>
          </thead>
          <tbody>
            {scan.sheets.map((sheet) => {
              const active = multi
                ? checked.includes(sheet.name)
                : props.singleSheet === sheet.name;
              const defaultName = multi ? `${props.fileStem} / ${sheet.name}` : props.fileStem;
              return (
                <tr
                  key={sheet.name}
                  className={`h-9 border-b border-border-subtle last:border-b-0 ${active ? 'bg-accent/[0.04]' : ''} ${sheet.empty ? 'opacity-50' : ''}`}
                  data-testid={`raw-source-sheet-row-${sheet.name}`}
                >
                  <td className="border-r border-border-subtle text-center">
                    <input
                      type={multi ? 'checkbox' : 'radio'}
                      checked={active}
                      disabled={sheet.empty}
                      aria-label={sheet.name}
                      onChange={() =>
                        multi ? toggle(sheet.name) : props.setSingleSheet(sheet.name)
                      }
                      data-testid={`raw-source-sheet-${sheet.name}`}
                      className="accent-[var(--color-accent)] align-middle"
                    />
                  </td>
                  <td className="border-r border-border-subtle px-2.5">
                    <span className="flex min-w-0 items-center gap-1.5 text-text-primary">
                      <Table2 className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
                      <span className="truncate" title={sheet.name}>
                        {sheet.name}
                      </span>
                    </span>
                  </td>
                  {showName && (
                    <td className="border-r border-border-subtle p-0">
                      {active ? (
                        <input
                          value={props.names[sheet.name] ?? defaultName}
                          onChange={(event) =>
                            props.setNames({ ...props.names, [sheet.name]: event.target.value })
                          }
                          aria-label={tr('excel.tableName')}
                          className={cellInputClass}
                          data-testid={multi ? undefined : 'raw-source-table-name'}
                        />
                      ) : (
                        <span className="px-2.5 text-text-muted">—</span>
                      )}
                    </td>
                  )}
                  <td className="border-r border-border-subtle p-0">
                    <select
                      value={props.headerRows[sheet.name] ?? ''}
                      disabled={!active}
                      aria-label={tr('excel.headerRow')}
                      onChange={(event) =>
                        props.setHeaderRows({
                          ...props.headerRows,
                          [sheet.name]: event.target.value ? Number(event.target.value) : undefined,
                        })
                      }
                      className={`${cellInputClass} cursor-pointer appearance-none bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-7`}
                      style={{ backgroundImage: SELECT_CHEVRON }}
                    >
                      <option value="">{tr('excel.headerAuto')}</option>
                      {[1, 2, 3, 4, 5].map((row) => (
                        <option key={row} value={row}>
                          {tr('excel.headerManual', { row })}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2.5 text-right tabular-nums text-text-muted">
                    {sheet.empty
                      ? tr('excel.sheetEmpty', { rows: sheet.rowCount })
                      : tr('config.sizeCompact', { rows: sheet.rowCount, cols: sheet.columnCount })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

export const SELECT_CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

function SourceSummary({
  scan,
  tr,
  onChange,
}: {
  scan: DataRawSourceScan;
  tr: Tr;
  onChange?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-subtle px-4 py-3">
      {scan.kind === 'folder' ? (
        <Folder className="h-4 w-4 text-accent" />
      ) : (
        <FileSpreadsheet className="h-4 w-4 text-accent" />
      )}
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-text-primary">{scan.name}</div>
        <div className="truncate text-[11.5px] text-text-muted">{scan.sourcePath}</div>
      </div>
      <span className="ml-auto text-[12px] text-success">
        {scan.kind === 'folder'
          ? tr('mode.scanDoneFiles', { count: scan.files.length })
          : tr('mode.scanDoneSheets', { count: scan.sheets.length })}
      </span>
      {onChange && (
        <button type="button" className="text-[12.5px] text-accent" onClick={onChange}>
          {tr('mode.change')}
        </button>
      )}
    </div>
  );
}

function NameField({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId?: string;
}) {
  return (
    <label className="mt-3 flex items-center gap-3 text-[12.5px] text-text-secondary">
      <span className="w-20 flex-shrink-0">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
        className="h-8 flex-1 rounded-md border border-border-subtle bg-surface px-2.5 text-[13px] text-text-primary"
      />
    </label>
  );
}

export function Toggle({
  on,
  onChange,
  label,
  disabled,
  testId,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      data-testid={testId}
      className="inline-flex items-center gap-2 text-[12.5px] text-text-secondary disabled:opacity-50"
    >
      <span
        className={`relative h-4 w-7 rounded-full transition-colors ${on ? 'bg-accent' : 'border border-border bg-surface-active'}`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-soft transition-all ${on ? 'left-3.5' : 'left-0.5'}`}
        />
      </span>
      {label}
    </button>
  );
}

function SheetStrategyRow(props: {
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

function FolderMergeTable({
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

function FolderPerFileTable(props: {
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

function DoneStep({
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
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success text-white">
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
