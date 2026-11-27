import {
  ChevronRight,
  Database,
  FolderKanban,
  Loader2,
  MoreVertical,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PersonalAnalysisProject, PersonalAnalysisSpace } from '../../../types';
import { GlassDropdownMenu, GlassMenuItem } from '../../GlassDropdownMenu';
import { Badge } from '../../ui/badge';
import { fixedTabGroupWidth } from '../shared';
import type { SelectedProject } from './helpers';

interface CloudSpaceSidebarProps {
  usesStoredConnection: boolean;
  loadingCatalog: boolean;
  spaces: PersonalAnalysisSpace[];
  projectsBySpace: Record<string, PersonalAnalysisProject[]>;
  expandedSpaceIds: string[];
  loadingProjectsBySpace: Record<string, boolean>;
  selectedProject: SelectedProject | null;
  loadingTables: boolean;
  loadingDriveFiles: boolean;
  onRefreshCatalog: () => void;
  onToggleSpace: (spaceId: string) => void;
  onSelectProject: (project: SelectedProject) => void;
  onRefreshProject: (project: SelectedProject) => void;
}

export function CloudSpaceSidebar({
  usesStoredConnection,
  loadingCatalog,
  spaces,
  projectsBySpace,
  expandedSpaceIds,
  loadingProjectsBySpace,
  selectedProject,
  loadingTables,
  loadingDriveFiles,
  onRefreshCatalog,
  onToggleSpace,
  onSelectProject,
  onRefreshProject,
}: CloudSpaceSidebarProps) {
  const { t } = useTranslation();

  return (
    <aside
      className="flex min-h-0 flex-shrink-0 flex-col border-r border-border-subtle"
      style={{ width: fixedTabGroupWidth(3) }}
      data-testid="cloud-tree"
    >
      <div
        className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border-subtle pl-3 pr-2"
        data-testid="cloud-space-tree-header"
      >
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-text-secondary">
          {t('cloudData.spaceProject')}
          <Badge tone={usesStoredConnection ? 'accent' : 'success'}>
            {t(usesStoredConnection ? 'cloudData.apiModeBadge' : 'cloudData.accountModeBadge')}
          </Badge>
        </span>
        <GlassDropdownMenu
          align="end"
          contentClassName="w-44"
          trigger={
            <button
              type="button"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
              aria-label={t('data.actions.more')}
              title={t('data.actions.more')}
            >
              {loadingCatalog ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MoreVertical className="h-3.5 w-3.5" />
              )}
            </button>
          }
        >
          <GlassMenuItem
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            disabled={loadingCatalog}
            onSelect={onRefreshCatalog}
          >
            {t('data.actions.refresh')}
          </GlassMenuItem>
        </GlassDropdownMenu>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {spaces.length === 0 && !loadingCatalog ? (
          <div className="px-2 py-6 text-[13px] text-text-muted">
            <div>{t('cloudData.noSpaces')}</div>
          </div>
        ) : (
          <div className="space-y-3">
            {spaces.map((space) => {
              const projects = projectsBySpace[space.spaceId] ?? [];
              const expanded = expandedSpaceIds.includes(space.spaceId);
              const projectsLoaded = Object.prototype.hasOwnProperty.call(
                projectsBySpace,
                space.spaceId
              );
              const projectCount = projectsLoaded ? projects.length : space.projectCount || 0;
              const loadingProjects = Boolean(loadingProjectsBySpace[space.spaceId]);

              return (
                <section key={space.spaceId} className="space-y-1">
                  <button
                    type="button"
                    onClick={() => onToggleSpace(space.spaceId)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
                  >
                    <ChevronRight
                      className={`h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform ${
                        expanded ? 'rotate-90' : ''
                      }`}
                    />
                    <Database className="h-3.5 w-3.5 flex-shrink-0 text-accent-text" />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-text-primary">
                      {space.spaceName}
                    </span>
                    {loadingProjects ? (
                      <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-text-muted" />
                    ) : (
                      <span className="flex-shrink-0 text-[11px] font-medium text-text-muted">
                        {t('cloudData.projectCount', { count: projectCount })}
                      </span>
                    )}
                  </button>
                  {expanded && (
                    <div className="ml-[21px] space-y-0.5 border-l border-border-subtle pl-2">
                      {!projectsLoaded || loadingProjects ? (
                        <div className="h-8 px-2 py-2 text-[12px] text-text-muted">
                          {t('cloudData.loadingProjects')}
                        </div>
                      ) : projects.length === 0 ? (
                        <div className="h-8 px-2 py-2 text-[12px] text-text-muted">
                          {t('cloudData.noProjects')}
                        </div>
                      ) : (
                        projects.map((project) => {
                          const active =
                            selectedProject?.spaceId === space.spaceId &&
                            selectedProject.projectId === project.projectId;
                          const refreshing = active && (loadingTables || loadingDriveFiles);
                          return (
                            <div
                              key={project.projectId}
                              className={`group flex h-8 items-center rounded-lg transition-colors ${
                                active
                                  ? 'bg-accent-muted ring-1 ring-inset ring-accent/15'
                                  : 'hover:bg-surface-hover'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  onSelectProject({
                                    spaceId: space.spaceId,
                                    projectId: project.projectId,
                                  })
                                }
                                className={`flex min-w-0 flex-1 items-center gap-2 px-2 text-left text-[13px] font-medium ${
                                  active
                                    ? 'text-accent-text'
                                    : 'text-text-secondary group-hover:text-text-primary'
                                }`}
                              >
                                <FolderKanban className="h-3.5 w-3.5 flex-shrink-0" />
                                <span className="min-w-0 flex-1 truncate">
                                  {project.projectName}
                                </span>
                              </button>
                              <GlassDropdownMenu
                                align="start"
                                side="right"
                                sideOffset={4}
                                contentClassName="w-44"
                                trigger={
                                  <button
                                    type="button"
                                    className={`mr-1.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-text-muted transition-all hover:bg-surface-active hover:text-accent ${
                                      refreshing
                                        ? 'opacity-100'
                                        : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100'
                                    }`}
                                    aria-label={t('data.actions.more')}
                                    title={t('data.actions.more')}
                                  >
                                    {refreshing ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <MoreVertical className="h-3 w-3" />
                                    )}
                                  </button>
                                }
                              >
                                <GlassMenuItem
                                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                                  disabled={refreshing}
                                  onSelect={() =>
                                    onRefreshProject({
                                      spaceId: space.spaceId,
                                      projectId: project.projectId,
                                    })
                                  }
                                >
                                  {t('data.actions.refresh')}
                                </GlassMenuItem>
                              </GlassDropdownMenu>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
