import { Cable, Users, Settings2, ScrollText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RemoteSection } from './types';

interface Props {
  activeSection: RemoteSection;
  pendingPairings: number;
  onSectionChange: (section: RemoteSection) => void;
}

export function RemoteSectionNav({ activeSection, pendingPairings, onSectionChange }: Props) {
  const { t } = useTranslation();
  const items = [
    { id: 'channels' as const, label: t('remote.navChannels'), icon: Cable },
    { id: 'users' as const, label: t('remote.navUsers'), icon: Users, count: pendingPairings },
    { id: 'global' as const, label: t('remote.navGlobal'), icon: Settings2 },
    { id: 'logs' as const, label: t('remote.navLogs'), icon: ScrollText },
  ];

  return (
    <div
      className="flex items-center gap-1 overflow-x-auto border-b border-border-subtle px-2"
      role="tablist"
      aria-label={t('remote.navigationLabel')}
    >
      {items.map(({ id, label, icon: Icon, count }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={activeSection === id}
          onClick={() => onSectionChange(id)}
          className={`relative flex shrink-0 items-center gap-2 px-3 py-3 text-sm font-medium transition-colors ${
            activeSection === id ? 'text-accent' : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          <Icon className="h-4 w-4" />
          <span>{label}</span>
          {!!count && (
            <span className="min-w-5 rounded-full bg-warning/15 px-1.5 py-0.5 text-center text-[10px] font-semibold text-warning">
              {count}
            </span>
          )}
          {activeSection === id && (
            <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" />
          )}
        </button>
      ))}
    </div>
  );
}
