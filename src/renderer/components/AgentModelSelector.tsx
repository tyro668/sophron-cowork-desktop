import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Settings2 } from 'lucide-react';
import { useAppStore } from '../store';
import {
  BUILTIN_LLM_PROVIDER,
  makeBuiltinLlmConfigSetId,
  parseBuiltinLlmConfigSetId,
} from '../../shared/builtin-llm';
import type { ApiConfigSet, AppConfig, ProviderModelInfo } from '../types';
import { cn } from './ui';

export interface AgentModelOption {
  id: string;
  name: string;
  model: string;
  serverModel: string;
  creditMultiplier?: number;
  inputCreditMultiplier?: number;
  outputCreditMultiplier?: number;
  isActive: boolean;
  source: 'builtin' | 'custom';
}

function getConfigSetModel(configSet: ApiConfigSet | null | undefined): string {
  return configSet?.profiles?.[configSet.activeProfileKey]?.model?.trim() || '';
}

function normalizeBuiltinModels(builtinModels: ProviderModelInfo[] = []): ProviderModelInfo[] {
  const seen = new Set<string>();
  return builtinModels
    .map((model) => ({
      id: model.id.trim(),
      name: model.name?.trim() || model.id.trim(),
      provider: model.provider?.trim(),
      upstreamModel: model.upstreamModel?.trim(),
      creditMultiplier: model.creditMultiplier,
      inputCreditMultiplier: model.inputCreditMultiplier,
      outputCreditMultiplier: model.outputCreditMultiplier,
      creditUnit: model.creditUnit,
    }))
    .filter((model) => {
      if (!model.id || seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    });
}

function resolveSelectedBuiltinModel(
  appConfig: AppConfig | null | undefined,
  selectedConfigSetId?: string
): string {
  const virtualModel = parseBuiltinLlmConfigSetId(selectedConfigSetId);
  if (virtualModel) return virtualModel;

  const selectedSet =
    selectedConfigSetId && appConfig?.configSets
      ? appConfig.configSets.find((set) => set.id === selectedConfigSetId)
      : null;
  if (selectedSet?.provider === BUILTIN_LLM_PROVIDER) {
    return getConfigSetModel(selectedSet);
  }

  if (!selectedConfigSetId && appConfig?.provider === BUILTIN_LLM_PROVIDER) {
    return appConfig.builtinLlmModel?.trim() || appConfig.model?.trim() || '';
  }

  return '';
}

export function getAgentModelOptions(
  appConfig: AppConfig | null | undefined,
  selectedConfigSetId?: string,
  builtinModels: ProviderModelInfo[] = []
): AgentModelOption[] {
  const selectedId = selectedConfigSetId || appConfig?.activeConfigSetId;
  const selectedBuiltinModel = resolveSelectedBuiltinModel(appConfig, selectedConfigSetId);
  const normalizedBuiltinModels = normalizeBuiltinModels(builtinModels);

  const builtinOptions = normalizedBuiltinModels.map((model) => ({
    id: makeBuiltinLlmConfigSetId(model.id),
    name: model.name,
    model: model.id,
    serverModel: model.upstreamModel || model.id,
    creditMultiplier: model.creditMultiplier,
    inputCreditMultiplier: model.inputCreditMultiplier,
    outputCreditMultiplier: model.outputCreditMultiplier,
    source: 'builtin' as const,
    isActive: selectedBuiltinModel === model.id,
  }));

  const customOptions =
    appConfig?.configSets
      ?.filter((set) => set.provider !== BUILTIN_LLM_PROVIDER)
      ?.map((set) => {
        const model = getConfigSetModel(set);
        return {
          id: set.id,
          name: set.name,
          model,
          serverModel: model,
          creditMultiplier: undefined,
          source: 'custom' as const,
          isActive: !selectedBuiltinModel && set.id === selectedId,
        };
      })
      .filter((option) => option.model) || [];

  return [...builtinOptions, ...customOptions];
}

export function getAgentModelLabel(
  appConfig: AppConfig | null | undefined,
  fallback: string,
  selectedConfigSetId?: string
): string {
  const builtinModel = resolveSelectedBuiltinModel(appConfig, selectedConfigSetId);
  if (builtinModel) return builtinModel;

  const selected =
    selectedConfigSetId && appConfig?.configSets
      ? appConfig.configSets.find((set) => set.id === selectedConfigSetId)
      : null;
  return getConfigSetModel(selected) || appConfig?.model?.trim() || fallback;
}

export function AgentModelSelector({
  open,
  onOpenChange,
  appConfig,
  selectedConfigSetId,
  fallbackLabel,
  disabled = false,
  triggerClassName,
  side = 'top',
  align = 'end',
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appConfig: AppConfig | null | undefined;
  selectedConfigSetId?: string;
  fallbackLabel: string;
  disabled?: boolean;
  triggerClassName: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  onSelect: (configSetId: string) => void;
}) {
  const { t } = useTranslation();
  const [builtinModels, setBuiltinModels] = useState<ProviderModelInfo[]>([]);
  const options = useMemo(
    () => getAgentModelOptions(appConfig, selectedConfigSetId, builtinModels),
    [appConfig, builtinModels, selectedConfigSetId]
  );
  const builtinOptions = options.filter((option) => option.source === 'builtin');
  const customOptions = options.filter((option) => option.source === 'custom');
  const label = useMemo(() => {
    const builtinModel = resolveSelectedBuiltinModel(appConfig, selectedConfigSetId);
    if (!builtinModel) {
      return getAgentModelLabel(appConfig, fallbackLabel, selectedConfigSetId);
    }

    return builtinOptions.find((option) => option.model === builtinModel)?.name || fallbackLabel;
  }, [appConfig, builtinOptions, fallbackLabel, selectedConfigSetId]);

  const formatMultiplier = (value: number | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '';
    return Number.isInteger(value)
      ? String(value)
      : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  };

  const formatCostMultiplier = (option: AgentModelOption) => {
    if (typeof option.creditMultiplier === 'number' && Number.isFinite(option.creditMultiplier)) {
      return t('chat.modelCreditMultiplierSingle', {
        value: formatMultiplier(option.creditMultiplier),
      });
    }

    const multipliers = [option.inputCreditMultiplier, option.outputCreditMultiplier].filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value)
    );
    if (multipliers.length === 0) return '';
    return t('chat.modelCreditMultiplierSingle', {
      value: formatMultiplier(Math.max(...multipliers)),
    });
  };

  // Unified naming: the model id is the primary label everywhere (trigger and
  // menu); a custom config-set name only appears as the secondary line.
  const getPrimaryModelText = (option: AgentModelOption) =>
    option.source === 'builtin' ? option.name : option.model || option.name;
  const getSecondaryModelText = (option: AgentModelOption) => {
    if (option.source === 'builtin') return '';
    return option.name && option.name !== getPrimaryModelText(option) ? option.name : '';
  };

  useEffect(() => {
    if (!open || disabled || !window.electronAPI?.config?.listModels) {
      return;
    }

    let cancelled = false;
    window.electronAPI.config
      .listModels({ provider: BUILTIN_LLM_PROVIDER, apiKey: '' })
      .then((models) => {
        if (!cancelled) {
          setBuiltinModels(models);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBuiltinModels([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [disabled, open]);

  const renderOptionGroup = (
    title: string,
    groupOptions: AgentModelOption[],
    withTopDivider: boolean
  ) => {
    if (groupOptions.length === 0) return null;
    return (
      <div className={cn(withTopDivider && 'mt-1.5 border-t border-border-subtle pt-1.5')}>
        <div className="px-2.5 pb-1 pt-1 text-[11px] font-medium text-text-muted">{title}</div>
        <div className="space-y-0.5">
          {groupOptions.map((option) => {
            const costMultiplier = formatCostMultiplier(option);
            const secondaryModelText = getSecondaryModelText(option);
            return (
              <DropdownMenu.Item
                key={option.id}
                onSelect={() => onSelect(option.id)}
                className={cn(
                  'flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-left outline-none transition-colors',
                  'data-[highlighted]:bg-surface-hover',
                  option.isActive ? 'bg-accent-muted text-text-primary' : 'text-text-primary'
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium leading-5">
                    {getPrimaryModelText(option)}
                  </span>
                  {secondaryModelText ? (
                    <span className="block truncate text-[11px] leading-4 text-text-muted">
                      {secondaryModelText}
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {costMultiplier ? (
                    <span className="rounded border border-border-subtle bg-surface-muted px-1.5 py-0.5 font-mono text-[10.5px] font-medium leading-none tabular-nums text-text-muted">
                      {costMultiplier}
                    </span>
                  ) : null}
                  <span className="flex h-4 w-4 items-center justify-center">
                    {option.isActive ? <Check className="h-3.5 w-3.5 text-accent" /> : null}
                  </span>
                </span>
              </DropdownMenu.Item>
            );
          })}
        </div>
      </div>
    );
  };

  if (disabled) {
    return (
      <button type="button" disabled className={cn('group', triggerClassName)} title={label}>
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </button>
    );
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={cn('group', triggerClassName)} title={label}>
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-65 transition-transform duration-150 group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className="z-[10000] w-[min(17.5rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border-muted bg-surface p-1 text-text-primary shadow-elevated"
        >
          <div className="scrollbar-hover max-h-[272px] overflow-y-auto">
            {options.length > 0 ? (
              <>
                {renderOptionGroup(t('chat.modelGroupBuiltin'), builtinOptions, false)}
                {renderOptionGroup(
                  t('chat.modelGroupCustom'),
                  customOptions,
                  builtinOptions.length > 0
                )}
              </>
            ) : (
              <div className="px-2.5 py-2 text-[12.5px] text-text-muted">{label}</div>
            )}
          </div>
          <div className="mt-1.5 border-t border-border-subtle pt-1.5">
            <DropdownMenu.Item
              onSelect={() => {
                const store = useAppStore.getState();
                store.setSettingsTab('api');
                store.setShowSettings(true);
              }}
              className="flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] font-medium text-text-secondary outline-none transition-colors data-[highlighted]:bg-surface-hover data-[highlighted]:text-text-primary"
            >
              <Settings2 className="h-3.5 w-3.5 shrink-0 text-text-muted" />
              <span className="truncate">{t('chat.manageModels')}</span>
            </DropdownMenu.Item>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
