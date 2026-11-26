import { AlertTriangle, Info, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface CommonProviderSetupView {
  id: string;
  name: string;
  protocolLabel: string;
  baseUrl: string;
  exampleModel: string;
  notes: string;
  isDetected?: boolean;
}

interface GuidanceInlineHintProps {
  text?: string;
  tone?: 'info' | 'warning';
}

export function GuidanceInlineHint({ text, tone = 'info' }: GuidanceInlineHintProps) {
  if (!text) {
    return null;
  }

  const Icon = tone === 'warning' ? AlertTriangle : Info;
  const toneClass =
    tone === 'warning'
      ? 'border-warning/30 bg-warning/10 text-warning'
      : 'border-border-subtle bg-surface text-text-secondary';

  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${toneClass}`}>
      <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <span className="leading-5">{text}</span>
    </div>
  );
}

interface CommonProviderSetupsCardProps {
  setups: CommonProviderSetupView[];
  onApplySetup: (setupId: string) => void;
  flush?: boolean;
}

export function CommonProviderSetupsCard({
  setups,
  onApplySetup,
  flush = false,
}: CommonProviderSetupsCardProps) {
  const { t } = useTranslation();

  if (setups.length === 0) {
    return null;
  }

  if (flush) {
    return (
      <details className="bg-surface">
        <summary className="flex h-9 cursor-pointer list-none items-center justify-between gap-3 px-3 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-hover">
          <span className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            {t('api.guidance.commonSetupsTitle')}
          </span>
          <span className="text-[11.5px] font-normal text-text-muted">
            {t('api.guidance.commonSetupsHint')}
          </span>
        </summary>
        <div className="overflow-x-auto border-t border-border-subtle">
          <table className="min-w-full border-collapse text-left text-xs text-text-secondary">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-text-muted">
                <th className="h-8 border-r border-border-subtle px-2.5 font-medium">
                  {t('api.guidance.columns.service')}
                </th>
                <th className="h-8 border-r border-border-subtle px-2.5 font-medium">
                  {t('api.guidance.columns.protocol')}
                </th>
                <th className="h-8 border-r border-border-subtle px-2.5 font-medium">
                  {t('api.guidance.columns.baseUrl')}
                </th>
                <th className="h-8 border-r border-border-subtle px-2.5 font-medium">
                  {t('api.guidance.columns.model')}
                </th>
                <th className="h-8 border-r border-border-subtle px-2.5 font-medium">
                  {t('api.guidance.columns.notes')}
                </th>
                <th className="h-8 px-2.5 text-center font-medium">
                  {t('api.guidance.columns.action')}
                </th>
              </tr>
            </thead>
            <tbody>
              {setups.map((setup) => (
                <tr
                  key={setup.id}
                  className={`border-b border-border-subtle last:border-b-0 ${
                    setup.isDetected
                      ? 'bg-accent-muted/70 text-text-primary'
                      : 'text-text-secondary hover:bg-surface-hover/60'
                  }`}
                >
                  <td className="border-r border-border-subtle px-2.5 py-2 font-medium">
                    <div className="flex items-center gap-1.5">
                      <span>{setup.name}</span>
                      {setup.isDetected && (
                        <span className="rounded bg-accent-muted px-1.5 py-0.5 text-[10px] font-medium text-accent">
                          {t('api.guidance.detectedBadge')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="border-r border-border-subtle px-2.5 py-2">
                    {setup.protocolLabel}
                  </td>
                  <td className="border-r border-border-subtle px-2.5 py-2 font-mono text-[11px] text-text-secondary">
                    {setup.baseUrl}
                  </td>
                  <td className="border-r border-border-subtle px-2.5 py-2 font-mono text-[11px] text-text-secondary">
                    {setup.exampleModel}
                  </td>
                  <td className="border-r border-border-subtle px-2.5 py-2 leading-5">
                    {setup.notes}
                  </td>
                  <td className="p-0 text-center">
                    <button
                      type="button"
                      onClick={() => onApplySetup(setup.id)}
                      className="ui-accent-cell h-9 w-full"
                    >
                      {t('api.guidance.apply')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    );
  }

  return (
    <details className="rounded-[1.5rem] border border-border-subtle bg-surface px-4 py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-text-primary">
        <span className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          {t('api.guidance.commonSetupsTitle')}
        </span>
        <span className="text-xs font-normal text-text-muted">
          {t('api.guidance.commonSetupsHint')}
        </span>
      </summary>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-xs text-text-secondary">
          <thead>
            <tr className="border-b border-border-subtle text-text-muted">
              <th className="px-2 py-2 font-medium">{t('api.guidance.columns.service')}</th>
              <th className="px-2 py-2 font-medium">{t('api.guidance.columns.protocol')}</th>
              <th className="px-2 py-2 font-medium">{t('api.guidance.columns.baseUrl')}</th>
              <th className="px-2 py-2 font-medium">{t('api.guidance.columns.model')}</th>
              <th className="px-2 py-2 font-medium">{t('api.guidance.columns.notes')}</th>
              <th className="px-2 py-2 font-medium text-right">
                {t('api.guidance.columns.action')}
              </th>
            </tr>
          </thead>
          <tbody>
            {setups.map((setup) => (
              <tr
                key={setup.id}
                className={
                  setup.isDetected ? 'bg-accent-muted text-text-primary' : 'text-text-secondary'
                }
              >
                <td className="px-2 py-3 font-medium">
                  <div className="flex items-center gap-2">
                    <span>{setup.name}</span>
                    {setup.isDetected && (
                      <span className="rounded-full bg-accent-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-accent">
                        {t('api.guidance.detectedBadge')}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-2 py-3">{setup.protocolLabel}</td>
                <td className="px-2 py-3 font-mono text-[11px] text-text-secondary">
                  {setup.baseUrl}
                </td>
                <td className="px-2 py-3 font-mono text-[11px] text-text-secondary">
                  {setup.exampleModel}
                </td>
                <td className="px-2 py-3 leading-5">{setup.notes}</td>
                <td className="px-2 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onApplySetup(setup.id)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-surface-hover"
                  >
                    {t('api.guidance.apply')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
