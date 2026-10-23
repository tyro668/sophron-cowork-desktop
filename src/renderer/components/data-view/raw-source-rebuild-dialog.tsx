/** Confirmation before changing a source's build mode: lists the tables that will be deleted,
 *  their row counts and the pipelines using them; the red button needs an acknowledgement. */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, X } from 'lucide-react';
import type { DataRawSourceRebuildImpact } from '../../types';
import { Dialog } from '../ui/dialog';

export function RebuildConfirmDialog({
  open,
  sourceName,
  fromMode,
  toMode,
  impact,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  sourceName: string;
  fromMode: string;
  toMode: string;
  impact: DataRawSourceRebuildImpact;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`data.rawSources.rebuild.${key}`, options);
  const [ack, setAck] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const referenced = impact.tables.filter((table) => table.pipelineNames.length > 0);
  const unreferenced = impact.tables.filter((table) => table.pipelineNames.length === 0);
  const visible = expanded
    ? impact.tables
    : [...referenced, ...unreferenced.slice(0, Math.max(0, 3 - referenced.length))];
  const hidden = impact.tables.length - visible.length;
  const pipelines = Array.from(new Set(referenced.flatMap((table) => table.pipelineNames)));
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onCancel()}
      ariaLabel={tr('title')}
      className="w-full max-w-xl p-0"
    >
      <div data-testid="raw-source-rebuild-dialog">
        <div className="flex items-center gap-2 border-b border-border-subtle px-5 py-3">
          <AlertTriangle className="h-4 w-4 text-error" />
          <span className="text-[14px] font-medium text-text-primary">{tr('title')}</span>
          <button
            type="button"
            className="ml-auto text-text-muted"
            onClick={onCancel}
            aria-label="close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 text-[13px] text-text-secondary">
          {tr('body', {
            name: sourceName,
            from: fromMode,
            to: toMode,
            count: impact.tables.length,
          })}
        </div>
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead>
            <tr className="h-8 border-y border-border-subtle bg-[var(--data-grid-header-surface)] text-text-muted">
              <th className="px-5 font-medium">{tr('colTable')}</th>
              <th className="w-16 px-2 text-right font-medium">{tr('colRows')}</th>
              <th className="px-2 font-medium">{tr('colRefs')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((table) => (
              <tr key={table.id} className="h-9 border-b border-dashed border-border-muted">
                <td className="truncate px-5">{table.name}</td>
                <td className="px-2 text-right tabular-nums">{table.rowCount}</td>
                <td
                  className={`px-2 ${table.pipelineNames.length ? 'text-error' : 'text-text-muted'}`}
                >
                  {table.pipelineNames.length
                    ? table.pipelineNames.join('、')
                    : tr('notReferenced')}
                </td>
              </tr>
            ))}
            {hidden > 0 && (
              <tr className="h-9 border-b border-dashed border-border-muted text-text-muted">
                <td className="px-5">{tr('more', { count: hidden })}</td>
                <td className="px-2 text-right">—</td>
                <td className="px-2">
                  <button type="button" className="text-accent" onClick={() => setExpanded(true)}>
                    {tr('expand')}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {pipelines.length > 0 && (
          <div className="mx-5 mt-3 rounded-md bg-error/[0.08] px-3 py-2 text-[12.5px] text-error">
            {tr('warning', { count: pipelines.length, names: pipelines.join('、') })}
          </div>
        )}
        <label className="mx-5 mt-3 flex items-center gap-2 text-[13px] text-text-primary">
          <input
            type="checkbox"
            checked={ack}
            onChange={(event) => setAck(event.target.checked)}
            data-testid="raw-source-rebuild-ack"
          />
          {tr('ack')}
        </label>
        <div className="flex items-center gap-2 px-5 py-4">
          <span className="text-[12px] text-text-muted">{tr('suggest')}</span>
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto h-8 rounded-md border border-border-subtle px-3 text-[13px]"
          >
            {tr('cancel')}
          </button>
          <button
            type="button"
            disabled={!ack || busy}
            onClick={onConfirm}
            data-testid="raw-source-rebuild-confirm"
            className="h-8 rounded-md bg-error px-3 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {tr('confirm')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
