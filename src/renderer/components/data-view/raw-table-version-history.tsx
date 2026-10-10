import { useMemo } from 'react';
import type { DataRawTableNormalizerArtifactVersion, DataNormalizerProjectFile } from '../../types';
import { formatDateTime, type TranslateFn } from './shared';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ChevronDown, FileText, Folder, History, RefreshCw, Trash2 } from 'lucide-react';
import {
  buildNormalizerProjectTree,
  getNormalizerVersionDiffSummary,
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
    <div className={spacious ? 'space-y-1' : 'space-y-0.5'}>
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
        className={`flex w-full min-w-0 items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-xs font-medium transition-colors disabled:cursor-default ${
          isSelected
            ? 'bg-accent-muted text-text-primary ring-1 ring-inset ring-accent/20'
            : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
        } ${spacious ? 'min-h-8' : 'min-h-7'}`}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      >
        {node.type === 'folder' ? (
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
        ) : (
          <span className="h-3.5 w-3.5 flex-shrink-0" />
        )}
        <Icon className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
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
  return (
    <section
      className={`overflow-hidden rounded-lg border border-border-muted ${
        embedded ? 'bg-surface' : 'mt-3 bg-surface shadow-soft'
      }`}
    >
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
      {versions.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-xs">
            <thead>
              <tr className="h-9 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-[11px] font-medium text-text-muted">
                <th className="w-20 whitespace-nowrap px-3">
                  {t('data.rawTables.editor.versionsColumnVersion')}
                </th>
                <th className="w-32 whitespace-nowrap px-3">
                  {t('data.rawTables.editor.versionsColumnStatus')}
                </th>
                <th className="min-w-[11rem] whitespace-nowrap px-3">
                  {t('data.rawTables.editor.versionsColumnUpdatedAt')}
                </th>
                <th className="min-w-[16rem] px-3">
                  {t('data.rawTables.editor.versionsColumnDiff')}
                </th>
                <th className="w-36 whitespace-nowrap px-3 text-right">
                  {t('data.rawTables.editor.versionsColumnActions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => {
                const isCurrent = version.id === currentVersionId;
                const isPublished = version.status === 'published';
                const diffSummary = getNormalizerVersionDiffSummary(version, currentVersion, t);
                return (
                  <tr
                    key={version.id}
                    className="h-11 border-b border-border-muted/80 text-text-secondary last:border-b-0 hover:bg-surface-hover"
                  >
                    <td className="px-3 font-mono text-[13px] font-medium text-text-primary">
                      {t('data.rawTables.editor.versionNumber', {
                        version: version.version,
                      })}
                    </td>
                    <td className="px-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {isCurrent ? (
                          <Badge tone="accent">{t('data.rawTables.editor.currentVersion')}</Badge>
                        ) : null}
                        <Badge tone={isPublished ? 'success' : 'default'}>
                          {isPublished
                            ? t('data.rawTables.editor.publishedVersion')
                            : version.status === 'archived'
                              ? t('data.rawTables.editor.versionStatusArchived')
                              : t('data.rawTables.editor.versionStatusDraft')}
                        </Badge>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 text-text-muted">
                      {formatDateTime(version.updatedAt)}
                    </td>
                    <td className="max-w-[28rem] px-3">
                      <span className="line-clamp-1 font-medium text-text-secondary">
                        {diffSummary || version.rulePrompt || '-'}
                      </span>
                    </td>
                    <td className="px-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={isPublished || publishingVersionId === version.id}
                          onClick={() => onPublish(version)}
                          className="h-7 gap-1 px-2.5 text-[11px]"
                        >
                          {publishingVersionId === version.id ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                          ) : null}
                          {isPublished
                            ? t('data.rawTables.editor.publishedVersion')
                            : t('data.rawTables.editor.publishVersionAction')}
                        </Button>
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
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-muted"
                        >
                          {deletingVersionId === version.id ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
      )}
    </section>
  );
}
