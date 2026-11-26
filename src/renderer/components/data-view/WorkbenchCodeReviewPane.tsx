import { Check, Copy, FileCode2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DataNormalizerProjectFile } from '../../types';
import { GlassSelect } from '../GlassSelect';
import { CodeDiffView, fileDiffStats } from './code-diff-view';
import { CodePreview, getCodePreviewLanguageLabel } from './raw-table-code-preview';
import { getNormalizerChangeMarkers } from './raw-table-normalizer-utils';
import { NormalizerProjectTree } from './raw-table-version-history';

interface WorkbenchCodeReviewPaneProps {
  files: DataNormalizerProjectFile[];
  selectedFile?: DataNormalizerProjectFile;
  selectedFilePath: string;
  showingFix: boolean;
  diffBaseContent?: string;
  codeView: 'diff' | 'full';
  codeCopied: boolean;
  focusLine: { path: string; line: number } | null;
  changeMarkers: ReturnType<typeof getNormalizerChangeMarkers>;
  testId?: string;
  copyButtonTestId?: string;
  emptySubtitle?: string;
  treeWidth?: 'narrow' | 'wide';
  onCodeViewChange: (view: 'diff' | 'full') => void;
  onCopyCode: () => void;
  onSelectFilePath: (path: string) => void;
}

export function WorkbenchCodeReviewPane({
  files,
  selectedFile,
  selectedFilePath,
  showingFix,
  diffBaseContent,
  codeView,
  codeCopied,
  focusLine,
  changeMarkers,
  testId,
  copyButtonTestId,
  emptySubtitle,
  treeWidth = 'wide',
  onCodeViewChange,
  onCopyCode,
  onSelectFilePath,
}: WorkbenchCodeReviewPaneProps) {
  const { t } = useTranslation();

  if (files.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-2 px-6 text-center">
          <FileCode2 className="h-6 w-6 text-text-muted" />
          <span className="text-[13px] font-medium text-text-secondary">
            {t('data.rawTables.editor.noProjectFiles')}
          </span>
          {emptySubtitle ? <span className="text-xs text-text-muted">{emptySubtitle}</span> : null}
        </div>
      </div>
    );
  }

  const gridColumnsClass =
    treeWidth === 'narrow'
      ? showingFix
        ? 'grid-cols-[minmax(0,1fr)_150px_92px_200px_40px]'
        : 'grid-cols-[minmax(0,1fr)_92px_200px_40px]'
      : showingFix
        ? 'grid-cols-[minmax(0,1fr)_150px_92px_240px_40px]'
        : 'grid-cols-[minmax(0,1fr)_92px_240px_40px]';

  return (
    <div
      className={`grid min-h-0 flex-1 grid-rows-[36px_minmax(0,1fr)] ${gridColumnsClass}`}
      data-testid={testId}
    >
      <div className="flex min-w-0 items-center gap-2 border-b border-border-subtle px-2.5">
        <FileCode2 className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
        <span
          className="min-w-0 truncate font-mono text-xs font-medium text-text-primary"
          title={selectedFile?.path}
        >
          {selectedFile?.path ?? t('data.rawTables.editor.noProjectFiles')}
        </span>
        {selectedFile ? (
          <span className="flex-shrink-0 whitespace-nowrap text-[11px] text-text-muted">
            {showingFix && codeView === 'diff'
              ? (() => {
                  const stats = fileDiffStats(diffBaseContent, selectedFile.content);
                  return `+${stats.added} −${stats.removed} · ${getCodePreviewLanguageLabel(selectedFile.path)}`;
                })()
              : t('data.rawTables.editor.codeFileMeta', {
                  lines: selectedFile.content.split('\n').length,
                  language: getCodePreviewLanguageLabel(selectedFile.path),
                })}
          </span>
        ) : null}
      </div>
      {showingFix ? (
        <div className="flex border-b border-l border-border-subtle">
          <GlassSelect
            ariaLabel={t('fixError.viewDiff')}
            value={codeView}
            onValueChange={(value) => onCodeViewChange(value as 'diff' | 'full')}
            options={[
              { value: 'diff', label: t('fixError.viewDiff') },
              { value: 'full', label: t('fixError.viewFull') },
            ]}
            triggerClassName="h-full w-full justify-between rounded-none border-0 bg-transparent px-2.5 text-xs text-text-primary shadow-none"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
        </div>
      ) : null}
      <button
        type="button"
        disabled={!selectedFile}
        data-testid={copyButtonTestId}
        onClick={onCopyCode}
        className={`inline-flex items-center justify-center gap-1.5 border-b border-l border-border-subtle text-xs font-medium transition-colors hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-40 ${
          codeCopied ? 'text-success' : 'text-text-secondary hover:text-accent'
        }`}
        title={
          codeCopied ? t('data.rawTables.editor.copiedCode') : t('data.rawTables.editor.copyCode')
        }
      >
        {codeCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {codeCopied ? t('data.rawTables.editor.copiedShort') : t('data.rawTables.editor.copyShort')}
      </button>
      <div className="flex items-center border-b border-l border-border-subtle px-2.5 text-xs font-semibold text-text-primary">
        {t('data.rawTables.editor.projectStructure')}
      </div>
      <div className="flex items-center justify-center border-b border-border-subtle text-xs tabular-nums text-text-muted">
        {files.length}
      </div>
      <div
        className={`${showingFix ? 'col-span-3' : 'col-span-2'} flex min-h-0 min-w-0 flex-col overflow-hidden`}
      >
        {showingFix && codeView === 'diff' && selectedFile ? (
          <CodeDiffView before={diffBaseContent} after={selectedFile.content} t={t} />
        ) : (
          <CodePreview
            file={selectedFile}
            t={t}
            focusLine={
              focusLine && focusLine.path === selectedFile?.path ? focusLine.line : undefined
            }
          />
        )}
      </div>
      <div className="col-span-2 min-h-0 overflow-auto border-l border-border-subtle">
        <NormalizerProjectTree
          files={files}
          markers={changeMarkers}
          selectedPath={selectedFile?.path ?? selectedFilePath}
          onSelect={onSelectFilePath}
          t={t}
        />
      </div>
    </div>
  );
}
