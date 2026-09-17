import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIPC } from '../hooks/useIPC';
import type { PermissionRequest } from '../types';
import { AlertTriangle, ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react';

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

  const isHighRisk = isHighRiskTool(permission.toolName);
  const preview = formatInputPreview(permission.input);
  const singleLinePreview = preview.text.replace(/\s+/g, ' ');
  const previewLabel = preview.isCommand
    ? t('permission.commandPreview')
    : t('permission.inputPreview');

  const allowResult = rememberTool ? 'allow_always' : 'allow';

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/25 p-5">
      <div className="glass-surface w-full max-w-[720px] max-h-[calc(100vh-40px)] animate-slide-up overflow-y-auto rounded-2xl px-5 pb-5 pt-4 text-text-primary">
        <div className="flex items-center justify-center gap-3 border-b border-border-subtle pb-4 text-center">
          <ShieldAlert className="h-9 w-9 flex-shrink-0 text-accent" strokeWidth={1.9} />
          <h2 className="text-[18px] font-semibold leading-tight text-text-primary">
            {t('permission.permissionRequired')}
          </h2>
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

          {isHighRisk && (
            <div className="mt-4 rounded-xl border border-warning/20 bg-warning/10 px-4 py-3">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 flex-shrink-0 text-warning" strokeWidth={1.9} />
                <p className="text-[13px] leading-5 text-text-secondary">
                  {t('permission.warning')}
                </p>
              </div>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <label className="flex min-h-9 flex-1 cursor-pointer items-center gap-3 text-[13px] text-text-secondary">
              <input
                type="checkbox"
                checked={rememberTool}
                onChange={(event) => setRememberTool(event.target.checked)}
                className="h-[18px] w-[18px] flex-shrink-0 rounded border-border text-accent accent-accent focus:ring-2 focus:ring-accent/25"
              />
              <span>{t('permission.alwaysAllow')}</span>
            </label>
            <div className="ml-auto grid w-[250px] flex-shrink-0 grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => respondToPermission(permission.toolUseId, 'deny')}
                className="h-10 rounded-xl border border-border-muted bg-surface text-[13px] font-medium text-text-primary shadow-soft transition-colors hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-accent/25"
              >
                {t('permission.deny')}
              </button>
              <button
                type="button"
                onClick={() => respondToPermission(permission.toolUseId, allowResult)}
                className="h-10 rounded-xl bg-accent text-[13px] font-medium text-accent-foreground shadow-soft transition-colors hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                {t('permission.allow')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
