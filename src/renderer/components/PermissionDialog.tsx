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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5 animate-fade-in">
      <div className="w-full max-w-[760px] max-h-[calc(100vh-40px)] overflow-y-auto rounded-[24px] bg-white px-8 pb-6 pt-5 text-[#243044] shadow-[0_28px_80px_rgba(0,0,0,0.38)] animate-slide-up">
        <div className="flex items-center justify-center gap-4 border-b border-[#d9dee5] pb-5 text-center">
          <ShieldAlert className="h-11 w-11 flex-shrink-0 text-[#087f78]" strokeWidth={1.9} />
          <h2 className="text-[27px] font-semibold leading-tight text-[#202833]">
            {t('permission.permissionRequired')}
          </h2>
        </div>

        <div className="pt-4">
          <div className="flex items-center gap-4">
            <span className="text-[16px] font-medium text-[#202833]">
              {t('permission.toolLabel')}
            </span>
            <span className="rounded-lg border border-[#b8ddd9] bg-[#e7f6f4] px-3 py-1 font-mono text-[14px] font-semibold text-[#08746e] shadow-[inset_0_0_0_1px_rgba(8,116,110,0.05)]">
              {permission.toolName}
            </span>
          </div>

          <div className="mt-4">
            <div className="mb-2 text-[16px] font-medium text-[#202833]">{previewLabel}</div>
            <div className="relative rounded-xl border border-[#dce1e8] bg-white px-5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
              <div
                className={`flex min-w-0 gap-3 pr-10 font-mono text-[15px] leading-6 ${
                  isPreviewExpanded ? 'items-start' : 'items-center'
                }`}
              >
                {preview.isCommand && (
                  <span className="flex-shrink-0 font-semibold text-[#079389]">$</span>
                )}
                <span
                  className={`min-w-0 text-[#232b36] ${
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
                className={`absolute right-4 flex h-8 w-8 items-center justify-center rounded-lg text-[#252d38] transition-colors hover:bg-[#eef5f4] focus:outline-none focus:ring-2 focus:ring-[#0c8f87]/30 ${
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
            <div className="mt-4 rounded-xl border border-[#ffd8b4] bg-[#fff9f3] px-4 py-3">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 flex-shrink-0 text-[#f08a00]" strokeWidth={1.9} />
                <p className="text-[14px] leading-5 text-[#2d3440]">{t('permission.warning')}</p>
              </div>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <label className="flex min-h-9 flex-1 cursor-pointer items-center gap-3 text-[14px] text-[#697485]">
              <input
                type="checkbox"
                checked={rememberTool}
                onChange={(event) => setRememberTool(event.target.checked)}
                className="h-[18px] w-[18px] flex-shrink-0 rounded border-[#8d98a6] accent-[#0c8f87] focus:ring-2 focus:ring-[#0c8f87]/25"
              />
              <span>{t('permission.alwaysAllow')}</span>
            </label>
            <div className="ml-auto grid w-[250px] flex-shrink-0 grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => respondToPermission(permission.toolUseId, 'deny')}
                className="h-11 rounded-xl border border-[#d8dde4] bg-white text-[15px] font-semibold text-[#202833] shadow-[0_1px_2px_rgba(35,43,54,0.04)] transition-colors hover:bg-[#f7fafb] focus:outline-none focus:ring-2 focus:ring-[#0c8f87]/25"
              >
                {t('permission.deny')}
              </button>
              <button
                type="button"
                onClick={() => respondToPermission(permission.toolUseId, allowResult)}
                className="h-11 rounded-xl bg-[#079389] text-[15px] font-semibold text-white shadow-[0_8px_18px_rgba(7,147,137,0.24)] transition-colors hover:bg-[#087f78] focus:outline-none focus:ring-2 focus:ring-[#0c8f87]/30"
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
