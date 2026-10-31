import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, Wand2, X } from 'lucide-react';
import {
  CHAT_SCRIPT_POINTS_LIMIT,
  replaceEmptyLine,
  type ChatScriptEmptyPolicy,
  type ChatScriptProposal,
} from '../../../shared/chat-to-script';
import { useAppStore } from '../../store';
import { Dialog } from '../ui/dialog';
import { GlassSelect } from '../GlassSelect';
import { RawTableConfigRow } from '../data-view/raw-table-editor-workbench';

const selectClass = 'w-full justify-between text-text-primary disabled:opacity-60';

/**
 * 对话「转成脚本」 confirm dialog: the redacted key points of a qualifying turn. What the
 * user sees in 要点 is exactly the rule prompt the script generation agent receives.
 */
export function ChatToScriptDialog() {
  const { t } = useTranslation();
  const target = useAppStore((state) => state.chatScriptDialog);
  const close = useAppStore((state) => state.closeChatScriptDialog);
  const openScriptEditor = useAppStore((state) => state.openScriptEditor);
  const [anchorId, setAnchorId] = useState<string | undefined>(undefined);
  const [proposal, setProposal] = useState<ChatScriptProposal | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [runtime, setRuntime] = useState<'python' | 'node'>('python');
  const [emptyPolicy, setEmptyPolicy] = useState<ChatScriptEmptyPolicy>('fail');
  const [points, setPoints] = useState('');
  const [afterPublish, setAfterPublish] = useState<'none' | 'create_automation'>('none');
  const [writeMode, setWriteMode] = useState<'update' | 'new'>('update');

  useEffect(() => {
    setAnchorId(target?.messageId);
    setProposal(null);
    setError(null);
  }, [target]);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.electronAPI.automation.scripts
      .chatProposal({ sessionId: target.sessionId, messageId: anchorId })
      .then((next) => {
        if (cancelled) return;
        setProposal(next);
        setName(next.name);
        setEmptyPolicy(next.emptyPolicy);
        setPoints(next.points);
        setWriteMode('update');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target, anchorId]);

  if (!target) return null;

  const needsAuth = Boolean(proposal?.needsAuth);
  const canGenerate =
    Boolean(proposal) && !loading && !needsAuth && Boolean(points.trim()) && Boolean(name.trim());
  const updating = Boolean(proposal?.existing) && writeMode === 'update';

  const generate = () => {
    if (!proposal || !canGenerate) return;
    close();
    openScriptEditor({
      chat: {
        origin: {
          sessionId: proposal.sessionId,
          sessionTitle: proposal.sessionTitle,
          turn: proposal.turn,
          messageId: proposal.anchorId,
        },
        name: name.trim(),
        runtime,
        rulePrompt: points.trim(),
        references: proposal.references,
        ...(updating && proposal.existing
          ? { packageId: proposal.existing.packageId, baseVersion: proposal.existing.baseVersion }
          : {}),
        afterPublish,
        ...((target.scheduleTime ?? proposal.scheduleTime)
          ? { scheduleTime: target.scheduleTime ?? proposal.scheduleTime }
          : {}),
      },
    });
  };

  const emptyOptions = [
    ...(proposal?.emptyLines.fallback
      ? [{ value: 'fallback', label: proposal.emptyLines.fallback.replace(/^空数据：/, '') }]
      : []),
    { value: 'fail', label: t('chatScript.emptyFail') },
  ];

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      ariaLabel={t('chatScript.dialogTitle')}
      className="w-full max-w-[640px] overflow-hidden !p-0"
    >
      <div data-testid="chat-script-dialog" className="flex max-h-[86vh] flex-col">
        <div className="flex items-start justify-between gap-3 px-3 pb-2 pt-3">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-text-primary">
              {t('chatScript.dialogTitle')}
            </div>
            <div className="truncate text-[11.5px] text-text-muted">
              {proposal?.subtitle ?? (loading ? t('chatScript.loading') : '')}
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t('common.close')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error ? (
          <div className="mx-3 mb-3 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
            {error}
          </div>
        ) : !proposal ? (
          <div className="flex items-center gap-2 px-3 pb-6 pt-4 text-xs text-text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('chatScript.loading')}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {needsAuth && (
              <div
                role="alert"
                data-testid="chat-script-auth"
                className="mb-2 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-text-primary"
              >
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-warning" />
                {t('chatScript.authUnsupported')}
              </div>
            )}
            <section className="ui-group ui-form-flush bg-surface">
              {proposal.existing && (
                <RawTableConfigRow label={t('chatScript.write')}>
                  <GlassSelect
                    ariaLabel={t('chatScript.write')}
                    value={writeMode}
                    onValueChange={(value) => setWriteMode(value as 'update' | 'new')}
                    options={[
                      { value: 'update', label: proposal.existing.label },
                      { value: 'new', label: t('chatScript.writeNew') },
                    ]}
                    triggerClassName={selectClass}
                  />
                </RawTableConfigRow>
              )}
              <RawTableConfigRow label={t('chatScript.name')}>
                <input
                  value={name}
                  maxLength={50}
                  disabled={updating}
                  onChange={(event) => setName(event.target.value)}
                  data-testid="chat-script-name"
                  className="ui-flush-text w-full border-0 bg-transparent text-text-primary outline-none disabled:text-text-muted"
                />
              </RawTableConfigRow>
              <RawTableConfigRow label={t('chatScript.runtime')}>
                <GlassSelect
                  ariaLabel={t('chatScript.runtime')}
                  value={runtime}
                  onValueChange={(value) => setRuntime(value as 'python' | 'node')}
                  options={[
                    { value: 'python', label: 'Python 3' },
                    { value: 'node', label: 'Node.js' },
                  ]}
                  triggerClassName={selectClass}
                />
              </RawTableConfigRow>
              <RawTableConfigRow label={t('chatScript.turn')}>
                <GlassSelect
                  ariaLabel={t('chatScript.turn')}
                  value={proposal.anchorId}
                  onValueChange={(value) => setAnchorId(value)}
                  options={proposal.turns.map((item) => ({
                    value: item.anchorId,
                    label: item.label,
                  }))}
                  disabled={loading}
                  triggerClassName={selectClass}
                />
              </RawTableConfigRow>
              <RawTableConfigRow label={t('chatScript.empty')}>
                <GlassSelect
                  ariaLabel={t('chatScript.empty')}
                  value={emptyPolicy}
                  onValueChange={(value) => {
                    const policy = value as ChatScriptEmptyPolicy;
                    setEmptyPolicy(policy);
                    const line =
                      policy === 'fallback' && proposal.emptyLines.fallback
                        ? proposal.emptyLines.fallback
                        : proposal.emptyLines.fail;
                    setPoints((current) =>
                      replaceEmptyLine(current, line).slice(0, CHAT_SCRIPT_POINTS_LIMIT)
                    );
                  }}
                  options={emptyOptions}
                  triggerClassName={selectClass}
                />
              </RawTableConfigRow>
              <RawTableConfigRow label={t('chatScript.points')} align="start">
                <div className="relative w-full">
                  <textarea
                    value={points}
                    onChange={(event) =>
                      setPoints(event.target.value.slice(0, CHAT_SCRIPT_POINTS_LIMIT))
                    }
                    data-testid="chat-script-points"
                    className="h-[210px] w-full resize-none border-0 bg-transparent px-2.5 py-2 pb-6 text-[12.5px] leading-6 text-text-primary outline-none"
                  />
                  <span className="pointer-events-none absolute bottom-1.5 right-2.5 text-[11px] tabular-nums text-text-muted">
                    {points.length} / {CHAT_SCRIPT_POINTS_LIMIT}
                  </span>
                </div>
              </RawTableConfigRow>
              <RawTableConfigRow label={t('chatScript.excluded')}>
                <span className="ui-flush-text text-text-muted">
                  {t('chatScript.excludedValue')}
                </span>
              </RawTableConfigRow>
              <RawTableConfigRow label={t('chatScript.afterDone')}>
                <GlassSelect
                  ariaLabel={t('chatScript.afterDone')}
                  value={afterPublish}
                  onValueChange={(value) => setAfterPublish(value as 'none' | 'create_automation')}
                  options={[
                    { value: 'none', label: t('chatScript.afterDraft') },
                    { value: 'create_automation', label: t('chatScript.afterAutomation') },
                  ]}
                  triggerClassName={selectClass}
                />
              </RawTableConfigRow>
            </section>
          </div>
        )}

        <div className="grid h-10 flex-shrink-0 grid-cols-[minmax(0,1fr)_104px_140px] border-t border-border-subtle">
          <span className="flex min-w-0 items-center truncate px-3 text-[11.5px] text-text-muted">
            {needsAuth ? t('chatScript.authUnsupported') : t('chatScript.footerNote')}
          </span>
          <button
            type="button"
            onClick={close}
            className="border-l border-border-subtle text-xs text-text-secondary hover:bg-surface-hover"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!canGenerate}
            onClick={generate}
            data-testid="chat-script-generate"
            className="ui-accent-cell border-l border-border-subtle disabled:opacity-50"
          >
            <Wand2 className="h-3.5 w-3.5" />
            {t('chatScript.generate')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
