import { Folder, FolderOpen, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  ScriptPackageSummary,
  ScriptRuntime,
} from '../../../shared/automation/script-package';
import { RawTableConfigRow } from '../data-view/ColumnTypeOverridesEditor';
import { formatDisplayPath } from '../data-view/shared';
import { SecretsEditor } from '../secrets/secrets-ui';

interface ScriptOriginInfo {
  sessionId: string;
  sessionTitle: string;
  turn: number;
}

interface ScriptMetadataSectionProps {
  packageId?: string;
  summary: ScriptPackageSummary | null;
  secretsKey: number;
  generating: boolean;
  origin?: ScriptOriginInfo | null;
  originSessionExists: boolean;
  runtimeLabel: (runtime: ScriptRuntime) => string;
  onOpenFolder: () => void;
  onOpenOriginSession: (sessionId: string) => void;
}

export function ScriptMetadataSection({
  packageId,
  summary,
  secretsKey,
  generating,
  origin,
  originSessionExists,
  runtimeLabel,
  onOpenFolder,
  onOpenOriginSession,
}: ScriptMetadataSectionProps) {
  const { t } = useTranslation();

  return (
    <section className="ui-group ui-form-flush flex-shrink-0 bg-surface">
      <div className="ui-group-title">{t('schedule.script.package')}</div>
      <RawTableConfigRow label={t('scripts.editor.folder')}>
        <div className="flex min-h-[35px] min-w-0 flex-1 items-stretch">
          <div className="flex min-w-0 flex-1 items-center gap-2 px-[10px]">
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-accent-muted text-accent">
              <Folder className="h-3.5 w-3.5" />
            </span>
            <div
              className="min-w-0 truncate font-mono text-[12px] text-text-primary"
              title={summary?.dir}
            >
              {summary?.dir ? formatDisplayPath(summary.dir) : t('scripts.editor.folderPending')}
            </div>
          </div>
          <button
            type="button"
            disabled={!packageId}
            onClick={onOpenFolder}
            className="ui-accent-cell w-[120px] flex-shrink-0 border-l border-border-subtle"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t('scripts.editor.openFolder')}
          </button>
        </div>
      </RawTableConfigRow>
      <RawTableConfigRow label={t('schedule.script.entry')}>
        <span className="ui-flush-text text-text-muted">
          {summary
            ? [
                summary.entry,
                summary.runtimeVersion ?? runtimeLabel(summary.runtime),
                summary.depsReady
                  ? t('schedule.script.depsReady')
                  : t('schedule.script.depsOnFirstRun'),
              ].join(' · ')
            : '—'}
        </span>
      </RawTableConfigRow>
      <RawTableConfigRow label={t('secrets.label')}>
        <SecretsEditor
          kind="script"
          ownerId={packageId}
          refreshKey={secretsKey}
          disabled={generating}
        />
      </RawTableConfigRow>
      {origin && (
        <RawTableConfigRow label={t('chatScript.sourceLabel')}>
          <div
            className="flex min-h-[35px] min-w-0 flex-1 items-stretch"
            data-testid="script-origin"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2 px-[10px] text-[12px] text-text-muted">
              <MessageSquare className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">
                {originSessionExists
                  ? t('chatScript.sourceValue', {
                      title: origin.sessionTitle,
                      turn: origin.turn,
                    })
                  : t('chatScript.sourceDeleted', { title: origin.sessionTitle })}
              </span>
            </div>
            <button
              type="button"
              disabled={!originSessionExists}
              onClick={() => onOpenOriginSession(origin.sessionId)}
              data-testid="script-origin-open"
              className="ui-accent-cell w-[120px] flex-shrink-0 border-l border-border-subtle disabled:opacity-40"
            >
              {t('chatScript.openConversation')}
            </button>
          </div>
        </RawTableConfigRow>
      )}
    </section>
  );
}
