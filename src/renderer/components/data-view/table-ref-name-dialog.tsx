/**
 * Confirm / edit the reported name for newly picked 云连接 table refs.
 * After this step the name is immutable; users delete and re-add to rename.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

import type { CloudConnectionGroup } from '../../../shared/contracts';
import { suggestReportName } from '../../../shared/contracts';
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from '../ui';
import type { TableRefPick } from './table-ref-picker-dialog';

export type TableRefNameDraft = TableRefPick & { displayName?: string; reportName?: string };

export function validateReportNames(names: string[], used: Iterable<string>): Array<string | null> {
  const usedSet = new Set([...used].map((name) => name.trim()).filter(Boolean));
  const seen = new Map<string, number>();
  return names.map((raw) => {
    const name = raw.trim();
    if (!name) return 'required';
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    if (usedSet.has(name) || count > 1) return 'duplicate';
    return null;
  });
}

export function initialReportNames(picks: TableRefNameDraft[], used: Iterable<string>): string[] {
  const taken = new Set([...used].map((name) => name.trim()).filter(Boolean));
  return picks.map((pick) => {
    const suggested = suggestReportName(pick.reportName || pick.displayName || pick.tableId, taken);
    taken.add(suggested);
    return suggested;
  });
}

export function TableRefNameDialog({
  open,
  group,
  picks,
  busy = false,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  group: CloudConnectionGroup;
  picks: TableRefNameDraft[];
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (refs: TableRefNameDraft[]) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const used = useMemo(() => group.tables.map((table) => table.reportName), [group.tables]);
  const [names, setNames] = useState<string[]>(() => initialReportNames(picks, used));
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (open) {
      setNames(initialReportNames(picks, used));
      setSubmitted(false);
    }
  }, [open, picks, used]);

  const errors = useMemo(
    () => (submitted ? validateReportNames(names, used) : names.map(() => null)),
    [names, submitted, used]
  );
  const invalid = validateReportNames(names, used).some(Boolean);

  const errorText = (code: string | null) => {
    if (code === 'required') return t('cloudConnection.ds.nameRequired');
    if (code === 'duplicate') return t('cloudConnection.ds.nameDuplicate');
    return null;
  };

  const handleConfirm = async () => {
    setSubmitted(true);
    if (invalid) return;
    const refs = picks.map((pick, index) => ({
      ...pick,
      reportName: names[index]?.trim() ?? '',
    }));
    const ok = await onConfirm(refs);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      ariaLabel={t('cloudConnection.ds.confirmNameTitle')}
      className="flex w-[min(32rem,92vw)] max-w-[min(32rem,92vw)] flex-col gap-0 overflow-hidden rounded-none border-border-subtle p-0 shadow-elevated"
    >
      <div data-testid="cloud-connection-confirm-name">
        <DialogHeader className="flex h-12 flex-shrink-0 flex-row items-center justify-between border-b border-border-subtle px-4 py-0">
          <DialogTitle className="text-[14px] font-semibold text-text-primary">
            {t('cloudConnection.ds.confirmNameTitle')}
          </DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            className="text-text-muted hover:bg-accent-muted hover:text-accent"
            title={t('common.close')}
            aria-label={t('common.close')}
            data-testid="cloud-connection-confirm-name-close"
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>
        <DialogBody className="space-y-3 px-4 py-3">
          <p className="text-[13px] leading-5 text-text-secondary">
            {t('cloudConnection.ds.confirmNameDesc')}
          </p>
          <ul className="space-y-3">
            {picks.map((pick, index) => (
              <li key={`${pick.kind}:${pick.tableId}`} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-[12px] text-text-muted">
                  <span className="min-w-0 truncate">{pick.displayName || pick.tableId}</span>
                  <span className="flex-shrink-0">
                    {pick.kind === 'result'
                      ? t('cloudConnection.ds.refKindResult')
                      : t('cloudConnection.ds.refKindRaw')}
                  </span>
                </div>
                <input
                  value={names[index] ?? ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    setNames((current) => current.map((name, i) => (i === index ? value : name)));
                  }}
                  className="h-8 w-full border border-border-subtle bg-background px-2 text-[13px] text-text-primary outline-none focus:border-accent"
                  data-testid={`cloud-connection-confirm-name-input-${index}`}
                  aria-invalid={Boolean(errors[index])}
                  aria-label={t('cloudConnection.ds.reportName')}
                />
                {errors[index] && (
                  <p className="text-[12px] text-error" role="alert">
                    {errorText(errors[index])}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </DialogBody>
        <DialogFooter className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
          <Button variant="secondary" className="rounded-none" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            className="rounded-none"
            data-testid="cloud-connection-confirm-name-submit"
            disabled={busy}
            loading={busy}
            onClick={() => void handleConfirm()}
          >
            {t('cloudConnection.ds.confirmNameSubmit')}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
