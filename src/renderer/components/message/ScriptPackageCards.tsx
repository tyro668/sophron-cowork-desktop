import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Check, FileCode2, Loader2, Rocket } from 'lucide-react';
import type {
  ContentBlock,
  ToolResultContent,
  ToolUseContent,
} from '../../../shared/contracts/session';
import type { ScriptPackageSummary } from '../../../shared/automation/script-package';
import { useAppStore } from '../../store';

export interface SavedScriptPackageRef {
  id: string;
  name: string;
  version: number;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Script package drafts saved by `script_package_save` calls in these blocks (last save per package wins). */
export function extractSavedScriptPackages(blocks: ContentBlock[]): SavedScriptPackageRef[] {
  const saveIds = new Set(
    blocks
      .filter(
        (block): block is ToolUseContent =>
          block.type === 'tool_use' && /(^|[_.:])script_package_save$/.test(block.name)
      )
      .map((block) => block.id)
  );
  const found = new Map<string, SavedScriptPackageRef>();
  for (const block of blocks) {
    if (block.type !== 'tool_result') continue;
    const result = block as ToolResultContent;
    if (result.isError || !saveIds.has(result.toolUseId)) continue;
    const value = parseJsonObject(result.content);
    if (!value || typeof value.id !== 'string' || typeof value.version !== 'number') continue;
    found.set(value.id, {
      id: value.id,
      name: typeof value.name === 'string' ? value.name : value.id,
      version: value.version,
    });
  }
  return [...found.values()];
}

const ScriptPackageCard = memo(function ScriptPackageCard({
  saved,
}: {
  saved: SavedScriptPackageRef;
}) {
  const { t } = useTranslation();
  const openScriptEditor = useAppStore((state) => state.openScriptEditor);
  const scriptEditorOpen = useAppStore((state) => state.scriptEditor !== null);
  const [summary, setSummary] = useState<ScriptPackageSummary | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.automation?.scripts;
    if (!api) return;
    try {
      setSummary(await api.get(saved.id));
    } catch {
      setSummary(null);
    }
  }, [saved.id]);

  useEffect(() => {
    if (!scriptEditorOpen) void refresh();
  }, [refresh, scriptEditorOpen]);

  const published = summary?.published?.version;
  const isPublished = published === saved.version;
  const archived = !isPublished && published !== undefined && published > saved.version;

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.automation.scripts.publish(saved.id, saved.version);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="script-package-card"
      className="flex min-h-12 items-center gap-3 rounded-xl border border-border-muted bg-surface px-3 py-2 shadow-soft"
    >
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent">
        <FileCode2 className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-text-primary">
          {summary?.name ?? saved.name}
        </span>
        <span
          className="block text-[11.5px] text-text-muted"
          data-testid="script-package-card-meta"
        >
          {t('messageCard.scriptPackageKind')}
          {' · '}
          {isPublished
            ? t('scripts.editor.statusPublished', { version: saved.version })
            : archived
              ? t('messageCard.scriptArchived', { version: saved.version })
              : t('messageCard.scriptDraft', { version: saved.version })}
          {!isPublished && (
            <>
              {' · '}
              {published !== undefined
                ? t('messageCard.scriptPublishedSuffix', { version: published })
                : t('messageCard.scriptNotPublished')}
            </>
          )}
        </span>
        {error && <span className="block text-[11.5px] text-error">{error}</span>}
      </span>
      {summary !== null && !archived && (
        <button
          type="button"
          data-testid="script-package-card-publish"
          disabled={busy || isPublished || summary === undefined}
          onClick={() => void publish()}
          className="inline-flex h-7 flex-shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 text-xs text-white hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : isPublished ? (
            <Check className="h-3 w-3" />
          ) : (
            <Rocket className="h-3 w-3" />
          )}
          {isPublished ? t('messageCard.scriptPublished') : t('messageCard.scriptPublish')}
        </button>
      )}
      <button
        type="button"
        data-testid="script-package-card-open"
        disabled={summary === null}
        onClick={() =>
          openScriptEditor({ packageId: saved.id, version: saved.version, step: 'review' })
        }
        className="inline-flex h-7 flex-shrink-0 items-center gap-1 rounded-lg border border-border-muted px-2.5 text-xs text-text-secondary hover:border-accent/40 hover:text-text-primary disabled:pointer-events-none disabled:opacity-40"
      >
        {t('messageCard.scriptOpenEditor')}
        <ArrowUpRight className="h-3 w-3" />
      </button>
    </div>
  );
});

export const ScriptPackageCards = memo(function ScriptPackageCards({
  packages,
}: {
  packages: SavedScriptPackageRef[];
}) {
  if (packages.length === 0) return null;
  return (
    <div className="space-y-1.5 pt-1">
      {packages.map((saved) => (
        <ScriptPackageCard key={`${saved.id}:${saved.version}`} saved={saved} />
      ))}
    </div>
  );
});
