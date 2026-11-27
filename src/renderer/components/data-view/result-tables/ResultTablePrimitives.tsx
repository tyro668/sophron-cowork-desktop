import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DataTableExportFormat } from '../../../types';
import { dataClient } from '../../../features/data/api/data-client';
import { formatIpcError } from '../../../utils/ipc-error';
import { showToast } from '../../../utils/toast';
import { cn } from '../../ui';

export type ResultTableSourceType = 'pipeline' | 'copy';

const TOOLTIP_WIDTH = 280;
const TOOLTIP_MARGIN = 12;

/** Shared flush info button + portal tooltip describing both result-table source types. */
export function ResultTableSourceTypeInfoTip({
  currentType,
  testId = 'result-table-source-type-info',
}: {
  currentType: ResultTableSourceType;
  testId?: string;
}) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const openTip = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportWidth = window.innerWidth || 1024;
    const left = Math.min(
      Math.max(TOOLTIP_MARGIN, rect.right - TOOLTIP_WIDTH),
      Math.max(TOOLTIP_MARGIN, viewportWidth - TOOLTIP_WIDTH - TOOLTIP_MARGIN)
    );
    setPos({ top: rect.bottom + 6, left });
  };
  const closeTip = () => setPos(null);

  const items: Array<{ key: ResultTableSourceType; title: string; desc: string }> = [
    {
      key: 'pipeline',
      title: t('data.resultTables.source.typePipeline'),
      desc: t('data.resultTables.source.typePipelineDesc'),
    },
    {
      key: 'copy',
      title: t('data.resultTables.source.typeCopy'),
      desc: t('data.resultTables.source.typeCopyDesc'),
    },
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid={testId}
        aria-label={t('data.resultTables.source.type')}
        onMouseEnter={openTip}
        onMouseLeave={closeTip}
        onFocus={openTip}
        onBlur={closeTip}
        className="inline-flex h-full w-10 flex-shrink-0 items-center justify-center border-l border-border-subtle text-text-muted transition-colors hover:bg-surface-hover hover:text-accent focus-visible:bg-surface-hover focus-visible:text-accent focus-visible:outline-none"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="tooltip"
              data-testid="result-table-source-type-tooltip"
              style={{ top: pos.top, left: pos.left, width: TOOLTIP_WIDTH }}
              className="pointer-events-none fixed z-[10010] border border-border bg-surface text-left shadow-elevated"
            >
              {items.map((item, index) => {
                const active = item.key === currentType;
                return (
                  <div
                    key={item.key}
                    className={cn(
                      'px-3 py-2.5',
                      index > 0 && 'border-t border-border-subtle',
                      active && 'bg-accent-muted/35'
                    )}
                  >
                    <div
                      className={cn(
                        'text-[12px] font-semibold',
                        active ? 'text-accent' : 'text-text-primary'
                      )}
                    >
                      {item.title}
                    </div>
                    <div className="mt-0.5 text-[12px] leading-[1.45] text-text-secondary">
                      {item.desc}
                    </div>
                  </div>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

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
