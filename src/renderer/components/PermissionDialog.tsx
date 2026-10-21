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
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);

  const preview = formatInputPreview(permission.input);
  // Wording only: read-only commands still need the user's approval.
  const isReadOnlyCommand = preview.isCommand && isReadOnlyShellCommand(preview.text);
  const isHighRisk = !isReadOnlyCommand && isHighRiskTool(permission.toolName);
  const singleLinePreview = preview.text.replace(/\s+/g, ' ');
  const previewLabel = preview.isCommand
    ? t('permission.commandPreview')
    : t('permission.inputPreview');

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
      className="max-h-[calc(100vh-40px)] max-w-[720px] animate-slide-up gap-0 overflow-hidden p-0"
    >
      <div className="flex h-12 flex-shrink-0 items-center gap-3 border-b border-border-subtle px-3">
        <span
          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${riskTile}`}
        >
          <RiskIcon className="h-4 w-4" strokeWidth={1.9} />
        </span>
        <DialogTitle
          id="permission-dialog-title"
          className="min-w-0 flex-1 text-[14px] font-semibold leading-tight text-text-primary"
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

      <div className="min-h-0 overflow-y-auto pb-3">
        <section className="ui-group bg-surface">
          <div className="ui-form-row">
            <div className="ui-form-label items-center">{t('permission.toolLabel')}</div>
            <div className="ui-form-value">
              <span className="self-start rounded-md bg-accent-muted px-2 py-0.5 font-mono text-[12px] font-medium text-accent">
                {permission.toolName}
              </span>
            </div>
          </div>
          <div className="ui-form-row">
            <div className="ui-form-label items-start pt-2.5">{previewLabel}</div>
            <div className="ui-form-value relative bg-[var(--code-preview-background)]">
              <div
                className={`flex min-w-0 gap-2 pr-9 font-mono text-[12.5px] leading-6 ${
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
                className={`absolute right-1.5 flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 ${
                  isPreviewExpanded ? 'top-1.5' : 'top-1/2 -translate-y-1/2'
                }`}
                aria-label={
                  isPreviewExpanded
                    ? t('permission.collapsePreview')
                    : t('permission.expandPreview')
                }
                title={
                  isPreviewExpanded
                    ? t('permission.collapsePreview')
                    : t('permission.expandPreview')
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
            <div className="flex items-center gap-2 border-t border-border-subtle bg-surface-muted px-3 py-2">
              <Info className="h-4 w-4 flex-shrink-0 text-text-muted" strokeWidth={1.9} />
              <p className="text-[12.5px] leading-5 text-text-secondary">
                {t('permission.readOnlyNotice')}
              </p>
            </div>
          )}
          {isHighRisk && (
            <div className="flex items-center gap-2 border-t border-border-subtle bg-warning/10 px-3 py-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning" strokeWidth={1.9} />
              <p className="text-[12.5px] leading-5 text-text-secondary">
                {t('permission.warning')}
              </p>
            </div>
          )}
        </section>
      </div>

      <div className="grid h-11 flex-shrink-0 grid-cols-3 border-t border-border-subtle text-[13px] font-medium">
        <button
          type="button"
          onClick={deny}
          className="border-r border-border-subtle text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          {t('permission.deny')}
        </button>
        <button
          type="button"
          onClick={() => respondToPermission(permission.toolUseId, 'allow')}
          className="border-r border-border-subtle text-text-primary transition-colors hover:bg-surface-hover"
        >
          {t('permission.scopeOnce')}
        </button>
        <button
          type="button"
          onClick={() => respondToPermission(permission.toolUseId, 'allow_always')}
          className="jade-primary-button rounded-none"
        >
          {t('permission.allowForTask')}
        </button>
      </div>
    </Dialog>
  );
}
