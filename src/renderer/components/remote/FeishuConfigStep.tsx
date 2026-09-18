/**
 * FeishuConfigStep — Feishu/Lark app credentials and DM policy configuration
 */

import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { Input } from '../ui/input';

interface Props {
  feishuAppId: string;
  feishuAppSecret: string;
  feishuDmPolicy: string;
  onAppIdChange: (value: string) => void;
  onAppSecretChange: (value: string) => void;
  onDmPolicyChange: (value: string) => void;
}

export function FeishuConfigStep({
  feishuAppId,
  feishuAppSecret,
  feishuDmPolicy,
  onAppIdChange,
  onAppSecretChange,
  onDmPolicyChange,
}: Props) {
  const { t } = useTranslation();

  const dmPolicies = [
    {
      value: 'pairing',
      label: t('remote.policyPairing'),
      desc: t('remote.policyPairingDesc'),
    },
    {
      value: 'allowlist',
      label: t('remote.policyAllowlist'),
      desc: t('remote.policyAllowlistDesc'),
    },
    {
      value: 'open',
      label: t('remote.policyOpen'),
      desc: t('remote.policyOpenDesc'),
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-medium text-text-primary mb-1">{t('remote.feishuTitle')}</h3>
        <p className="text-sm text-text-secondary">{t('remote.feishuDesc')}</p>
      </div>

      <div className="grid gap-3">
        <div>
          <label
            htmlFor="feishu-app-id"
            className="block text-sm font-medium text-text-secondary mb-2"
          >
            App ID
          </label>
          <Input
            id="feishu-app-id"
            type="text"
            value={feishuAppId}
            onChange={(e) => onAppIdChange(e.target.value)}
            className="h-auto bg-surface-hover px-3 py-2.5"
            placeholder="cli_xxxxxxxxxxxxxxxx"
          />
        </div>

        <div>
          <label
            htmlFor="feishu-app-secret"
            className="block text-sm font-medium text-text-secondary mb-2"
          >
            App Secret
          </label>
          <Input
            id="feishu-app-secret"
            type="password"
            value={feishuAppSecret}
            onChange={(e) => onAppSecretChange(e.target.value)}
            className="h-auto bg-surface-hover px-3 py-2.5"
            placeholder="••••••••••••••••"
          />
        </div>

        <div>
          <span
            id="feishu-dm-policy-label"
            className="block text-sm font-medium text-text-secondary mb-2"
          >
            {t('remote.dmPolicy')}
          </span>
          <div
            role="radiogroup"
            aria-labelledby="feishu-dm-policy-label"
            className="grid grid-cols-3 gap-2"
          >
            {dmPolicies.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={feishuDmPolicy === option.value}
                onClick={() => onDmPolicyChange(option.value)}
                className={`p-3 rounded-lg border text-left transition-all ${
                  feishuDmPolicy === option.value
                    ? 'border-accent bg-accent-muted'
                    : 'border-border hover:border-accent/50'
                }`}
              >
                <div className="font-medium text-text-primary text-sm">{option.label}</div>
                <div className="text-xs text-text-muted mt-0.5">{option.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <a
        href="https://open.feishu.cn/app"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-sm text-accent hover:underline"
      >
        <ExternalLink className="w-4 h-4" />
        {t('remote.openFeishu')}
      </a>
    </div>
  );
}
