import * as Select from '@radix-ui/react-select';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useOptionalConfirmDialog } from './ConfirmDialog';
import {
  normalizePermissionPolicy,
  type PermissionPolicyId,
} from '../../shared/permission-policies';
import { useAppStore } from '../store';
import { cn } from './ui';

interface PermissionPolicySelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buttonClassName: string;
}

interface PermissionPolicySelectProps {
  value: PermissionPolicyId;
  onValueChange: (policy: PermissionPolicyId) => void;
  triggerClassName: string;
  placeholder?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  showIcon?: boolean;
}

function renderPolicyIcon(policy: PermissionPolicyId, className: string) {
  if (policy === 'full_access') {
    return <ShieldAlert className={className} />;
  }
  if (policy === 'auto_review') {
    return <ShieldCheck className={className} />;
  }
  return <Shield className={className} />;
}

export function PermissionPolicySelector({
  open,
  onOpenChange,
  buttonClassName,
}: PermissionPolicySelectorProps) {
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const activePolicy = normalizePermissionPolicy(settings.permissionPolicy);
  const { t } = useTranslation();
  const confirmDialog = useOptionalConfirmDialog();

  const handleSelect = async (policy: PermissionPolicyId) => {
    onOpenChange(false);
    if (policy === activePolicy) return;
    if (policy === 'full_access' && confirmDialog) {
      const ok = await confirmDialog.confirm({
        title: t('chat.fullAccessConfirmTitle'),
        message: t('chat.fullAccessConfirmMessage'),
        confirmLabel: t('chat.fullAccessConfirmAction'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok) return;
    }
    updateSettings({
      permissionPolicy: policy,
    });
  };

  return (
    <PermissionPolicySelect
      open={open}
      onOpenChange={onOpenChange}
      value={activePolicy}
      onValueChange={(policy) => void handleSelect(policy)}
      side="top"
      align="start"
      triggerClassName={cn(
        buttonClassName,
        'w-auto',
        activePolicy === 'full_access' ? 'composer-pill-warning' : 'text-text-secondary'
      )}
    />
  );
}

export function PermissionPolicySelect({
  value,
  onValueChange,
  triggerClassName,
  placeholder,
  open,
  onOpenChange,
  side = 'bottom',
  align = 'start',
  showIcon = true,
}: PermissionPolicySelectProps) {
  const { t } = useTranslation();
  const activePolicy = normalizePermissionPolicy(value);
  const options: Array<{
    id: PermissionPolicyId;
    label: string;
    description: string;
  }> = [
    {
      id: 'default',
      label: t('chat.permissionPolicyDefault'),
      description: t('chat.permissionPolicyDefaultDesc'),
    },
    {
      id: 'auto_review',
      label: t('chat.permissionPolicyAutoReview'),
      description: t('chat.permissionPolicyAutoReviewDesc'),
    },
    {
      id: 'full_access',
      label: t('chat.permissionPolicyFullAccess'),
      description: t('chat.permissionPolicyFullAccessDesc'),
    },
  ];
  const activeLabel =
    placeholder ||
    options.find((option) => option.id === activePolicy)?.label ||
    t('chat.permissionPolicyAutoReview');

  return (
    <Select.Root
      open={open}
      onOpenChange={onOpenChange}
      value={activePolicy}
      onValueChange={(policy) => onValueChange(policy as PermissionPolicyId)}
    >
      <Select.Trigger
        className={cn(
          'group inline-flex h-7 w-auto min-w-0 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium outline-none transition-colors',
          'focus-visible:ring-2 focus-visible:ring-accent/25',
          triggerClassName
        )}
      >
        {showIcon
          ? renderPolicyIcon(
              activePolicy,
              cn(
                'h-3.5 w-3.5 shrink-0',
                activePolicy === 'full_access' ? 'text-warning' : 'text-text-muted'
              )
            )
          : null}
        <span className="truncate">{activeLabel}</span>
        <Select.Icon asChild>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-65 transition-transform duration-150 group-data-[state=open]:rotate-180" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className="z-[10000] w-[17.5rem] overflow-hidden rounded-xl border border-border-muted bg-surface p-1.5 text-text-primary shadow-elevated"
        >
          <div className="px-2.5 pb-1 pt-1 text-[11px] font-medium text-text-muted">
            {t('chat.permissionPolicyMenuTitle')}
          </div>
          <Select.Viewport className="space-y-0.5">
            {options.map((option) => {
              const isSelected = option.id === activePolicy;
              return (
                <Select.Item
                  key={option.id}
                  value={option.id}
                  className={cn(
                    'relative flex cursor-pointer select-none items-start gap-2.5 rounded-lg px-2.5 py-2 pr-7 outline-none transition-colors',
                    'data-[highlighted]:bg-surface-hover',
                    isSelected && 'bg-accent-muted/75'
                  )}
                >
                  {renderPolicyIcon(
                    option.id,
                    cn(
                      'mt-0.5 h-3.5 w-3.5 shrink-0',
                      option.id === 'full_access'
                        ? 'text-warning'
                        : isSelected
                          ? 'text-accent'
                          : 'text-text-muted'
                    )
                  )}
                  <span className="min-w-0 flex-1">
                    <Select.ItemText asChild>
                      <span
                        className={cn(
                          'block text-[12.5px] font-medium leading-4',
                          option.id === 'full_access' ? 'text-warning' : 'text-text-primary'
                        )}
                      >
                        {option.label}
                      </span>
                    </Select.ItemText>
                    <span className="mt-0.5 block text-[11px] leading-4 text-text-muted">
                      {option.description}
                    </span>
                  </span>
                  <Select.ItemIndicator className="absolute right-2.5 top-2.5 text-accent">
                    <Check className="h-3.5 w-3.5" />
                  </Select.ItemIndicator>
                </Select.Item>
              );
            })}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
