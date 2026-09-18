import { Cable, Users, Settings2, ScrollText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { underlineTabTriggerClass } from '../data-view/shared';
import { cn } from '../ui/cn';
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
    <Tabs value={activeSection} onValueChange={(v) => onSectionChange(v as RemoteSection)}>
      <TabsList
        aria-label={t('remote.navigationLabel')}
        className="flex w-full items-center gap-1 overflow-x-auto rounded-none border-0 border-b border-border-subtle bg-transparent px-2"
      >
        {items.map(({ id, label, icon: Icon, count }) => (
          <TabsTrigger
            key={id}
            value={id}
            id={`remote-nav-tab-${id}`}
            // Panels are lazily mounted — only reference one that exists.
            aria-controls={id === activeSection ? `remote-panel-${id}` : undefined}
            className={cn(
              underlineTabTriggerClass,
              'flex h-auto shrink-0 items-center gap-2 px-3 py-3 text-sm'
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
            {!!count && (
              <span className="min-w-5 rounded-full bg-warning/15 px-1.5 py-0.5 text-center text-[10px] font-semibold text-warning">
                {count}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
