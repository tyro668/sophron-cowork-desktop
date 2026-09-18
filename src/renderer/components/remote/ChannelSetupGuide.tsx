import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Info,
  ListChecks,
  MapPin,
  ShieldAlert,
} from 'lucide-react';
import type { ManualRemoteChannelType as RemoteChannelType } from './types';

interface Props {
  channelType: RemoteChannelType;
  useLongConnection: boolean;
  webhookUrl: string | null;
  onCopy: (value: string) => void;
}

interface StepDefinition {
  id: string;
  copyValue?: string;
  copyLabelKey?: string;
}

const platformUrl: Record<RemoteChannelType, string> = {
  feishu: 'https://open.feishu.cn/app',
  dingtalk: 'https://open-dev.dingtalk.com/',
  wecom: 'https://work.weixin.qq.com/wework_admin/frame#apps',
};

export const FEISHU_PERMISSION_SCOPES = [
  'im:resource',
  'im:message',
  'im:message:send_as_bot',
  'im:message.group_at_msg:readonly',
  'im:message.p2p_msg:readonly',
  'contact:user.base:readonly',
];

export const FEISHU_MESSAGE_EVENT = 'im.message.receive_v1';

const baseSteps: Record<RemoteChannelType, StepDefinition[]> = {
  feishu: [
    { id: 'createApp' },
    { id: 'addBot' },
    { id: 'credentials' },
    {
      id: 'permissions',
      copyValue: FEISHU_PERMISSION_SCOPES.join('\n'),
      copyLabelKey: 'remote.setupGuide.permissionsLabel',
    },
    {
      id: 'eventsLong',
      copyValue: FEISHU_MESSAGE_EVENT,
      copyLabelKey: 'remote.setupGuide.eventLabel',
    },
    { id: 'publish' },
    { id: 'finish' },
  ],
  dingtalk: [
    { id: 'createApp' },
    { id: 'addBot' },
    { id: 'credentials' },
    { id: 'publish' },
    { id: 'finish' },
    { id: 'test' },
  ],
  wecom: [
    { id: 'prerequisite' },
    { id: 'createBot' },
    { id: 'longConnection' },
    { id: 'credentials' },
    { id: 'finish' },
    { id: 'test' },
  ],
};

export function ChannelSetupGuide({ channelType, useLongConnection, webhookUrl, onCopy }: Props) {
  const { t } = useTranslation();
  const [copiedStep, setCopiedStep] = useState<string | null>(null);

  const steps = baseSteps[channelType].map((step) => {
    if (channelType === 'feishu' && step.id === 'eventsLong' && !useLongConnection) {
      return {
        id: 'eventsWebhook',
        copyValue: webhookUrl || undefined,
        copyLabelKey: webhookUrl ? 'remote.setupGuide.webhookUrlLabel' : undefined,
      };
    }

    if (channelType === 'dingtalk' && step.id === 'addBot' && !useLongConnection) {
      return {
        id: 'addBotWebhook',
        copyValue: webhookUrl || undefined,
        copyLabelKey: webhookUrl ? 'remote.setupGuide.webhookUrlLabel' : undefined,
      };
    }

    if (channelType === 'wecom' && step.id === 'longConnection' && !useLongConnection) {
      return {
        id: 'webhookConnection',
        copyValue: webhookUrl || undefined,
        copyLabelKey: webhookUrl ? 'remote.setupGuide.webhookUrlLabel' : undefined,
      };
    }

    if (channelType === 'wecom' && step.id === 'credentials' && !useLongConnection) {
      return { id: 'webhookCredentials' };
    }

    return step;
  });

  function copyStepValue(step: StepDefinition) {
    if (!step.copyValue) return;
    onCopy(step.copyValue);
    setCopiedStep(step.id);
    setTimeout(() => setCopiedStep(null), 1800);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-accent" />
            <h4 className="text-sm font-semibold text-text-primary">
              {t('remote.setupGuide.title')}
            </h4>
          </div>
          <p className="mt-1.5 max-w-3xl text-xs leading-5 text-text-muted">
            {t(`remote.setupGuide.intro.${channelType}`)}
          </p>
        </div>
        <a
          href={platformUrl[channelType]}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border-subtle bg-surface px-3 py-2 text-xs font-medium text-accent transition-colors hover:bg-accent-muted"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t(`remote.openPlatform.${channelType}`)}
        </a>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-accent/20 bg-accent-muted p-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div>
          <div className="text-xs font-semibold text-text-primary">
            {t('remote.setupGuide.beforeStart')}
          </div>
          <p className="mt-1 text-[11px] leading-5 text-text-muted">
            {t(`remote.setupGuide.prerequisite.${channelType}`)}
          </p>
        </div>
      </div>

      <ol className="space-y-3">
        {steps.map((step, index) => {
          const keyBase = `remote.setupGuide.steps.${channelType}.${step.id}`;
          const isCopied = copiedStep === step.id;

          return (
            <li key={step.id} className="relative grid grid-cols-[30px_minmax(0,1fr)] gap-3">
              {index < steps.length - 1 && (
                <span className="absolute bottom-[-14px] left-[14px] top-7 w-px bg-border" />
              )}
              <span className="relative z-10 flex h-7 w-7 items-center justify-center rounded-full border border-accent/30 bg-accent-muted text-xs font-semibold text-accent">
                {index + 1}
              </span>

              <div className="rounded-xl border border-border-subtle bg-surface p-3.5">
                <h5 className="text-xs font-semibold text-text-primary">{t(`${keyBase}.title`)}</h5>
                <p className="mt-1.5 text-[11px] leading-5 text-text-secondary">
                  {t(`${keyBase}.description`)}
                </p>

                <div className="mt-2 flex items-start gap-2 rounded-lg bg-surface-hover/55 px-2.5 py-2">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                  <div className="min-w-0">
                    <div className="text-[10px] font-medium text-text-muted">
                      {t('remote.setupGuide.platformPath')}
                    </div>
                    <div className="mt-0.5 break-words text-[11px] font-medium leading-4 text-text-primary">
                      {t(`${keyBase}.path`)}
                    </div>
                  </div>
                </div>

                {step.copyValue && (
                  <div className="mt-2 overflow-hidden rounded-lg border border-border-subtle bg-surface-muted">
                    <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-2.5 py-1.5">
                      <span className="text-[10px] font-medium text-text-muted">
                        {step.copyLabelKey ? t(step.copyLabelKey) : t('remote.setupGuide.copy')}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyStepValue(step)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-accent transition-colors hover:bg-accent-muted"
                      >
                        {isCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {isCopied ? t('remote.setupGuide.copied') : t('remote.setupGuide.copy')}
                      </button>
                    </div>
                    <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all px-3 py-2 text-[11px] leading-5 text-text-secondary">
                      {step.copyValue}
                    </pre>
                  </div>
                )}

                <div className="mt-2 flex items-start gap-1.5 text-[10px] leading-4 text-success">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    {t('remote.setupGuide.completeWhen', {
                      result: t(`${keyBase}.result`),
                    })}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="rounded-xl border border-success/25 bg-success/5 p-3.5">
        <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
          <CheckCircle2 className="h-4 w-4 text-success" />
          {t('remote.setupGuide.testTitle')}
        </div>
        <p className="mt-1.5 text-[11px] leading-5 text-text-secondary">
          {t(`remote.setupGuide.test.${channelType}`)}
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/5 p-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p className="text-[11px] leading-5 text-text-secondary">
          {t(`remote.setupGuide.warning.${channelType}`)}
        </p>
      </div>
    </div>
  );
}
