import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Info, Table2, X } from 'lucide-react';
import { isRawTableUnavailable } from '../../../../shared/contracts';
import { dataClient } from '../../../features/data/api/data-client';
import type { DataGroup, DataRawSource, DataRawTable } from '../../../types';
import { GlassSelect } from '../../GlassSelect';
import { Dialog, DialogBody, DialogTitle, cn } from '../../ui';
import { RawTableTreeSelect } from '../raw-table-tree-select';
import { RESULT_TABLE_INPUT_CHOICES_LIMIT } from '../shared';

const TOOLTIP_WIDTH = 280;
const TOOLTIP_MARGIN = 12;

function PurposeInfoTip({ currentPurpose }: { currentPurpose: 'pipeline' | 'copy' }) {
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

  const items: Array<{ key: 'pipeline' | 'copy'; title: string; desc: string }> = [
    {
      key: 'pipeline',
      title: t('data.resultTables.create.purposePipeline'),
      desc: t('data.resultTables.create.purposePipelineDesc'),
    },
    {
      key: 'copy',
      title: t('data.resultTables.create.purposeCopy'),
      desc: t('data.resultTables.create.purposeCopyDesc'),
    },
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="result-table-purpose-info"
        aria-label={t('data.resultTables.create.purpose')}
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
              data-testid="result-table-purpose-tooltip"
              style={{ top: pos.top, left: pos.left, width: TOOLTIP_WIDTH }}
              className="pointer-events-none fixed z-[10010] border border-border bg-surface text-left shadow-elevated"
            >
              {items.map((item, index) => {
                const active = item.key === currentPurpose;
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

export function ResultTableCreateDialog({
  open,
  onOpenChange,
  busy,
  suggestedName,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy?: boolean;
  suggestedName: string;
  onSubmit: (input: { name: string; sourceRawTableId: string | null }) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(suggestedName);
  const [purpose, setPurpose] = useState<'pipeline' | 'copy'>('pipeline');
  const [sourceRawTableId, setSourceRawTableId] = useState('');
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [rawTables, setRawTables] = useState<DataRawTable[]>([]);
  const [groups, setGroups] = useState<DataGroup[]>([]);
  const [sources, setSources] = useState<DataRawSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(suggestedName);
    setPurpose('pipeline');
    setSourceRawTableId('');
    setSourcePickerOpen(false);
    if (!dataClient.has('getDashboard')) return;
    let cancelled = false;
    setSourcesLoading(true);
    void Promise.all([
      dataClient.getDashboard({
        includeSummary: false,
        includePipelines: false,
        includeRawTables: true,
        includeResultTables: false,
        rawTableOffset: 0,
        rawTableLimit: RESULT_TABLE_INPUT_CHOICES_LIMIT,
        rawTableSourceKind: 'all',
      }),
      dataClient.has('listRawSources') ? dataClient.listRawSources() : Promise.resolve([]),
    ])
      .then(([dashboard, sourceList]) => {
        if (cancelled) return;
        setRawTables(dashboard.rawTables ?? []);
        setGroups(dashboard.groups ?? []);
        setSources(sourceList);
      })
      .catch(() => {
        if (cancelled) return;
        setRawTables([]);
        setGroups([]);
        setSources([]);
      })
      .finally(() => {
        if (!cancelled) setSourcesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, suggestedName]);

  const selectedRawTable = rawTables.find((rawTable) => rawTable.id === sourceRawTableId) ?? null;
  const trimmedName = name.trim();
  const canSubmit =
    Boolean(trimmedName) &&
    !busy &&
    (purpose === 'pipeline' ||
      (Boolean(sourceRawTableId) && !isRawTableUnavailable(selectedRawTable)));
  const submit = () => {
    if (canSubmit) {
      onSubmit({
        name: trimmedName,
        sourceRawTableId: purpose === 'copy' ? sourceRawTableId : null,
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      closeOnEscape={!sourcePickerOpen}
      ariaLabel={t('data.resultTables.create.title')}
      overlayClassName="bg-black/25 px-4 py-6 dark:bg-black/50"
      className="flex h-[216px] w-full max-w-[460px] flex-col gap-0 overflow-hidden rounded-none border-border bg-surface p-0 shadow-elevated"
    >
      <div
        className="grid h-11 flex-shrink-0 grid-cols-[minmax(0,1fr)_44px] border-b border-border-subtle bg-surface"
        data-testid="result-table-create-header"
      >
        <div className="flex min-w-0 items-center gap-2 px-4">
          <Table2 className="h-4 w-4 flex-shrink-0 text-accent" />
          <DialogTitle className="min-w-0 truncate text-[14px] font-semibold text-text-primary">
            {t('data.resultTables.create.title')}
          </DialogTitle>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => onOpenChange(false)}
          className="inline-flex h-full w-11 items-center justify-center border-l border-border-subtle text-text-muted transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          title={t('common.close')}
          aria-label={t('common.close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <DialogBody className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface p-0">
        <div
          className={cn(
            'ui-form-flush flex-shrink-0 bg-surface',
            purpose === 'pipeline' && 'border-b border-border-subtle'
          )}
        >
          <div className="ui-form-row h-[42px] !min-h-[42px] !grid-cols-[108px_minmax(0,1fr)]">
            <span className="ui-form-label items-center !px-3.5 text-[12.5px]">
              {t('data.resultTables.create.name')}
            </span>
            <div className="ui-form-value">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('data.resultTables.create.namePlaceholder')}
                aria-label={t('data.resultTables.create.name')}
                data-autofocus
                disabled={busy}
                className="h-full !min-h-[41px] w-full border-0 bg-transparent !px-3.5 !text-[13px] text-text-primary outline-none placeholder:text-text-muted hover:bg-surface-hover/60 focus:bg-surface-hover/60 disabled:cursor-not-allowed disabled:opacity-60"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submit();
                }}
              />
            </div>
          </div>

          <div className="ui-form-row h-[42px] !min-h-[42px] !grid-cols-[108px_minmax(0,1fr)]">
            <span className="ui-form-label items-center !px-3.5 text-[12.5px]">
              {t('data.resultTables.create.purpose')}
            </span>
            <div className="ui-form-value !flex-row items-stretch">
              <GlassSelect
                ariaLabel={t('data.resultTables.create.purpose')}
                value={purpose}
                disabled={busy}
                onValueChange={(value) => {
                  const next = value === 'copy' ? 'copy' : 'pipeline';
                  setPurpose(next);
                  if (next !== 'copy') setSourcePickerOpen(false);
                }}
                options={[
                  { value: 'pipeline', label: t('data.resultTables.create.purposePipeline') },
                  { value: 'copy', label: t('data.resultTables.create.purposeCopy') },
                ]}
                triggerClassName="!min-h-[41px] min-w-0 flex-1 justify-between !px-3.5 !text-[13px] text-text-primary disabled:opacity-60"
                contentClassName="w-[var(--radix-select-trigger-width)] rounded-none border-border"
              />
              <PurposeInfoTip currentPurpose={purpose} />
            </div>
          </div>

          {purpose === 'copy' && (
            <div className="ui-form-row h-[42px] !min-h-[42px] !grid-cols-[108px_minmax(0,1fr)]">
              <span className="ui-form-label items-center !px-3.5 text-[12.5px]">
                {t('data.resultTables.create.source')}
              </span>
              <div className="ui-form-value">
                <RawTableTreeSelect
                  value={sourceRawTableId}
                  rawTables={rawTables}
                  sources={sources}
                  groups={groups}
                  loading={sourcesLoading}
                  disabled={busy}
                  ariaLabel={t('data.resultTables.create.source')}
                  placeholder={t('data.resultTables.create.selectSource')}
                  loadingLabel={t('data.resultTables.editor.loadingRawTables')}
                  triggerClassName="!min-h-[41px] w-full !px-3.5 !text-[13px]"
                  onValueChange={setSourceRawTableId}
                  onOpenChange={setSourcePickerOpen}
                />
              </div>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 bg-surface" />
      </DialogBody>

      <div className="grid h-11 flex-shrink-0 grid-cols-2 border-t border-border-subtle bg-surface">
        <button
          type="button"
          disabled={busy}
          onClick={() => onOpenChange(false)}
          className="inline-flex h-full items-center justify-center border-r border-border-subtle text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          data-testid="result-table-create-confirm"
          className="ui-accent-cell h-full !text-[13px]"
        >
          {busy ? t('common.saving') : t('data.resultTables.create.confirm')}
        </button>
      </div>
    </Dialog>
  );
}
