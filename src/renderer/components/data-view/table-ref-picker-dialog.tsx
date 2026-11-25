/**
 * Modal for choosing raw / result tables to reference from 云连接.
 * Each side uses the reusable grouped tree so folder/source hierarchy is preserved.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type {
  CloudConnectionGroup,
  DataGroup,
  DataRawSource,
  DataRawTable,
  DataResultTable,
} from '../../types';
import { dataClient } from '../../features/data/api/data-client';
import { errorText } from '../../features/cloud-connection/hooks/use-cloud-connection';
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle, cn } from '../ui';
import { RawTableTree } from './raw-table-tree';
import { ResultTableTree } from './result-table-tree';
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

  const setKindIds = (kind: TableRefKind, ids: readonly string[]) => {
    setPicked((current) => {
      const next = new Set([...current].filter((key) => !key.startsWith(`${kind}:`)));
      for (const id of ids) next.add(`${kind}:${id}`);
      return next;
    });
  };

  const visibleEmpty =
    !loading && !error && (tab === 'raw' ? filteredRaw.length === 0 : filteredResult.length === 0);

  const handleSave = async () => {
    const refs: TableRefPick[] = [...picked].map((key) => {
      const [kind, tableId] = key.split(':') as [TableRefKind, string];
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
      className="flex h-[min(36rem,80vh)] w-[min(48rem,92vw)] flex-col gap-0 rounded-none p-0 shadow-none"
    >
      <div className="flex min-h-0 flex-1 flex-col" data-testid="cloud-connection-table-picker">
        <DialogHeader className="flex h-12 flex-shrink-0 flex-row items-center justify-between border-b border-border-subtle px-4 py-0">
          <DialogTitle className="text-[14px] font-semibold">
            {t('cloudConnection.ds.pickerTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-border-subtle px-4 py-2">
          <div
            className="inline-flex h-8 border border-border-subtle"
            role="tablist"
            aria-label={t('cloudConnection.ds.pickerTitle')}
          >
            {(['raw', 'result'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                data-testid={`table-ref-picker-tab-${value}`}
                onClick={() => setTab(value)}
                className={cn(
                  'h-full min-w-[5.5rem] px-3 text-[13px] font-medium',
                  tab === value
                    ? 'bg-accent-muted text-accent'
                    : 'text-text-secondary hover:bg-surface-hover'
                )}
              >
                {value === 'raw'
                  ? t('cloudConnection.ds.pickerRaw')
                  : t('cloudConnection.ds.pickerResult')}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('cloudConnection.ds.pickerSearch')}
            className="h-8 min-w-0 flex-1 border border-border-subtle bg-transparent px-2.5 text-[13px] outline-none"
            data-testid="cloud-connection-picker-search"
          />
        </div>
        <DialogBody className="min-h-0 flex-1 overflow-auto p-0">
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-[13px] text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            </div>
          ) : error ? (
            <p className="px-4 py-6 text-[13px] text-error">{error}</p>
          ) : visibleEmpty ? (
            <div
              className="flex flex-col items-start gap-3 px-4 py-6"
              data-testid="cloud-connection-picker-empty"
            >
              <p className="text-[13px] text-text-muted">{t('cloudConnection.ds.pickerEmpty')}</p>
              {tab === 'raw' && (
                <button
                  type="button"
                  data-testid="cloud-connection-create-raw-table-empty"
                  onClick={onCreateRawTable}
                  disabled={!onCreateRawTable}
                  className="inline-flex h-8 items-center gap-1.5 border border-border-subtle bg-surface px-3 text-[13px] font-medium text-accent hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('cloudConnection.ds.createRawTable')}
                </button>
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
        <DialogFooter className="h-12 flex-shrink-0 items-center justify-between gap-0 border-t border-border-subtle p-0 pt-0">
          <div className="flex h-full items-center">
            {tab === 'raw' && (
              <button
                type="button"
                data-testid="cloud-connection-create-raw-table"
                onClick={onCreateRawTable}
                disabled={!onCreateRawTable}
                className="inline-flex h-full items-center px-4 text-[13px] font-medium text-accent hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('cloudConnection.ds.createRawTable')}
              </button>
            )}
          </div>
          <div className="flex h-full items-center">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex h-full items-center border-l border-border-subtle px-4 text-[13px] text-text-primary hover:bg-surface-hover"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              data-testid="cloud-connection-save-table"
              disabled={picked.size === 0 || saving || busy}
              onClick={() => void handleSave()}
              className="inline-flex h-full items-center border-l border-border-subtle px-4 text-[13px] font-medium text-accent hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                t('cloudConnection.ds.pickerAdd')
              )}
            </button>
          </div>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
