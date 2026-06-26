import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import {
  getPermissionRulesForPolicy,
  normalizePermissionPolicy,
  type PermissionPolicyId,
} from '../../shared/permission-policies';
import { useAppStore } from '../store';
import { GlassSelect } from './GlassSelect';

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

export function PermissionPolicySelector({
  open,
  onOpenChange,
  buttonClassName,
}: PermissionPolicySelectorProps) {
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const activePolicy = normalizePermissionPolicy(settings.permissionPolicy);

  const handleSelect = (policy: PermissionPolicyId) => {
    onOpenChange(false);
    if (policy === activePolicy) return;
    updateSettings({
      permissionPolicy: policy,
      permissionRules: getPermissionRulesForPolicy(policy),
    });
  };

  return (
    <PermissionPolicySelect
      open={open}
      onOpenChange={onOpenChange}
      value={activePolicy}
      onValueChange={handleSelect}
      side="top"
      align="start"
      triggerClassName={`${buttonClassName} !text-accent`}
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
  const options: Array<{ id: PermissionPolicyId; label: string }> = [
    { id: 'default', label: t('chat.permissionPolicyDefault') },
    { id: 'auto_review', label: t('chat.permissionPolicyAutoReview') },
    { id: 'full_access', label: t('chat.permissionPolicyFullAccess') },
  ];
  const activeLabel =
    placeholder ||
    options.find((option) => option.id === activePolicy)?.label ||
    t('chat.permissionPolicyAutoReview');

  return (
    <GlassSelect
      open={open}
      onOpenChange={onOpenChange}
      value={activePolicy}
      options={options.map((option) => ({ value: option.id, label: option.label }))}
      onValueChange={(policy) => onValueChange(policy as PermissionPolicyId)}
      placeholder={activeLabel}
      side={side}
      align={align}
      triggerIcon={showIcon ? <ShieldCheck className="h-[18px] w-[18px] shrink-0" /> : undefined}
      triggerClassName={triggerClassName}
      contentClassName="w-[15rem]"
    />
  );
}
