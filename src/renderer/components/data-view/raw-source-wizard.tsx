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
  Layers,
  Minus,
  Plus,
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
const dangerButton =
  'inline-flex h-8 items-center gap-1.5 rounded-md bg-error px-3 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-3 text-[13px] text-text-primary hover:bg-surface-hover disabled:opacity-50';

export function RawSourceWizard({
  onBack,
  onOpenData,
  onOpenCloud,
  onCreated,
  onCreatePipeline,
  rebuild,
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
      setStep(4);
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

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="raw-source-wizard">
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
      {error && (
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
        <div className={panelClass}>
          <div className="mx-auto w-full max-w-4xl px-6 py-5">
            <SourceSummary scan={scan} tr={tr} onChange={rebuild ? undefined : () => setStep(1)} />
            {scan.kind === 'csv' && (
              <div className="mt-4">
                <div className="text-[12.5px] text-text-muted">{tr('csv.hint')}</div>
                <NameField
                  label={tr('excel.tableName')}
                  value={names.__single ?? fileStem}
                  onChange={(value) => setNames({ ...names, __single: value })}
                />
              </div>
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
              <div className="mt-4 flex flex-col gap-3">
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
                <div className="flex items-center gap-3 text-[12.5px] text-text-secondary">
                  <span>{tr('mode.fileType')}</span>
                  <select
                    value={fileRange}
                    onChange={(event) => setFileRange(event.target.value as FileRange)}
                    className="h-7 rounded-md border border-border-subtle bg-surface px-2"
                  >
                    {(['excel_csv', 'excel', 'csv'] as const).map((value) => (
                      <option key={value} value={value}>
                        {tr(`mode.fileRange.${value}`)}
                      </option>
                    ))}
                  </select>
                  <span className="ml-auto" />
                  {effectiveMode === 'folder_per_file' && (
                    <Toggle
                      on={autoInclude}
                      onChange={setAutoInclude}
                      label={tr('mode.autoIncludeFiles')}
                    />
                  )}
                </div>
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
            )}
            <div className="mt-4 text-[12.5px] text-text-muted">
              {willCreate > 1 ? tr('excel.afterCreateHintMany') : tr('excel.afterCreateHint')}
            </div>
          </div>
        </div>
      )}
      {step === 4 && result && (
        <DoneStep
          tr={tr}
          result={result}
          isFolder={!!isFolder}
          onOpenData={onOpenData}
          onCreatePipeline={onCreatePipeline}
        />
      )}
      {(step === 2 || step === 3) && (
        <div className={footerClass}>
          {step === 3 && (
            <span className="text-[12.5px] text-text-muted">
              {tr('excel.willCreate', { count: willCreate })}
            </span>
          )}
          <span className="ml-auto" />
          {!rebuild && (
            <button
              type="button"
              className={secondaryButton}
              onClick={() =>
                setStep(
                  step === 3 &&
                    scan?.kind !== 'csv' &&
                    (scan?.kind === 'folder' || (scan?.sheets.length ?? 0) > 1)
                    ? 2
                    : 1
                )
              }
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {tr('back')}
            </button>
          )}
          {step === 2 ? (
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
          ) : (
            <button
              type="button"
              className={rebuild ? dangerButton : primaryButton}
              disabled={!canCreate}
              onClick={() => void create()}
              data-testid="raw-source-create"
            >
              {createLabel}
            </button>
          )}
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

function HeaderRowSelect({
  tr,
  value,
  onChange,
}: {
  tr: Tr;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value ? Number(event.target.value) : undefined)}
      className="h-7 rounded-md border border-border-subtle bg-surface px-2 text-[12.5px]"
    >
      <option value="">{tr('excel.headerAuto')}</option>
      {[1, 2, 3, 4, 5].map((row) => (
        <option key={row} value={row}>
          {tr('excel.headerManual', { row })}
        </option>
      ))}
    </select>
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
  return (
    <div className="mt-4 grid grid-cols-[15rem_1fr] gap-4">
      <div className="rounded-lg border border-border-subtle" data-testid="raw-source-sheet-list">
        <div className="flex h-9 items-center border-b border-border-subtle px-3 text-[12.5px] text-text-muted">
          {multi ? tr('excel.pickMany') : tr('excel.pickOne')}
          {multi && (
            <>
              <span className="ml-2">
                {tr('excel.selected', { selected: checked.length, total: scan.sheets.length })}
              </span>
              <button
                type="button"
                className="ml-auto text-accent"
                onClick={() =>
                  props.setChecked(scan.sheets.filter((s) => !s.empty).map((s) => s.name))
                }
              >
                {tr('excel.selectAll')}
              </button>
            </>
          )}
        </div>
        {scan.sheets.map((sheet) => {
          const active = multi ? checked.includes(sheet.name) : props.singleSheet === sheet.name;
          return (
            <label
              key={sheet.name}
              className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] ${active ? 'bg-accent/[0.06]' : ''} ${sheet.empty ? 'opacity-50' : ''}`}
            >
              <input
                type={multi ? 'checkbox' : 'radio'}
                checked={active}
                disabled={sheet.empty}
                onChange={() => (multi ? toggle(sheet.name) : props.setSingleSheet(sheet.name))}
                data-testid={`raw-source-sheet-${sheet.name}`}
              />
              <span className="min-w-0 flex-1 truncate text-text-primary">{sheet.name}</span>
              <span className="text-[11.5px] text-text-muted">
                {sheet.empty
                  ? tr('excel.sheetEmpty', { rows: sheet.rowCount })
                  : tr('excel.sheetMeta', { rows: sheet.rowCount, cols: sheet.columnCount })}
              </span>
            </label>
          );
        })}
      </div>
      <div className="min-w-0">
        {multi && (
          <div className="mb-3 flex flex-wrap items-center gap-4">
            <Toggle
              on={merged}
              disabled={!props.mergeable}
              onChange={props.setMergeSheets}
              label={tr('excel.mergeToggle')}
              testId="raw-source-merge-sheets"
            />
            <span className="text-[12px] text-text-muted">
              {checked.length < 2
                ? tr('excel.mergeNeedTwo')
                : !props.mergeable
                  ? tr('excel.mergeDisabled')
                  : merged
                    ? tr('excel.mergeOn')
                    : ''}
            </span>
            <span className="ml-auto" />
            {!merged && (
              <Toggle
                on={props.autoInclude}
                onChange={props.setAutoInclude}
                label={tr('excel.autoIncludeSheets')}
              />
            )}
          </div>
        )}
        {!multi && props.singleSheet && (
          <SheetDetail {...props} sheetName={props.singleSheet} defaultName={props.fileStem} />
        )}
        {merged && (
          <NameField
            label={tr('excel.tableName')}
            value={props.mergedName}
            onChange={props.setMergedName}
            testId="raw-source-merged-name"
          />
        )}
        {multi && !merged && (
          <table className="w-full border-collapse text-left text-[12.5px]">
            <thead>
              <tr className="h-8 border-b border-border-subtle text-text-muted">
                <th className="px-2 font-medium">{tr('folder.colSheet')}</th>
                <th className="px-2 font-medium">{tr('excel.tableName')}</th>
                <th className="px-2 font-medium">{tr('excel.headerRow')}</th>
                <th className="px-2 text-right font-medium">{tr('excel.size')}</th>
              </tr>
            </thead>
            <tbody>
              {checked.map((name) => {
                const sheet = scan.sheets.find((s) => s.name === name)!;
                return (
                  <tr key={name} className="h-9 border-b border-dashed border-border-muted">
                    <td className="px-2 text-text-primary">{name}</td>
                    <td className="px-2">
                      <input
                        value={props.names[name] ?? `${props.fileStem} / ${name}`}
                        onChange={(event) =>
                          props.setNames({ ...props.names, [name]: event.target.value })
                        }
                        className="h-7 w-full rounded-md border border-border-subtle bg-surface px-2"
                      />
                    </td>
                    <td className="px-2">
                      <HeaderRowSelect
                        tr={tr}
                        value={props.headerRows[name]}
                        onChange={(value) =>
                          props.setHeaderRows({ ...props.headerRows, [name]: value })
                        }
                      />
                    </td>
                    <td className="px-2 text-right tabular-nums text-text-muted">
                      {tr('excel.sizeValue', { rows: sheet.rowCount, cols: sheet.columnCount })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SheetDetail(props: {
  tr: Tr;
  scan: DataRawSourceScan;
  sheetName: string;
  defaultName: string;
  names: Record<string, string>;
  setNames: (names: Record<string, string>) => void;
  headerRows: Record<string, number | undefined>;
  setHeaderRows: (rows: Record<string, number | undefined>) => void;
}) {
  const { tr, sheetName } = props;
  const sheet = props.scan.sheets.find((s) => s.name === sheetName);
  if (!sheet) return null;
  return (
    <div className="rounded-lg border border-border-subtle p-4">
      <NameField
        label={tr('excel.tableName')}
        value={props.names[sheetName] ?? props.defaultName}
        onChange={(value) => props.setNames({ ...props.names, [sheetName]: value })}
        testId="raw-source-table-name"
      />
      <div className="mt-3 flex items-center gap-3 text-[12.5px] text-text-secondary">
        <span className="w-20">{tr('excel.headerRow')}</span>
        <HeaderRowSelect
          tr={tr}
          value={props.headerRows[sheetName]}
          onChange={(value) => props.setHeaderRows({ ...props.headerRows, [sheetName]: value })}
        />
      </div>
      <div className="mt-3 flex items-center gap-3 text-[12.5px] text-text-secondary">
        <span className="w-20">{tr('excel.size')}</span>
        <span className="text-text-primary">
          {tr('excel.sizeValue', { rows: sheet.rowCount, cols: sheet.columnCount })}
        </span>
      </div>
      <div className="mt-3 flex items-start gap-3 text-[12.5px] text-text-secondary">
        <span className="w-20 flex-shrink-0">{tr('excel.columns')}</span>
        <span className="flex flex-wrap gap-1">
          {sheet.columns.map((column) => (
            <span key={column} className="rounded bg-surface-hover px-1.5 py-0.5 text-text-primary">
              {column}
            </span>
          ))}
        </span>
      </div>
    </div>
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
    <div
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle px-4 py-2.5 text-[12.5px]"
      data-testid="raw-source-sheet-strategy"
    >
      <span className="font-medium text-text-primary">{tr('folder.strategy')}</span>
      <label className="flex items-center gap-1.5">
        <input
          type="radio"
          checked={by === 'name'}
          onChange={() => props.setBy('name')}
          data-testid="raw-source-selector-by-name"
        />
        {tr('folder.byName')}
      </label>
      <input
        value={props.name}
        disabled={by !== 'name'}
        placeholder={tr('folder.namePlaceholder')}
        onChange={(event) => props.setName(event.target.value)}
        data-testid="raw-source-selector-name"
        className="h-7 w-28 rounded-md border border-border-subtle bg-surface px-2 disabled:opacity-50"
      />
      <label className="ml-2 flex items-center gap-1.5">
        <input
          type="radio"
          checked={by === 'index'}
          onChange={() => props.setBy('index')}
          data-testid="raw-source-selector-by-index"
        />
        {tr('folder.byIndex')}
      </label>
      <span
        className={`inline-flex h-7 items-center rounded-md border border-border-subtle ${by !== 'index' ? 'opacity-50' : ''}`}
      >
        <button
          type="button"
          disabled={by !== 'index' || props.index <= 1}
          onClick={() => props.setIndex(Math.max(1, props.index - 1))}
          className="px-1.5 disabled:opacity-40"
          aria-label="-"
        >
          <Minus className="h-3 w-3" />
        </button>
        <input
          value={props.index}
          disabled={by !== 'index'}
          inputMode="numeric"
          onChange={(event) => {
            const value = Number.parseInt(event.target.value.replace(/\D/g, ''), 10);
            props.setIndex(Number.isFinite(value) && value >= 1 ? value : 1);
          }}
          data-testid="raw-source-selector-index"
          className="h-6 w-8 bg-transparent text-center tabular-nums"
        />
        <button
          type="button"
          disabled={by !== 'index'}
          onClick={() => props.setIndex(props.index + 1)}
          className="px-1.5"
          aria-label="+"
        >
          <Plus className="h-3 w-3" />
        </button>
      </span>
      <span className="text-[11.5px] text-text-muted">{tr('folder.minOne')}</span>
      <span className={`ml-auto ${missing.length ? 'text-warning' : 'text-success'}`}>
        {tr('folder.matchSummary', { ready: ready.length, missing: missing.length })}
      </span>
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
