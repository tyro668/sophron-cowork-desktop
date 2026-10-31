import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, FileCode2, Loader2, Wand2, XCircle } from 'lucide-react';
import type { ScriptPackageSummary } from '../../../shared/automation/script-package';
import {
  countChatEndpoints,
  describeChatResult,
  detectScheduleTime,
  type ChatScriptTurn,
} from '../../../shared/chat-to-script';
import { useAppStore, type ChatScriptJob } from '../../store';

/** 对话「转成脚本」 state of one assistant message (the last message of a turn). */
export interface ChatScriptMessageInfo {
  sessionId: string;
  /** Show 转成脚本 / 再次转成脚本 in the action row. */
  entry?: 'convert' | 'reconvert';
  /** Packages generated from this turn (backlink cards). */
  packages: ScriptPackageSummary[];
  job?: ChatScriptJob;
  /** script_package_propose card: the turn it converts (null = none qualifies yet). */
  proposal?: { target: ChatScriptTurn | null; scheduleTime?: string };
}

const cardClass =
  'flex min-h-12 items-center gap-3 rounded-xl border border-border-muted bg-surface px-3 py-2 shadow-soft';
const iconClass =
  'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent';
const openClass =
  'inline-flex h-7 flex-shrink-0 items-center gap-1 rounded-lg border border-border-muted px-2.5 text-xs text-text-secondary hover:border-accent/40 hover:text-text-primary disabled:pointer-events-none disabled:opacity-40';

/** 「由本轮生成 · v1 草稿 · 试运行 10 行」 + 在编辑器中查看. */
const BacklinkCard = memo(function BacklinkCard({ pkg }: { pkg: ScriptPackageSummary }) {
  const { t } = useTranslation();
  const openScriptEditor = useAppStore((state) => state.openScriptEditor);
  const latest = pkg.draft ?? pkg.published;
  const isPublished = Boolean(latest && pkg.published?.version === latest.version);
  const meta = [
    t('messageCard.scriptPackageKind'),
    t('chatScript.fromThisTurn'),
    latest
      ? isPublished
        ? t('scripts.editor.statusPublished', { version: latest.version })
        : t('messageCard.scriptDraft', { version: latest.version })
      : null,
    latest
      ? latest.rows != null
        ? t('chatScript.trialRows', { count: latest.rows })
        : t('chatScript.trialNotPassed')
      : null,
    !isPublished
      ? pkg.published
        ? t('messageCard.scriptPublishedSuffix', { version: pkg.published.version })
        : t('messageCard.scriptNotPublished')
      : null,
  ].filter(Boolean);
  return (
    <div data-testid="chat-script-backlink" className={cardClass}>
      <span className={iconClass}>
        <FileCode2 className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-text-primary">{pkg.name}</span>
        <span className="block text-[11.5px] text-text-muted">{meta.join(' · ')}</span>
      </span>
      <button
        type="button"
        data-testid="chat-script-backlink-open"
        onClick={() => openScriptEditor({ packageId: pkg.id, step: 'review' })}
        className={openClass}
      >
        {t('messageCard.scriptOpenEditor')}
        <ArrowUpRight className="h-3 w-3" />
      </button>
    </div>
  );
});

/** 生成中 / 生成失败 while the editor (possibly in the background) works on this turn. */
function JobCard({ job, name }: { job: ChatScriptJob; name?: string }) {
  const { t } = useTranslation();
  const openScriptEditor = useAppStore((state) => state.openScriptEditor);
  const failed = job.status === 'failed';
  return (
    <div data-testid="chat-script-job" className={cardClass}>
      <span className={failed ? `${iconClass} !bg-error/10 !text-error` : iconClass}>
        {failed ? (
          <XCircle className="h-3.5 w-3.5" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-text-primary">
          {name ?? t('messageCard.scriptPackageKind')}
        </span>
        <span
          className={`block truncate text-[11.5px] ${failed ? 'text-error' : 'text-text-muted'}`}
        >
          {failed
            ? t('chatScript.jobFailed', { reason: job.error ?? '' })
            : t('chatScript.jobRunning')}
        </span>
      </span>
      <button
        type="button"
        disabled={!job.packageId}
        onClick={() =>
          job.packageId && openScriptEditor({ packageId: job.packageId, step: 'review' })
        }
        className={openClass}
      >
        {t('messageCard.scriptOpenEditor')}
        <ArrowUpRight className="h-3 w-3" />
      </button>
    </div>
  );
}

/** Card the chat agent places with script_package_propose (「每天自动跑」). */
function ProposalCard({
  sessionId,
  sessionTitle,
  target,
  scheduleTime,
}: {
  sessionId: string;
  sessionTitle: string;
  target: ChatScriptTurn | null;
  scheduleTime?: string;
}) {
  const { t } = useTranslation();
  const openDialog = useAppStore((state) => state.openChatScriptDialog);
  const time = scheduleTime;
  const meta = target
    ? [
        t('chatScript.turnN', { turn: target.turn }),
        describeChatResult(target.results[0]),
        t('chatScript.endpoints', { count: countChatEndpoints(target) }),
        time ? t('chatScript.dailyAt', { time }) : null,
      ].filter(Boolean)
    : [t('chatScript.noTurnYet')];
  return (
    <div data-testid="chat-script-proposal" className={cardClass}>
      <span className={iconClass}>
        <FileCode2 className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-text-primary">
          {t('chatScript.proposalTitle', { title: sessionTitle })}
        </span>
        <span className="block truncate text-[11.5px] text-text-muted">{meta.join(' · ')}</span>
      </span>
      <button
        type="button"
        data-testid="chat-script-proposal-convert"
        disabled={!target}
        onClick={() =>
          target &&
          openDialog({
            sessionId,
            messageId: target.anchorId,
            ...(time ? { scheduleTime: time } : {}),
          })
        }
        className="inline-flex h-7 flex-shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 text-xs text-white hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50"
      >
        <Wand2 className="h-3 w-3" />
        {t('chatScript.convert')}
      </button>
    </div>
  );
}

export const ChatScriptCards = memo(function ChatScriptCards({
  info,
  sessionTitle,
  userText,
}: {
  info: ChatScriptMessageInfo;
  sessionTitle: string;
  userText?: string;
}) {
  const shown = info.job
    ? info.packages.filter((pkg) => pkg.id !== info.job?.packageId)
    : info.packages;
  if (!info.job && shown.length === 0 && !info.proposal) return null;
  return (
    <div className="space-y-1.5 pt-1">
      {info.proposal && (
        <ProposalCard
          sessionId={info.sessionId}
          sessionTitle={sessionTitle}
          target={info.proposal.target}
          scheduleTime={info.proposal.scheduleTime ?? detectScheduleTime(userText ?? '')}
        />
      )}
      {info.job && (
        <JobCard
          job={info.job}
          name={info.packages.find((pkg) => pkg.id === info.job?.packageId)?.name}
        />
      )}
      {shown.map((pkg) => (
        <BacklinkCard key={pkg.id} pkg={pkg} />
      ))}
    </div>
  );
});
