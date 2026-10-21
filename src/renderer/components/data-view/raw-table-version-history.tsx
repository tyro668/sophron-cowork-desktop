import { useMemo } from 'react';
import type { DataRawTableNormalizerArtifactVersion, DataNormalizerProjectFile } from '../../types';
import { formatDateTime, type TranslateFn } from './shared';
import { Badge } from '../ui/badge';
import { ChevronDown, FileText, Folder, History, RefreshCw, Trash2, Upload } from 'lucide-react';
import {
  buildNormalizerProjectTree,
  getNormalizerVersionDiff,
  type NormalizerProjectTreeNode,
} from './raw-table-normalizer-utils';

export function NormalizerProjectTree({
  files,
  selectedPath,
  onSelect,
  t,
  spacious = false,
}: {
  files: DataNormalizerProjectFile[];
  selectedPath: string;
  onSelect: (path: string) => void;
  t: TranslateFn;
  spacious?: boolean;
}) {
  const tree = useMemo(() => buildNormalizerProjectTree(files), [files]);
  if (tree.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-muted bg-surface px-3 py-4 text-center text-xs font-medium text-text-muted">
        {t('data.rawTables.editor.noProjectFiles')}
      </div>
    );
  }
  return (
    <div data-testid="normalizer-project-tree">
      {tree.map((node) => (
        <NormalizerProjectTreeNodeView
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
          spacious={spacious}
        />
      ))}
    </div>
  );
}

export function NormalizerProjectTreeNodeView({
  node,
  depth,
  selectedPath,
  onSelect,
  spacious,
}: {
  node: NormalizerProjectTreeNode;
  depth: number;
  selectedPath: string;
  onSelect: (path: string) => void;
  spacious: boolean;
}) {
  const isFile = node.type === 'file';
  const isSelected = isFile && node.path === selectedPath;
  const Icon = isFile ? FileText : Folder;
  return (
    <div>
      <button
        type="button"
        disabled={!isFile}
        onClick={() => {
          if (isFile) onSelect(node.path);
        }}
        aria-current={isSelected ? 'true' : undefined}
        className={`flex w-full min-w-0 items-center gap-1.5 pr-2 text-left text-[12.5px] transition-colors disabled:cursor-default ${
          isSelected
            ? 'bg-accent-muted font-medium text-accent'
            : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
        } ${spacious ? 'h-8' : 'h-7'}`}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
      >
        {node.type === 'folder' ? (
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
        ) : (
          <span className="h-3.5 w-3.5 flex-shrink-0" />
        )}
        <Icon
          className={`h-3.5 w-3.5 flex-shrink-0 ${isSelected ? 'text-accent' : 'text-text-muted'}`}
        />
        <span className="min-w-0 truncate">{node.name}</span>
      </button>
      {node.children.length > 0 ? (
        <div>
          {node.children.map((child) => (
            <NormalizerProjectTreeNodeView
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              spacious={spacious}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RawTableVersionHistoryPanel({
  currentVersion,
  currentVersionId,
  deletingVersionId,
  embedded = false,
  loading,
  onRefresh,
  onDelete,
  onPublish,
  publishingVersionId,
  t,
  versions,
}: {
  currentVersion?: DataRawTableNormalizerArtifactVersion;
  currentVersionId?: string;
  deletingVersionId: string | null;
  embedded?: boolean;
  loading: boolean;
  onRefresh: () => void;
  onDelete: (version: DataRawTableNormalizerArtifactVersion) => void;
  onPublish: (version: DataRawTableNormalizerArtifactVersion) => void;
  publishingVersionId: string | null;
  t: TranslateFn;
  versions: DataRawTableNormalizerArtifactVersion[];
}) {
  const cols = 'grid-cols-[120px_100px_120px_minmax(0,1fr)_92px_40px]';
  const th =
    'flex h-8 items-center border-b border-l border-border-subtle bg-surface-muted px-2.5 text-[11.5px] font-medium text-text-muted first:border-l-0';
  const td =
    'flex min-h-9 min-w-0 items-center border-b border-l border-border-subtle first:border-l-0';
  const body =
    versions.length > 0 ? (
      <div className={`grid ${cols}`} data-testid="normalizer-version-grid">
        <div className={th}>{t('data.rawTables.editor.versionsColumnVersion')}</div>
        <div className={th}>{t('data.rawTables.editor.versionsColumnStatus')}</div>
        <div className={th}>{t('data.rawTables.editor.versionsColumnUpdatedAt')}</div>
        <div className={th}>{t('data.rawTables.editor.versionsColumnDiff')}</div>
        <div className={th} aria-label={t('data.rawTables.editor.versionsColumnActions')} />
        <div className={th} />
        {versions.map((version) => {
          const isCurrent = version.id === currentVersionId;
          const isPublished = version.status === 'published';
          const diff = getNormalizerVersionDiff(version, currentVersion);
          return (
            <div key={version.id} className="contents" data-testid="normalizer-version-row">
              <div className={`${td} gap-1.5 px-2.5`}>
                <span className="text-[13px] font-semibold text-text-primary">
                  {t('data.rawTables.editor.versionNumber', { version: version.version })}
                </span>
                {isCurrent ? (
                  <Badge tone="accent">{t('data.rawTables.editor.currentVersion')}</Badge>
                ) : null}
              </div>
              <div className={`${td} px-2.5`}>
                <Badge
                  tone={
                    isPublished ? 'success' : version.status === 'archived' ? 'default' : 'warning'
                  }
                >
                  {isPublished
                    ? t('data.rawTables.editor.publishedVersion')
                    : version.status === 'archived'
                      ? t('data.rawTables.editor.versionStatusArchived')
                      : t('data.rawTables.editor.versionStatusDraft')}
                </Badge>
              </div>
              <div
                className={`${td} whitespace-nowrap px-2.5 text-xs tabular-nums text-text-muted`}
                title={formatDateTime(version.updatedAt)}
              >
                {formatDateTime(version.updatedAt).replace(/^\d{4}-/, '')}
              </div>
              <div className={`${td} px-2.5 text-xs text-text-muted`}>
                <span className="truncate">
                  {diff
                    ? `${t('data.rawTables.editor.versionDiffLine', {
                        changed: diff.changed,
                        added: diff.added,
                        removed: diff.removed,
                      })} · ${
                        diff.ruleSame
                          ? t('data.rawTables.editor.versionRuleSameText')
                          : t('data.rawTables.editor.versionRuleChangedText')
                      }`
                    : version.rulePrompt || '-'}
                </span>
              </div>
              <div className={td}>
                {isPublished ? (
                  <span className="flex h-full w-full items-center justify-center text-xs text-text-muted">
                    {t('data.rawTables.editor.publishedVersion')}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={publishingVersionId === version.id}
                    onClick={() => onPublish(version)}
                    data-testid="normalizer-version-publish"
                    className="ui-accent-cell h-full w-full"
                  >
                    {publishingVersionId === version.id ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    {t('data.rawTables.editor.publishVersionAction')}
                  </button>
                )}
              </div>
              <div className={td}>
                <button
                  type="button"
                  disabled={isPublished || deletingVersionId === version.id}
                  onClick={() => onDelete(version)}
                  aria-label={t('data.rawTables.editor.deleteVersionAction')}
                  title={
                    isPublished
                      ? t('data.rawTables.editor.deletePublishedVersionBlocked')
                      : t('data.rawTables.editor.deleteVersionAction')
                  }
                  className="inline-flex h-full w-full items-center justify-center text-text-muted transition-colors hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-muted"
                >
                  {deletingVersionId === version.id ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    ) : (
      <div className="flex flex-col items-center justify-center gap-2 px-3 py-10 text-center">
        {loading ? (
          <span className="text-xs font-medium text-text-muted">
            {t('data.rawTables.editor.loadingVersions')}
          </span>
        ) : (
          <>
            <History className="h-5 w-5 text-text-muted" />
            <span className="text-[13px] font-medium text-text-secondary">
              {t('data.rawTables.editor.noVersions')}
            </span>
            <span className="text-xs text-text-muted">
              {t('data.rawTables.editor.noVersionsHint')}
            </span>
          </>
        )}
      </div>
    );

  if (embedded) {
    return body;
  }
  return (
    <section className="mt-3 overflow-hidden rounded-lg border border-border-muted bg-surface shadow-soft">
      <div className="flex h-10 items-center justify-between gap-3 border-b border-border-muted px-3">
        <div className="flex min-w-0 items-center gap-2">
          <History className="h-3.5 w-3.5 flex-shrink-0 text-accent" />
          <span className="truncate text-[13px] font-medium text-text-primary">
            {t('data.rawTables.editor.versionHistory')}
          </span>
          {versions.length > 0 ? (
            <span className="rounded-full bg-surface-active px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
              {versions.length}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label={t('common.refresh')}
          title={t('common.refresh')}
          className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {body}
    </section>
  );
}
