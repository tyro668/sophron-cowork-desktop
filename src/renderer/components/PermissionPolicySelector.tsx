import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ShieldCheck } from 'lucide-react';
import {
  getPermissionRulesForPolicy,
  normalizePermissionPolicy,
  type PermissionPolicyId,
} from '../../shared/permission-policies';
import { useAppStore } from '../store';

interface PermissionPolicySelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buttonClassName: string;
  menuClassName: string;
}

export function PermissionPolicySelector({
  open,
  onOpenChange,
  buttonClassName,
  menuClassName,
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
    <>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={buttonClassName}
        title={activeLabel}
      >
        <ShieldCheck className="h-[18px] w-[18px] shrink-0" />
        <span className="hidden sm:inline">{activeLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      </button>

      {open && (
        <div
          className={`absolute bottom-[3.5rem] z-30 w-[min(15rem,calc(100%-2.5rem))] overflow-hidden rounded-lg border border-border-muted bg-background shadow-elevated ${menuClassName}`}
        >
          <div className="p-1">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => handleSelect(option.id)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] transition-colors ${
                  option.id === activePolicy
                    ? 'bg-accent-muted text-accent'
                    : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-semibold">{option.label}</span>
                {option.id === activePolicy && <Check className="h-4 w-4 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
