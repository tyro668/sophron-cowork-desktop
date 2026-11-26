import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dataClient } from '../../../features/data/api/data-client';
import type { DataRawTable } from '../../../types';
import {
  Button,
  cn,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '../../ui';
import { RawTableSelect, RESULT_TABLE_INPUT_CHOICES_LIMIT } from '../shared';

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
  const [rawTables, setRawTables] = useState<DataRawTable[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(suggestedName);
    setPurpose('pipeline');
    setSourceRawTableId('');
    if (!dataClient.has('getDashboard')) return;
    let cancelled = false;
    setSourcesLoading(true);
    void dataClient
      .getDashboard({
        includeSummary: false,
        includePipelines: false,
        includeRawTables: true,
        includeResultTables: false,
        rawTableOffset: 0,
        rawTableLimit: RESULT_TABLE_INPUT_CHOICES_LIMIT,
        rawTableSourceKind: 'all',
      })
      .then((dashboard) => {
        if (!cancelled) setRawTables(dashboard.rawTables);
      })
      .catch(() => {
        if (!cancelled) setRawTables([]);
      })
      .finally(() => {
        if (!cancelled) setSourcesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, suggestedName]);

  const trimmedName = name.trim();
  const canSubmit =
    Boolean(trimmedName) && !busy && (purpose === 'pipeline' || Boolean(sourceRawTableId));
  const submit = () => {
    if (canSubmit) {
      onSubmit({
        name: trimmedName,
        sourceRawTableId: purpose === 'copy' ? sourceRawTableId : null,
      });
    }
  };

  const purposeOptionClass = (value: 'pipeline' | 'copy') =>
    cn(
      'flex cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-1.5 text-[13px] transition-colors',
      purpose === value
        ? 'border-accent/40 bg-accent-muted text-text-primary'
        : 'border-border-subtle text-text-secondary hover:bg-surface-hover/40'
    );

  const sourceOptions = rawTables.map((rawTable) => ({
    value: rawTable.id,
    label: rawTable.name,
  }));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      ariaLabel={t('data.resultTables.create.title')}
      className="ui-dialog-pad max-w-md"
    >
      <DialogHeader>
        <DialogTitle>{t('data.resultTables.create.title')}</DialogTitle>
      </DialogHeader>
      <DialogBody className="ui-group bg-surface">
        <div className="ui-form-row">
          <span className="ui-form-label items-center">{t('data.resultTables.create.name')}</span>
          <div className="ui-form-value">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('data.resultTables.create.namePlaceholder')}
              data-autofocus
              className="h-8 text-[13px]"
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
            />
          </div>
        </div>
        <div className="ui-form-row">
          <span className="ui-form-label items-start">
            <span className="mt-2">{t('data.resultTables.create.purpose')}</span>
          </span>
          <div className="ui-form-value gap-1.5">
            <label className={purposeOptionClass('pipeline')}>
              <input
                type="radio"
                name="result-table-purpose"
                checked={purpose === 'pipeline'}
                onChange={() => setPurpose('pipeline')}
                className="mt-0.5 h-3.5 w-3.5 accent-accent"
              />
              <span className="grid gap-0.5">
                <span className="font-medium">{t('data.resultTables.create.purposePipeline')}</span>
                <span className="text-xs text-text-muted">
                  {t('data.resultTables.create.purposePipelineDesc')}
                </span>
              </span>
            </label>
            <label className={purposeOptionClass('copy')}>
              <input
                type="radio"
                name="result-table-purpose"
                checked={purpose === 'copy'}
                onChange={() => setPurpose('copy')}
                className="mt-0.5 h-3.5 w-3.5 accent-accent"
              />
              <span className="grid gap-0.5">
                <span className="font-medium">{t('data.resultTables.create.purposeCopy')}</span>
                <span className="text-xs text-text-muted">
                  {t('data.resultTables.create.purposeCopyDesc')}
                </span>
              </span>
            </label>
          </div>
        </div>
        {purpose === 'copy' && (
          <div className="ui-form-row">
            <span className="ui-form-label items-center">
              {t('data.resultTables.create.source')}
            </span>
            <div className="ui-form-value">
              <RawTableSelect
                value={sourceRawTableId}
                options={[
                  {
                    value: '',
                    label: sourcesLoading
                      ? t('data.resultTables.editor.loadingRawTables')
                      : t('data.resultTables.create.selectSource'),
                  },
                  ...sourceOptions,
                ]}
                disabled={busy || sourcesLoading}
                onChange={setSourceRawTableId}
              />
            </div>
          </div>
        )}
      </DialogBody>
      <DialogFooter className="ui-footer-split">
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" disabled={!canSubmit} onClick={submit}>
          {busy ? t('common.saving') : t('data.resultTables.create.confirm')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
