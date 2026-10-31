/**
 * Refresh result (design 4.3): shown only when a refresh found a suspected rename or lost a
 * table that a pipeline uses. Renames are matched by fingerprint and need the user's decision:
 * "same table" keeps the raw table id and re-binds the sheet / file; "new table" marks the old
 * one missing and imports the new sheet / file as a new table.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, ChevronRight, Plus, RefreshCw, TriangleAlert, X } from 'lucide-react';
import type { DataRawSourceRefreshResult } from '../../types';
import { Dialog } from '../ui/dialog';
import { dataClient } from '../../features/data/api/data-client';
import { formatDataErrorMessage } from '../../features/data/model/errors';
import { showToast } from '../../utils/toast';

export type RenameDecision = { tableId: string; newKey: string; action: 'rename' | 'new' };

export function shouldShowRefreshDialog(result: DataRawSourceRefreshResult): boolean {
  return (
    (result.renames?.length ?? 0) > 0 ||
    (result.missingItems ?? []).some((item) => item.pipelineNames.length > 0)
  );
}

export function RawSourceRefreshDialog({
  result,
  busy,
  onLater,
  onApply,
}: {
  result: DataRawSourceRefreshResult;
  busy?: boolean;
  onLater: () => void;
  onApply: (decisions: RenameDecision[]) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    String(t(`data.rawSources.refresh.${key}`, options ?? {}));
  const [choices, setChoices] = useState<Record<string, 'rename' | 'new'>>(() =>
    Object.fromEntries(result.renames.map((rename) => [rename.tableId, 'rename']))
  );
  const [showUnchanged, setShowUnchanged] = useState(false);
  const chips = [
    ['bg-success/10 text-success', 'added', result.addedItems.length],
    ['bg-accent-muted text-accent', 'renamed', result.renames.length],
    ['bg-warning/10 text-warning', 'missing', result.missingItems.length],
  ] as const;
  const row = 'flex h-10 items-center gap-2.5 px-5';
  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onLater()}
      busy={busy}
      ariaLabel={tr('title', { name: result.source.name })}
      className="w-full max-w-md p-0"
    >
      <div data-testid="raw-source-refresh-dialog">
        <div className="flex items-center gap-2 px-5 pb-2 pt-4">
          <RefreshCw className="h-4 w-4 text-accent" />
          <span className="truncate text-[14px] font-medium text-text-primary">
            {tr('title', { name: result.source.name })}
          </span>
          <button type="button" className="ml-auto text-text-muted" onClick={onLater}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 px-5 pb-2">
          {chips
            .filter(([, , count]) => count > 0)
            .map(([tone, key, count]) => (
              <span key={key} className={`rounded-full px-2 py-0.5 text-[11.5px] ${tone}`}>
                {tr(key, { count })}
              </span>
            ))}
        </div>
        <div className="border-y border-border-subtle text-[13px]">
          {result.renames.map((rename) => (
            <div key={rename.tableId} className={row} data-testid="raw-source-rename-row">
              <ArrowRightLeft className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="min-w-0 truncate text-text-primary">
                {rename.oldKey} → {rename.newKey}
              </span>
              <span
                className="shrink-0 rounded bg-surface-hover px-1 text-[11px] text-text-muted"
                title={tr('similarityTip')}
              >
                {Math.round(rename.similarity * 100)}%
              </span>
              <div className="ml-auto flex shrink-0 rounded-md border border-border-subtle p-0.5">
                {(['rename', 'new'] as const).map((action) => (
                  <button
                    key={action}
                    type="button"
                    onClick={() => setChoices({ ...choices, [rename.tableId]: action })}
                    data-testid={`raw-source-rename-${action}`}
                    title={tr(action === 'rename' ? 'sameTip' : 'newTip')}
                    className={`h-6 rounded px-2 text-[12px] ${
                      choices[rename.tableId] === action
                        ? 'bg-accent/[0.1] text-accent'
                        : 'text-text-secondary'
                    }`}
                  >
                    {tr(action === 'rename' ? 'confirmSame' : 'asNew')}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {result.addedItems.map((item) => (
            <div key={item.id} className={row} title={item.name}>
              <Plus className="h-3.5 w-3.5 shrink-0 text-success" />
              <span className="min-w-0 truncate text-text-primary">{item.key ?? item.name}</span>
              <span className="ml-auto shrink-0 text-[12px] text-text-muted">
                {tr('addedAction')}
              </span>
            </div>
          ))}
          {result.missingItems.map((item) => (
            <div key={item.id} className={row}>
              <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warning" />
              <span className="min-w-0 truncate text-text-primary">{item.key ?? item.name}</span>
              <span
                className={`ml-auto shrink-0 text-[12px] ${
                  item.pipelineNames.length ? 'text-warning' : 'text-text-muted'
                }`}
                title={item.pipelineNames.join('、') || undefined}
              >
                {item.pipelineNames.length
                  ? tr('missingUsed', { count: item.pipelineNames.length })
                  : tr('missingKept')}
              </span>
            </div>
          ))}
          {result.unchangedNames.length > 0 && (
            <button
              type="button"
              className={`${row} w-full text-[12px] text-text-muted`}
              onClick={() => setShowUnchanged(!showUnchanged)}
              data-testid="raw-source-refresh-unchanged"
            >
              <ChevronRight
                className={`h-3.5 w-3.5 transition-transform ${showUnchanged ? 'rotate-90' : ''}`}
              />
              {tr('unchanged', { count: result.unchangedNames.length })}
              {showUnchanged && (
                <span className="min-w-0 truncate">· {result.unchangedNames.join('、')}</span>
              )}
            </button>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3">
          <button
            type="button"
            onClick={onLater}
            className="h-8 rounded-md border border-border-subtle px-3 text-[13px]"
            data-testid="raw-source-refresh-later"
          >
            {tr('later')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onApply(
                result.renames.map((rename) => ({
                  tableId: rename.tableId,
                  newKey: rename.newKey,
                  action: choices[rename.tableId] ?? 'rename',
                }))
              )
            }
            data-testid="raw-source-refresh-apply"
            className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-foreground disabled:opacity-50"
          >
            {tr('apply')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** Refresh a source; opens the result dialog when a decision or warning is needed. */
export function useRawSourceRefresh(onChanged: () => void) {
  const { t } = useTranslation();
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [pending, setPending] = useState<DataRawSourceRefreshResult | null>(null);
  const [applying, setApplying] = useState(false);
  const summary = (result: DataRawSourceRefreshResult) =>
    String(
      t('data.rawSources.detail.refreshed', {
        refreshed: result.refreshed.length,
        added: result.added.length,
        missing: result.missing.length,
      })
    );
  const refresh = async (sourceId: string) => {
    setRefreshingId(sourceId);
    try {
      const result = await dataClient.refreshRawSource(sourceId);
      if (shouldShowRefreshDialog(result)) setPending(result);
      else if (result.failed.length)
        showToast(
          'error',
          `${summary(result)}\n${formatDataErrorMessage(result.failed[0].error, t)}`
        );
      else showToast('success', summary(result));
      onChanged();
    } catch (error) {
      showToast('error', formatDataErrorMessage(error, t));
    } finally {
      setRefreshingId(null);
    }
  };
  const apply = async (decisions: RenameDecision[]) => {
    if (!pending) return;
    if (decisions.length === 0) {
      setPending(null);
      return;
    }
    setApplying(true);
    try {
      const resolved = await dataClient.resolveRawSourceRenames({
        sourceId: pending.source.id,
        decisions,
      });
      showToast(
        resolved.failed.length ? 'error' : 'success',
        String(
          t('data.rawSources.refresh.applied', {
            renamed: resolved.renamed.length,
            added: resolved.added.length,
          })
        )
      );
      setPending(null);
      onChanged();
    } catch (error) {
      showToast('error', formatDataErrorMessage(error, t));
    } finally {
      setApplying(false);
    }
  };
  const dialog = pending ? (
    <RawSourceRefreshDialog
      result={pending}
      busy={applying}
      onLater={() => setPending(null)}
      onApply={(decisions) => void apply(decisions)}
    />
  ) : null;
  return { refresh, refreshingId, dialog };
}
