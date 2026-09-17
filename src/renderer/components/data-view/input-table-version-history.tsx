import { useMemo } from 'react';
import type {
  DataInputTableNormalizerArtifactVersion,
  DataNormalizerProjectFile,
} from '../../types';
import { formatDateTime, type TranslateFn } from './shared';
import { ChevronDown, FileText, Folder, RefreshCw, Trash2 } from 'lucide-react';
import {
  buildNormalizerProjectTree,
  getNormalizerVersionDiffSummary,
  type NormalizerProjectTreeNode,
} from './input-table-normalizer-utils';

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
        {t('data.inputTables.editor.noProjectFiles')}
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

export function InputTableVersionHistoryPanel({
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
  currentVersion?: DataInputTableNormalizerArtifactVersion;
  currentVersionId?: string;
  deletingVersionId: string | null;
  embedded?: boolean;
  loading: boolean;
  onRefresh: () => void;
  onDelete: (version: DataInputTableNormalizerArtifactVersion) => void;
  onPublish: (version: DataInputTableNormalizerArtifactVersion) => void;
  publishingVersionId: string | null;
  t: TranslateFn;
  versions: DataInputTableNormalizerArtifactVersion[];
}) {
  return (
    <section
      className={`overflow-hidden rounded-lg border border-border-muted ${
        embedded ? 'bg-surface' : 'mt-3 bg-surface shadow-soft'
      }`}
    >
      <div className="flex h-11 items-center justify-between border-b border-border-muted px-3">
        <div className="text-[13px] font-medium text-text-primary">
          {t('data.inputTables.editor.versionHistory')}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </button>
      </div>
      {versions.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-xs">
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
                    <td className="w-20 px-3 font-mono text-[13px] font-medium text-text-primary">
                      {t('data.inputTables.editor.versionNumber', {
                        version: version.version,
                      })}
                    </td>
                    <td className="w-44 px-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {isCurrent ? (
                          <span className="rounded-full bg-accent-muted px-2 py-0.5 text-[11px] font-medium text-accent">
                            {t('data.inputTables.editor.currentVersion')}
                          </span>
                        ) : null}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            isPublished
                              ? 'bg-success/10 text-success'
                              : 'bg-surface text-text-secondary'
                          }`}
                        >
                          {isPublished
                            ? t('data.inputTables.editor.publishedVersion')
                            : version.status}
                        </span>
                      </div>
                    </td>
                    <td className="min-w-[13rem] px-3 text-text-muted">
                      {t('data.inputTables.editor.updatedAt', {
                        time: formatDateTime(version.updatedAt),
                      })}
                    </td>
                    <td className="min-w-[16rem] max-w-[28rem] px-3">
                      <span className="line-clamp-1 font-medium text-text-secondary">
                        {diffSummary || version.rulePrompt || '-'}
                      </span>
                    </td>
                    <td className="w-[13rem] px-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={isPublished || publishingVersionId === version.id}
                          onClick={() => onPublish(version)}
                          className="inline-flex h-7 min-w-[4.25rem] items-center justify-center gap-1 rounded-lg jade-primary-button px-3 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:bg-surface-active disabled:text-text-muted disabled:opacity-70"
                        >
                          {publishingVersionId === version.id ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                          ) : null}
                          {isPublished
                            ? t('data.inputTables.editor.publishedVersion')
                            : t('data.inputTables.editor.publishVersionAction')}
                        </button>
                        <button
                          type="button"
                          disabled={isPublished || deletingVersionId === version.id}
                          onClick={() => onDelete(version)}
                          title={
                            isPublished
                              ? t('data.inputTables.editor.deletePublishedVersionBlocked')
                              : undefined
                          }
                          className="inline-flex h-7 min-w-[4.25rem] items-center justify-center gap-1 rounded-lg border border-danger/20 bg-danger/10 px-3 text-[11px] font-medium text-danger transition-colors hover:border-danger/40 hover:bg-danger/20 disabled:cursor-not-allowed disabled:border-border-muted disabled:bg-surface-active disabled:text-text-muted disabled:opacity-70"
                        >
                          {deletingVersionId === version.id ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                          {deletingVersionId === version.id
                            ? t('data.inputTables.editor.deletingVersionAction')
                            : t('data.inputTables.editor.deleteVersionAction')}
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
        <div className="px-3 py-6 text-center text-xs font-medium text-text-muted">
          {loading
            ? t('data.inputTables.editor.loadingVersions')
            : t('data.inputTables.editor.noVersions')}
        </div>
      )}
    </section>
  );
}
