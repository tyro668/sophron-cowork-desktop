/**
 * Modal for choosing raw / result tables to reference from 云连接.
 * Each side uses the reusable grouped tree so folder/source hierarchy is preserved.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, Search, Table2, X } from 'lucide-react';
import type {
  CloudConnectionGroup,
  DataGroup,
  DataRawSource,
  DataRawTable,
  DataResultTable,
} from '../../types';
import { dataClient } from '../../features/data/api/data-client';
import { errorText } from '../../features/cloud-connection/hooks/use-cloud-connection';
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle, cn } from '../ui';
import { ResultTableTree } from './result-table-tree';
import { RawTableTree, childDisplayName } from './raw-table-tree';
import { matchesSearchText } from './shared';

export type TableRefKind = 'raw' | 'result';

export interface TableRefPick {
  kind: TableRefKind;
  tableId: string;
}

export function TableRefPickerDialog({
  open,
  group,
  busy,
  onOpenChange,
  onSave,
  onCreateRawTable,
}: {
  open: boolean;
  group: CloudConnectionGroup;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (refs: TableRefPick[]) => Promise<boolean>;
  onCreateRawTable?: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TableRefKind>('raw');
  const [query, setQuery] = useState('');
  const [rawTables, setRawTables] = useState<DataRawTable[]>([]);
  const [resultTables, setResultTables] = useState<DataResultTable[]>([]);
  const [groups, setGroups] = useState<DataGroup[]>([]);
  const [sources, setSources] = useState<DataRawSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab('raw');
    setQuery('');
    setPicked(new Set());
    setError(null);
    setLoading(true);
    let cancelled = false;
    const load = async () => {
      const [dashboard, sourceList] = await Promise.all([
        dataClient.getDashboard({
          includeSummary: false,
          includePipelines: false,
          includeRawTables: true,
          includeResultTables: true,
          rawTableLimit: 1000,
          outputLimit: 1000,
        }),
        dataClient.has('listRawSources') ? dataClient.listRawSources() : Promise.resolve([]),
      ]);
      if (cancelled) return;
      setRawTables(dashboard.rawTables ?? []);
      setResultTables(dashboard.resultTables ?? []);
      setGroups(dashboard.groups ?? []);
      setSources(sourceList);
    };
    void load()
      .catch((err) => {
        if (!cancelled) setError(errorText(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const used = useMemo(
    () => new Set(group.tables.map((table) => `${table.kind}:${table.tableId}`)),
    [group.tables]
  );
  const rawGroups = useMemo(() => groups.filter((item) => item.scope === 'raw'), [groups]);
  const resultGroups = useMemo(() => groups.filter((item) => item.scope === 'result'), [groups]);
  const sourceById = useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources]
  );
  const rawGroupName = useMemo(() => {
    const map = new Map(rawGroups.map((item) => [item.id, item.name]));
    return (groupId: string | null | undefined) => (groupId ? (map.get(groupId) ?? '') : '');
  }, [rawGroups]);
  const resultGroupName = useMemo(() => {
    const map = new Map(resultGroups.map((item) => [item.id, item.name]));
    return (groupId: string | null | undefined) => (groupId ? (map.get(groupId) ?? '') : '');
  }, [resultGroups]);

  const filteredRaw = useMemo(() => {
    const q = query.trim();
    if (!q) return rawTables;
    return rawTables.filter((table) => {
      const sourceName = table.sourceId ? (sourceById.get(table.sourceId)?.name ?? '') : '';
      return (
        matchesSearchText(table.name, q) ||
        matchesSearchText(rawGroupName(table.groupId), q) ||
        matchesSearchText(sourceName, q)
      );
    });
  }, [query, rawTables, rawGroupName, sourceById]);

  const filteredResult = useMemo(() => {
    const q = query.trim();
    if (!q) return resultTables;
    return resultTables.filter(
      (table) =>
        matchesSearchText(table.name, q) || matchesSearchText(resultGroupName(table.groupId), q)
    );
  }, [query, resultTables, resultGroupName]);

  const disabledRaw = useMemo(
    () => rawTables.filter((table) => used.has(`raw:${table.id}`)).map((table) => table.id),
    [rawTables, used]
  );
  const disabledResult = useMemo(
    () => resultTables.filter((table) => used.has(`result:${table.id}`)).map((table) => table.id),
    [resultTables, used]
  );

  const selectedRaw = useMemo(
    () => [...picked].filter((key) => key.startsWith('raw:')).map((key) => key.slice(4)),
    [picked]
  );
  const selectedResult = useMemo(
    () => [...picked].filter((key) => key.startsWith('result:')).map((key) => key.slice(7)),
    [picked]
  );

  const selectedItems = useMemo(() => {
    return [...picked].map((key) => {
      const kind = key.startsWith('raw:') ? ('raw' as const) : ('result' as const);
      const tableId = kind === 'raw' ? key.slice(4) : key.slice(7);
      const raw = kind === 'raw' ? rawTables.find((table) => table.id === tableId) : undefined;
      const result =
        kind === 'result' ? resultTables.find((table) => table.id === tableId) : undefined;
      const sourceName = raw?.sourceId ? sourceById.get(raw.sourceId)?.name : undefined;
      const name = raw ? childDisplayName(raw, sourceName) : (result?.name ?? tableId);
      return { key, kind, tableId, name };
    });
  }, [picked, rawTables, resultTables, sourceById]);

  const setKindIds = (kind: TableRefKind, ids: readonly string[]) => {
    setPicked((current) => {
      const next = new Set([...current].filter((key) => !key.startsWith(`${kind}:`)));
      for (const id of ids) next.add(`${kind}:${id}`);
      return next;
    });
  };

  const visibleEmpty =
    !loading && !error && (tab === 'raw' ? filteredRaw.length === 0 : filteredResult.length === 0);
  const isSearchEmpty = visibleEmpty && query.trim().length > 0;

  const handleSave = async () => {
    const refs: TableRefPick[] = [...picked].map((key) => {
      const kind = key.startsWith('raw:') ? ('raw' as const) : ('result' as const);
      const tableId = kind === 'raw' ? key.slice(4) : key.slice(7);
      return { kind, tableId };
    });
    if (refs.length === 0) return;
    setSaving(true);
    try {
      const ok = await onSave(refs);
      if (ok) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      busy={saving || busy}
      ariaLabel={t('cloudConnection.ds.pickerTitle')}
      className="flex h-[min(40rem,86vh)] w-[min(52rem,92vw)] max-w-[min(52rem,92vw)] flex-col gap-0 overflow-hidden rounded-none border-border-subtle p-0 shadow-elevated"
    >
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface"
        data-testid="cloud-connection-table-picker"
      >
        <DialogHeader className="flex flex-shrink-0 flex-col items-start gap-4 border-b border-border-subtle px-6 pb-4 pt-5">
          <div className="space-y-1">
            <DialogTitle className="text-[17px] font-semibold tracking-tight">
              {t('cloudConnection.ds.pickerTitle')}
            </DialogTitle>
            <p className="text-[13px] text-text-muted">
              {t('cloudConnection.ds.pickerSubtitle', { name: group.sourceName })}
            </p>
          </div>
          <div
            className="grid h-10 w-full grid-cols-2 border border-border-subtle bg-surface-muted"
            role="tablist"
            aria-label={t('cloudConnection.ds.pickerTitle')}
          >
            {(['raw', 'result'] as const).map((value) => {
              const active = tab === value;
              const count = value === 'raw' ? filteredRaw.length : filteredResult.length;
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`table-ref-picker-tab-${value}`}
                  onClick={() => setTab(value)}
                  className={cn(
                    'inline-flex h-full items-center justify-center gap-2 text-[13px] font-medium transition-colors',
                    active
                      ? 'bg-accent text-accent-foreground'
                      : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                  )}
                >
                  {value === 'raw'
                    ? t('cloudConnection.ds.pickerRaw')
                    : t('cloudConnection.ds.pickerResult')}
                  <span
                    className={cn(
                      'inline-flex h-5 min-w-[1.25rem] items-center justify-center px-1.5 text-[11px] tabular-nums',
                      active
                        ? 'bg-accent-foreground/15 text-accent-foreground'
                        : 'bg-background text-text-muted'
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('cloudConnection.ds.pickerSearch')}
              className="h-10 w-full border border-border-subtle bg-background pl-9 pr-3 text-[13px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
              data-testid="cloud-connection-picker-search"
            />
          </div>
        </DialogHeader>
        <DialogBody className="min-h-0 flex-1 overflow-y-auto bg-surface p-0">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-[13px] text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : error ? (
            <p className="px-6 py-10 text-[13px] text-error">{error}</p>
          ) : visibleEmpty ? (
            <div
              className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center"
              data-testid="cloud-connection-picker-empty"
            >
              <Table2 className="h-6 w-6 text-text-muted" />
              <div className="space-y-1">
                <p className="text-[14px] font-semibold text-text-primary">
                  {isSearchEmpty
                    ? t('cloudConnection.ds.pickerEmptySearch')
                    : t('cloudConnection.ds.pickerEmptyTitle')}
                </p>
                <p className="max-w-sm text-[13px] text-text-muted">
                  {isSearchEmpty
                    ? t('cloudConnection.ds.pickerEmptySearchHint')
                    : t('cloudConnection.ds.pickerEmpty')}
                </p>
              </div>
              {tab === 'raw' && !isSearchEmpty && (
                <Button
                  variant="secondary"
                  className="rounded-none"
                  data-testid="cloud-connection-create-raw-table-empty"
                  onClick={onCreateRawTable}
                  disabled={!onCreateRawTable}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('cloudConnection.ds.createRawTable')}
                </Button>
              )}
            </div>
          ) : tab === 'raw' ? (
            <div data-testid="cloud-connection-picker-list">
              <RawTableTree
                variant="picker"
                rawTables={filteredRaw}
                sources={sources}
                groups={rawGroups}
                selectionMode="multi"
                selectedIds={selectedRaw}
                disabledIds={disabledRaw}
                onSelectedIdsChange={(ids) => setKindIds('raw', ids)}
              />
            </div>
          ) : (
            <div data-testid="cloud-connection-picker-list">
              <ResultTableTree
                variant="picker"
                resultTables={filteredResult}
                groups={resultGroups}
                selectionMode="multi"
                selectedIds={selectedResult}
                disabledIds={disabledResult}
                onSelectedIdsChange={(ids) => setKindIds('result', ids)}
              />
            </div>
          )}
        </DialogBody>
        <DialogFooter className="relative z-10 flex-shrink-0 items-center justify-between gap-4 border-t border-border-subtle bg-surface px-5 py-3 pt-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span
              className="flex-shrink-0 text-[13px] text-text-secondary"
              data-testid="cloud-connection-picker-selected"
            >
              {t('cloudConnection.ds.pickerSelected', { count: picked.size })}
            </span>
            {selectedItems.length > 0 && (
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 overflow-hidden">
                {selectedItems.slice(0, 4).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className="inline-flex max-w-[9rem] items-center gap-1 border border-border-subtle bg-background px-1.5 py-0.5 text-[12px] text-text-primary hover:border-border hover:bg-surface-hover"
                    onClick={() =>
                      setPicked((current) => {
                        const next = new Set(current);
                        next.delete(item.key);
                        return next;
                      })
                    }
                    title={item.name}
                  >
                    <span className="min-w-0 truncate">{item.name}</span>
                    <X className="h-3 w-3 flex-shrink-0 text-text-muted" />
                  </button>
                ))}
                {selectedItems.length > 4 && (
                  <span className="text-[12px] text-text-muted">+{selectedItems.length - 4}</span>
                )}
              </div>
            )}
            {tab === 'raw' && (
              <Button
                variant="ghost"
                className="ml-auto flex-shrink-0 rounded-none text-accent hover:bg-accent-muted hover:text-accent"
                data-testid="cloud-connection-create-raw-table"
                onClick={onCreateRawTable}
                disabled={!onCreateRawTable}
              >
                <Plus className="h-3.5 w-3.5" />
                {t('cloudConnection.ds.createRawTable')}
              </Button>
            )}
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              className="rounded-none"
              onClick={() => onOpenChange(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              className="rounded-none"
              data-testid="cloud-connection-save-table"
              disabled={picked.size === 0 || saving || busy}
              loading={saving}
              onClick={() => void handleSave()}
            >
              {t('cloudConnection.ds.pickerAdd')}
            </Button>
          </div>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
