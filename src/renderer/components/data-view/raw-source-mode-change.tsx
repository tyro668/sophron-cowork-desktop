/**
 * Inline build-mode change for edit pages (source detail, raw-table editor).
 * Picking another 组织方式 keeps the user on the page: the new mode's options render in place
 * and the header shows 取消 / 保存. 保存 opens the existing delete confirmation, then rebuilds;
 * 取消 (or picking the original mode again) restores the original view.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, X } from 'lucide-react';
import type { DataRawSource, DataRawSourceBuildMode, DataRawSourceCreateResult } from '../../types';
import { RawSourceWizard, type RawSourceWizardControls } from './raw-source-wizard';

const cellClass =
  'inline-flex h-full items-center justify-center gap-1.5 whitespace-nowrap border-l border-border-subtle px-4 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

export interface InlineModeChange {
  /** Target mode while a change is pending, else null. */
  pending: DataRawSourceBuildMode | null;
  /** Value for the 组织方式 select. */
  value: DataRawSourceBuildMode | undefined;
  choose: (mode: DataRawSourceBuildMode) => void;
  cancel: () => void;
  /** Hint banner + the new mode's options; null when nothing is pending. */
  editor: ReactNode;
  /** 取消 / 保存 header cells; null when nothing is pending. */
  actions: ReactNode;
}

export function useInlineModeChange(
  source: DataRawSource | null | undefined,
  onSaved: (result: DataRawSourceCreateResult) => void
): InlineModeChange {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    String(t(`data.rawSources.${key}`, options ?? {}));
  const [pending, setPending] = useState<DataRawSourceBuildMode | null>(null);
  const [controls, setControls] = useState<RawSourceWizardControls | null>(null);
  const cancel = useCallback(() => {
    setPending(null);
    setControls(null);
  }, []);
  const choose = useCallback(
    (mode: DataRawSourceBuildMode) => {
      if (!source || mode === source.buildMode) cancel();
      else setPending(mode);
    },
    [cancel, source]
  );
  const rebuild = useMemo(
    () => (source && pending ? { source, buildMode: pending } : undefined),
    [pending, source]
  );
  const noop = useCallback(() => undefined, []);

  const editor =
    source && rebuild ? (
      <div data-testid="raw-source-mode-change">
        <div
          className="mb-2 flex items-center gap-2 rounded-md border border-warning/30 bg-warning/[0.08] px-3 py-2 text-[12.5px] text-text-primary"
          data-testid="raw-source-mode-change-hint"
        >
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-warning" />
          {tr('modeChange.hint', {
            from: tr(`modes.${source.buildMode}`),
            to: tr(`modes.${rebuild.buildMode}`),
          })}
        </div>
        <RawSourceWizard
          key={source.id}
          embedded
          rebuild={rebuild}
          onBack={cancel}
          onOpenData={noop}
          onOpenCloud={noop}
          onControls={setControls}
          onCreated={(result) => {
            cancel();
            onSaved(result);
          }}
        />
      </div>
    ) : null;

  const actions = pending ? (
    <>
      <button
        type="button"
        onClick={cancel}
        disabled={controls?.saving}
        data-testid="raw-source-mode-cancel"
        className={`${cellClass} text-text-secondary hover:bg-accent-muted hover:text-accent`}
      >
        <X className="h-3.5 w-3.5" />
        {t('common.cancel')}
      </button>
      <button
        type="button"
        onClick={() => controls?.save()}
        disabled={!controls?.canSave}
        data-testid="raw-source-mode-save"
        className={`${cellClass} text-accent hover:bg-accent-muted`}
      >
        <Check className="h-3.5 w-3.5" />
        {controls?.saving ? t('common.saving') : t('common.save')}
      </button>
    </>
  ) : null;

  return { pending, value: pending ?? source?.buildMode, choose, cancel, editor, actions };
}
