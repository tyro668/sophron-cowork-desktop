import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Plus, X } from 'lucide-react';
import {
  detectSecretCandidates,
  maskSecret,
  replaceSecrets,
  type SecretCandidate,
} from '../../../shared/secrets';
import type { ScriptSecretInfo } from '../../../shared/automation/script-package';
import { Dialog } from '../ui/dialog';

const NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

export type SecretOwnerKind = 'script' | 'normalizer';

function secretsApi() {
  return window.electronAPI.automation.secrets;
}

/** 密钥: names of the stored secrets (values are write-only), add and delete. */
export function SecretsEditor({
  kind,
  ownerId,
  refreshKey,
  disabled,
}: {
  kind: SecretOwnerKind;
  ownerId: string | null | undefined;
  /** Bump to reload after a generation stored new secrets. */
  refreshKey?: unknown;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ScriptSecretInfo[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ownerId) return setItems([]);
    try {
      setItems(await secretsApi().list(kind, ownerId));
    } catch {
      setItems([]);
    }
  }, [kind, ownerId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (!ownerId)
    return <span className="ui-flush-text text-text-muted">{t('secrets.pendingHint')}</span>;

  const save = async () => {
    const trimmed = name.trim().toUpperCase();
    if (!NAME_PATTERN.test(trimmed)) return setError(t('secrets.nameInvalid'));
    if (!value.trim()) return;
    try {
      await secretsApi().set(kind, ownerId, trimmed, value);
      setAdding(false);
      setName('');
      setValue('');
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      className="flex min-h-[35px] min-w-0 flex-1 flex-col justify-center gap-1 px-2.5 py-1.5"
      title={t('secrets.hint')}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {items.length === 0 && !adding ? (
          <span className="text-[12px] text-text-muted">{t('secrets.none')}</span>
        ) : null}
        {items.map((item) => (
          <span
            key={item.name}
            data-testid="secret-chip"
            className="inline-flex h-6 items-center gap-1 rounded border border-border-subtle bg-surface px-2 font-mono text-[11.5px] text-text-primary"
          >
            <KeyRound className="h-3 w-3 text-text-muted" />
            {item.name}
            <button
              type="button"
              disabled={disabled}
              aria-label={t('secrets.delete', { name: item.name })}
              onClick={() => void secretsApi().delete(kind, ownerId, item.name).then(load)}
              className="text-text-muted hover:text-error disabled:opacity-50"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {adding ? (
          <span className="inline-flex items-center gap-1">
            <input
              value={name}
              onChange={(event) => setName(event.target.value.toUpperCase())}
              placeholder={t('secrets.name')}
              aria-label={t('secrets.name')}
              className="h-6 w-[120px] rounded border border-border-subtle bg-surface px-1.5 font-mono text-[11.5px] outline-none"
            />
            <input
              type="password"
              autoComplete="off"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={t('secrets.value')}
              aria-label={t('secrets.value')}
              className="h-6 w-[180px] rounded border border-border-subtle bg-surface px-1.5 text-[11.5px] outline-none"
            />
            <button
              type="button"
              onClick={() => void save()}
              className="inline-flex h-6 items-center rounded border border-accent/25 px-2 text-[11.5px] font-medium text-accent hover:bg-accent-muted"
            >
              {t('secrets.save')}
            </button>
            <button
              type="button"
              aria-label={t('common.cancel')}
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
              className="text-text-muted hover:text-text-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setAdding(true)}
            className="inline-flex h-6 items-center gap-1 rounded border border-accent/25 bg-surface px-2 text-[11.5px] font-medium text-accent transition-colors hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3 w-3" />
            {t('secrets.add')}
          </button>
        )}
      </div>
      {error ? <span className="text-[11.5px] text-error">{error}</span> : null}
    </div>
  );
}

export interface SecretReviewResult {
  /** Text with the confirmed secrets replaced by ${SECRET:NAME}. */
  text: string;
  secrets: Array<{ name: string; value: string }>;
  secretsReviewed: true;
}

/**
 * Before generating: key-like strings in the rule (and quotes) are shown for confirmation.
 * Resolves null when cancelled; with no candidates it resolves immediately.
 */
export function useSecretReview(): {
  review: (text: string, extraTexts?: string[]) => Promise<SecretReviewResult | null>;
  dialog: ReactNode;
} {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Array<SecretCandidate & { keep: boolean }>>([]);
  const resolver = useRef<((result: SecretReviewResult | null) => void) | null>(null);
  const textRef = useRef('');

  const close = (result: SecretReviewResult | null) => {
    resolver.current?.(result);
    resolver.current = null;
    setRows([]);
  };

  const review = useCallback((text: string, extraTexts: string[] = []) => {
    const candidates = detectSecretCandidates([text, ...extraTexts].join('\n'));
    if (candidates.length === 0)
      return Promise.resolve<SecretReviewResult>({ text, secrets: [], secretsReviewed: true });
    textRef.current = text;
    setRows(candidates.map((item) => ({ ...item, keep: true })));
    return new Promise<SecretReviewResult | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const names = rows.filter((row) => row.keep).map((row) => row.name);
  const invalid =
    rows.some((row) => row.keep && !NAME_PATTERN.test(row.name)) ||
    new Set(names).size !== names.length;

  const dialog = (
    <Dialog
      open={rows.length > 0}
      onOpenChange={(open) => !open && close(null)}
      ariaLabel={t('secrets.reviewTitle')}
      className="w-full max-w-[520px]"
    >
      <div className="flex flex-col gap-3" data-testid="secret-review-dialog">
        <div className="text-[14px] font-semibold text-text-primary">
          {t('secrets.reviewTitle')}
        </div>
        <p className="text-[12.5px] leading-5 text-text-secondary">{t('secrets.reviewDesc')}</p>
        <div className="flex flex-col divide-y divide-border-subtle rounded border border-border-subtle">
          {rows.map((row, index) => (
            <label key={row.value} className="flex items-center gap-2 px-2.5 py-2">
              <input
                type="checkbox"
                checked={row.keep}
                onChange={(event) =>
                  setRows((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, keep: event.target.checked } : item
                    )
                  )
                }
              />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-secondary">
                {maskSecret(row.value)}
              </span>
              <input
                value={row.name}
                disabled={!row.keep}
                aria-label={t('secrets.name')}
                onChange={(event) =>
                  setRows((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, name: event.target.value.toUpperCase() } : item
                    )
                  )
                }
                className="h-7 w-[150px] rounded border border-border-subtle bg-surface px-1.5 font-mono text-[12px] outline-none disabled:opacity-50"
              />
            </label>
          ))}
        </div>
        {invalid ? (
          <span className="text-[11.5px] text-error">{t('secrets.nameInvalid')}</span>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => close(null)}
            className="h-8 rounded border border-border-subtle px-3 text-[12.5px] text-text-secondary hover:bg-surface-hover"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={invalid}
            data-autofocus
            onClick={() => {
              const kept = rows
                .filter((row) => row.keep)
                .map(({ name, value }) => ({ name, value }));
              close({
                text: replaceSecrets(textRef.current, kept),
                secrets: kept,
                secretsReviewed: true,
              });
            }}
            className="h-8 rounded bg-accent px-3 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {rows.some((row) => row.keep) ? t('secrets.reviewConfirm') : t('secrets.reviewKeep')}
          </button>
        </div>
      </div>
    </Dialog>
  );
  return { review, dialog };
}
