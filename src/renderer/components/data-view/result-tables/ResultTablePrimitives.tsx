import { useState } from 'react';
import { Info, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DataTableExportFormat } from '../../../types';
import { dataClient } from '../../../features/data/api/data-client';
import { formatIpcError } from '../../../utils/ipc-error';
import { showToast } from '../../../utils/toast';

/** Shared export flow for result tables (save dialog, success toast, silent cancel). */
export function useResultTableExport() {
  const { t } = useTranslation();
  const [exportBusy, setExportBusy] = useState<DataTableExportFormat | null>(null);
  const exportResultTable = async (id: string, format: DataTableExportFormat) => {
    if (exportBusy) return;
    setExportBusy(format);
    try {
      const result = await dataClient.exportTable({
        tableKind: 'result',
        id,
        format,
      });
      if (result.success) {
        showToast('success', t('data.resultTables.editor.exportDone', { path: result.path }));
      } else if (result.error && result.error !== 'cancelled') {
        showToast('error', result.error);
      }
    } catch (err) {
      showToast('error', formatIpcError(err, String(err)));
    } finally {
      setExportBusy(null);
    }
  };
  return { exportBusy, exportResultTable, canExport: dataClient.has('exportTable') };
}

export function InlineInfoTooltip({ label }: { label: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-accent-muted hover:text-accent focus:bg-accent-muted focus:text-accent focus:outline-none"
        aria-label={label}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <span className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-72 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-left text-[12px] font-medium leading-5 text-text-secondary shadow-elevated group-hover:block group-focus-within:block">
        {label}
      </span>
    </span>
  );
}

export function StatCard({
  label,
  value,
  link,
  plain,
}: {
  label: string;
  value: string;
  link?: boolean;
  plain?: boolean;
}) {
  return (
    <div className="bg-surface">
      <div className="flex h-[30px] items-center border-b border-border-subtle bg-surface-muted px-3 text-xs text-text-secondary">
        {label}
      </div>
      <div
        className={`flex h-10 items-center gap-1.5 truncate px-3 tabular-nums ${
          link
            ? 'text-[12.5px] font-medium text-accent'
            : plain
              ? 'text-[12.5px] text-text-primary'
              : 'text-[15px] font-semibold text-text-primary'
        }`}
        title={value}
      >
        {link ? <Workflow className="h-3.5 w-3.5 flex-shrink-0" /> : null}
        {value}
      </div>
    </div>
  );
}

/** Every raw table the producing pipeline reads (a join over child tables has several). */
export function upstreamRawNames(
  resultTable: { sourceRawTableId: string | null },
  pipeline: { name: string; sourceRawTableId: string | null } | null | undefined,
  rawTables: ReadonlyArray<{ id: string; name: string; relatedPipelineNames?: string[] }>
): string[] {
  const byId = (id: string | null | undefined) =>
    id ? rawTables.find((item) => item.id === id)?.name : undefined;
  const direct = byId(resultTable.sourceRawTableId);
  if (direct) return [direct];
  const read = pipeline
    ? rawTables
        .filter((item) => item.relatedPipelineNames?.includes(pipeline.name))
        .map((item) => item.name)
    : [];
  if (read.length) return read;
  return [byId(pipeline?.sourceRawTableId) ?? '—'];
}

export function LineageChip({
  kind,
  name,
  active = false,
}: {
  kind: string;
  name: string;
  active?: boolean;
}) {
  return (
    <span className="inline-flex max-w-[16rem] items-center gap-1.5">
      <span
        className={`rounded px-1.5 py-px text-[11px] ${
          active ? 'bg-accent-muted text-accent' : 'bg-surface-muted text-text-secondary'
        }`}
      >
        {kind}
      </span>
      <span className="truncate text-text-primary">{name}</span>
    </span>
  );
}
