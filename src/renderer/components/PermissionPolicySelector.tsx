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

export function PermissionPolicySelector({
  open,
  onOpenChange,
  buttonClassName,
}: PermissionPolicySelectorProps) {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const activePolicy = normalizePermissionPolicy(settings.permissionPolicy);
  const options: Array<{ id: PermissionPolicyId; label: string }> = [
    { id: 'default', label: t('chat.permissionPolicyDefault') },
    { id: 'auto_review', label: t('chat.permissionPolicyAutoReview') },
    { id: 'full_access', label: t('chat.permissionPolicyFullAccess') },
  ];
  const activeLabel =
    options.find((option) => option.id === activePolicy)?.label ||
    t('chat.permissionPolicyAutoReview');

  const handleSelect = (policy: PermissionPolicyId) => {
    onOpenChange(false);
    if (policy === activePolicy) return;
    updateSettings({
      permissionPolicy: policy,
      permissionRules: getPermissionRulesForPolicy(policy),
    });
  };

  return (
    <GlassSelect
      open={open}
      onOpenChange={onOpenChange}
      value={activePolicy}
      options={options.map((option) => ({ value: option.id, label: option.label }))}
      onValueChange={(policy) => handleSelect(policy as PermissionPolicyId)}
      placeholder={activeLabel}
      side="top"
      align="start"
      triggerIcon={<ShieldCheck className="h-[18px] w-[18px] shrink-0" />}
      triggerClassName={`${buttonClassName} !text-accent`}
      contentClassName="w-[15rem]"
    />
  );
}
