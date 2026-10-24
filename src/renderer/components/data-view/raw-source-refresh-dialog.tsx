/**
 * Refresh result (design 4.3): shown only when a refresh found a suspected rename or lost a
 * table that a pipeline uses. Renames are matched by fingerprint and need the user's decision:
 * "same table" keeps the raw table id and re-binds the sheet / file; "new table" marks the old
 * one missing and imports the new sheet / file as a new table.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, X } from 'lucide-react';
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
  const kindLabel = result.source.sourceKind === 'folder' ? tr('colFile') : tr('colSheet');
  const pill = (tone: string, text: string) => (
    <span className={`rounded-full px-2 py-0.5 text-[12px] ${tone}`}>{text}</span>
  );
  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onLater()}
      busy={busy}
      ariaLabel={tr('title', { name: result.source.name })}
      className="w-full max-w-2xl p-0"
    >
      <div data-testid="raw-source-refresh-dialog">
        <div className="flex items-center gap-2 border-b border-border-subtle px-5 py-3">
          <RefreshCw className="h-4 w-4 text-accent" />
          <span className="text-[14px] font-medium text-text-primary">
            {tr('title', { name: result.source.name })}
          </span>
          <button type="button" className="ml-auto text-text-muted" onClick={onLater}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2 px-5 pt-3">
          {pill('bg-success/10 text-success', tr('added', { count: result.addedItems.length }))}
          {pill('bg-accent-muted text-accent', tr('renamed', { count: result.renames.length }))}
          {pill('bg-warning/10 text-warning', tr('missing', { count: result.missingItems.length }))}
          {pill(
            'bg-surface-hover text-text-secondary',
            tr('unchanged', { count: result.unchangedNames.length })
          )}
        </div>
        <table className="mt-3 w-full border-collapse text-left text-[12.5px]">
          <thead>
            <tr className="h-8 border-y border-border-subtle bg-[var(--data-grid-header-surface)] text-text-muted">
              <th className="w-28 px-5 font-medium">{tr('colChange')}</th>
              <th className="px-2 font-medium">{kindLabel}</th>
              <th className="px-2 font-medium">{tr('colAction')}</th>
            </tr>
          </thead>
          <tbody>
            {result.addedItems.map((item) => (
              <tr key={item.id} className="h-9 border-b border-dashed border-border-muted">
                <td className="px-5 text-success">＋ {tr('addedRow')}</td>
                <td className="px-2 text-text-primary">{item.key ?? item.name}</td>
                <td className="px-2 text-text-secondary">
                  {tr('addedAction', { name: item.name })}
                </td>
              </tr>
            ))}
            {result.renames.map((rename) => (
              <tr
                key={rename.tableId}
                className="border-b border-dashed border-border-muted"
                data-testid="raw-source-rename-row"
              >
                <td className="px-5 py-2 text-accent">↻ {tr('renamedRow')}</td>
                <td className="px-2 py-2">
                  <div className="text-text-primary">
                    {rename.oldKey} → {rename.newKey}
                  </div>
                  <div className="text-[11.5px] text-text-muted">
                    {tr('similarity', { percent: Math.round(rename.similarity * 100) })}
                  </div>
                </td>
                <td className="px-2 py-2">
                  <div className="flex gap-1.5">
                    {(['rename', 'new'] as const).map((action) => (
                      <button
                        key={action}
                        type="button"
                        onClick={() => setChoices({ ...choices, [rename.tableId]: action })}
                        data-testid={`raw-source-rename-${action}`}
                        className={`h-7 rounded-md border px-2 text-[12px] ${
                          choices[rename.tableId] === action
                            ? 'border-accent bg-accent/[0.08] text-accent'
                            : 'border-border-subtle text-text-secondary'
                        }`}
                      >
                        {action === 'rename' ? tr('confirmSame') : tr('asNew')}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {result.missingItems.map((item) => (
              <tr key={item.id} className="h-9 border-b border-dashed border-border-muted">
                <td className="px-5 text-warning">● {tr('missingRow')}</td>
                <td className="px-2 text-text-primary">{item.key ?? item.name}</td>
                <td className="px-2 text-text-secondary">
                  {item.pipelineNames.length
                    ? tr('missingUsed', {
                        count: item.pipelineNames.length,
                        names: item.pipelineNames.join('、'),
                      })
                    : tr('missingKept')}
                </td>
              </tr>
            ))}
            {result.unchangedNames.length > 0 && (
              <tr className="h-9 border-b border-dashed border-border-muted text-text-muted">
                <td className="px-5">{tr('unchangedRow')}</td>
                <td className="px-2">{result.unchangedNames.join('、')}</td>
                <td className="px-2">—</td>
              </tr>
            )}
          </tbody>
        </table>
        {result.renames.length > 0 && (
          <div className="px-5 pt-3 text-[12px] leading-5 text-text-muted">{tr('explain')}</div>
        )}
        <div className="flex items-center gap-2 px-5 py-4">
          <span className="text-[11.5px] text-text-muted">{tr('fingerprint')}</span>
          <button
            type="button"
            onClick={onLater}
            className="ml-auto h-8 rounded-md border border-border-subtle px-3 text-[13px]"
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
      else showToast(result.failed.length ? 'error' : 'success', summary(result));
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
