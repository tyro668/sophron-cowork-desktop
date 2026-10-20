import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIPC } from '../hooks/useIPC';
import type { PermissionRequest } from '../types';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Info,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from './ui/badge';
import { isReadOnlyShellCommand } from '../../shared/read-only-command';
import { Button } from './ui/button';
import { Dialog, DialogTitle } from './ui/dialog';

interface PermissionDialogProps {
  permission: PermissionRequest;
}

const HIGH_RISK_TOOL_HINTS = ['bash', 'command', 'execute', 'write', 'edit', 'delete', 'remove'];

const COMMAND_INPUT_KEYS = ['command', 'cmd', 'script', 'shell_command'];

function isHighRiskTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return HIGH_RISK_TOOL_HINTS.some((hint) => normalized.includes(hint));
}

function getCommandInput(input: Record<string, unknown>): string | null {
  for (const key of COMMAND_INPUT_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
}

function formatInputPreview(input: Record<string, unknown>): { text: string; isCommand: boolean } {
  const command = getCommandInput(input);
  if (command) {
    return { text: command, isCommand: true };
  }

  return {
    text: JSON.stringify(input, null, 2),
    isCommand: false,
  };
}

export function PermissionDialog({ permission }: PermissionDialogProps) {
  const { t } = useTranslation();
  const { respondToPermission } = useIPC();
  const [rememberTool, setRememberTool] = useState(false);
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);

  const preview = formatInputPreview(permission.input);
  // Wording only: read-only commands still need the user's approval.
  const isReadOnlyCommand = preview.isCommand && isReadOnlyShellCommand(preview.text);
  const isHighRisk = !isReadOnlyCommand && isHighRiskTool(permission.toolName);
  const singleLinePreview = preview.text.replace(/\s+/g, ' ');
  const previewLabel = preview.isCommand
    ? t('permission.commandPreview')
    : t('permission.inputPreview');

  const allowResult = rememberTool ? 'allow_always' : 'allow';
  const deny = () => respondToPermission(permission.toolUseId, 'deny');
  const risk: 'read' | 'write' | 'normal' = isReadOnlyCommand
    ? 'read'
    : isHighRisk
      ? 'write'
      : 'normal';
  const riskTile =
    risk === 'write'
      ? 'bg-warning/10 text-warning'
      : risk === 'read'
        ? 'bg-surface-active text-text-secondary'
        : 'bg-accent-muted text-accent';
  const RiskIcon = risk === 'read' ? ShieldCheck : ShieldAlert;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Esc / overlay dismissal counts as a denial; Enter never auto-allows.
        if (!open) deny();
      }}
      closeOnOverlayClick={false}
      ariaLabelledBy="permission-dialog-title"
      overlayClassName="animate-fade-in bg-black/25 p-5"
      className="max-h-[calc(100vh-40px)] max-w-[720px] animate-slide-up gap-0 overflow-y-auto px-5 pb-5 pt-4"
    >
      <div className="flex items-center gap-3 border-b border-border-subtle pb-4">
        <span
          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] ${riskTile}`}
        >
          <RiskIcon className="h-5 w-5" strokeWidth={1.9} />
        </span>
        <DialogTitle
          id="permission-dialog-title"
          className="min-w-0 flex-1 text-[15px] font-semibold leading-tight text-text-primary"
        >
          {t('permission.permissionRequired')}
        </DialogTitle>
        <Badge tone={risk === 'write' ? 'warning' : 'default'}>
          {t(
            risk === 'read'
              ? 'permission.risk.read'
              : risk === 'write'
                ? 'permission.risk.write'
                : 'permission.risk.normal'
          )}
        </Badge>
      </div>

      <div className="pt-4">
        <div className="flex items-center gap-4">
          <span className="text-[13px] font-medium text-text-primary">
            {t('permission.toolLabel')}
          </span>
          <span className="rounded-lg border border-accent/20 bg-accent-muted px-3 py-1 font-mono text-[12px] font-medium text-accent shadow-soft">
            {permission.toolName}
          </span>
        </div>

        <div className="mt-4">
          <div className="mb-2 text-[13px] font-medium text-text-primary">{previewLabel}</div>
          <div className="relative rounded-xl border border-border-subtle bg-surface px-4 py-3 shadow-soft">
            <div
              className={`flex min-w-0 gap-3 pr-10 font-mono text-[13px] leading-6 ${
                isPreviewExpanded ? 'items-start' : 'items-center'
              }`}
            >
              {preview.isCommand && (
                <span className="flex-shrink-0 font-medium text-accent">$</span>
              )}
              <span
                className={`min-w-0 text-text-primary ${
                  isPreviewExpanded
                    ? 'max-h-36 overflow-auto whitespace-pre-wrap break-words'
                    : 'truncate whitespace-nowrap'
                }`}
              >
                {isPreviewExpanded ? preview.text : singleLinePreview}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsPreviewExpanded((expanded) => !expanded)}
              className={`absolute right-4 flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 ${
                isPreviewExpanded ? 'top-2.5' : 'top-1/2 -translate-y-1/2'
              }`}
              aria-label={
                isPreviewExpanded ? t('permission.collapsePreview') : t('permission.expandPreview')
              }
              title={
                isPreviewExpanded ? t('permission.collapsePreview') : t('permission.expandPreview')
              }
            >
              {isPreviewExpanded ? (
                <ChevronUp className="h-4 w-4" strokeWidth={2} />
              ) : (
                <ChevronDown className="h-4 w-4" strokeWidth={2} />
              )}
            </button>
          </div>
        </div>

        {isReadOnlyCommand && (
          <div className="mt-4 rounded-xl border border-border-subtle bg-surface-muted px-4 py-3">
            <div className="flex items-center gap-3">
              <Info className="h-5 w-5 flex-shrink-0 text-text-muted" strokeWidth={1.9} />
              <p className="text-[13px] leading-5 text-text-secondary">
                {t('permission.readOnlyNotice')}
              </p>
            </div>
          </div>
        )}

        {isHighRisk && (
          <div className="mt-4 rounded-xl border border-warning/20 bg-warning/10 px-4 py-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 flex-shrink-0 text-warning" strokeWidth={1.9} />
              <p className="text-[13px] leading-5 text-text-secondary">{t('permission.warning')}</p>
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <div
            role="radiogroup"
            aria-label={t('permission.scopeLabel')}
            className="flex min-h-9 flex-1 flex-wrap items-center gap-4 text-[13px] text-text-secondary"
          >
            {[
              { value: false, label: t('permission.scopeOnce') },
              { value: true, label: t('permission.scopeTask') },
            ].map((option) => (
              <label key={String(option.value)} className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="permission-scope"
                  checked={rememberTool === option.value}
                  onChange={() => setRememberTool(option.value)}
                  className="h-4 w-4 flex-shrink-0 accent-accent"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <div className="ml-auto flex flex-shrink-0 items-center gap-3">
            <Button
              variant="secondary"
              onClick={deny}
              className="h-9 min-w-[96px] rounded-lg text-[13px]"
            >
              {t('permission.deny')}
            </Button>
            <Button
              variant="primary"
              onClick={() => respondToPermission(permission.toolUseId, allowResult)}
              className="h-9 min-w-[96px] rounded-lg text-[13px]"
            >
              {rememberTool ? t('permission.allowForTask') : t('permission.allow')}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
