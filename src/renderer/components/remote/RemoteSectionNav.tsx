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
        className="flex h-10 w-full items-stretch gap-0 overflow-x-auto rounded-none border-0 border-b border-border-subtle bg-surface-muted/35 p-0"
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
              'flex h-full shrink-0 items-center gap-1.5 px-3.5 text-[12.5px]'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
            {!!count && (
              <span className="min-w-4 rounded bg-warning/15 px-1 py-0.5 text-center text-[10px] font-semibold leading-none tabular-nums text-warning">
                {count}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
