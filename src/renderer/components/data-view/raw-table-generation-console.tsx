import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, CircleDashed, Copy, Loader2, X } from 'lucide-react';
import {
  formatGenerationElapsed,
  type NormalizerGenerationLog,
  type NormalizerGenerationStep,
  type NormalizerGenerationStepPhase,
  type NormalizerGenerationStepStatus,
} from './raw-table-normalizer-utils';
import type { TranslateFn } from './shared';

const STEP_TITLE_KEYS: Record<NormalizerGenerationStepPhase, string> = {
  source_summary: 'data.rawTables.editor.generationStepSourceSummary',
  source_analysis: 'data.rawTables.editor.generationStepSourceAnalysis',
  code_generation: 'data.rawTables.editor.generationStepCodeGeneration',
  saving: 'data.rawTables.editor.generationStepSaving',
};

const COLLAPSED_STREAM_TAIL_LINES = 4;
const OUTCOME_FILE_LIST_LIMIT = 12;

function StepStatusIcon({ status }: { status: NormalizerGenerationStepStatus }) {
  if (status === 'active') {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />;
  }
  if (status === 'error') {
    return <X className="h-3.5 w-3.5 text-error" />;
  }
  return <Check className="h-3.5 w-3.5 text-success" />;
}

function tailStreamLines(stream: string, count: number): string {
  const lines = stream.split('\n');
  return lines.slice(Math.max(0, lines.length - count)).join('\n');
}

function GenerationStepView({
  step,
  t,
  title,
}: {
  step: NormalizerGenerationStep;
  t: TranslateFn;
  title?: string;
}) {
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(null);
  const hasStream = step.stream.length > 0;
  const expanded = collapsedOverride ?? step.status === 'active';
  const streamLineCount = hasStream ? step.stream.split('\n').length : 0;
  const shownStream = expanded
    ? step.stream
    : tailStreamLines(step.stream, COLLAPSED_STREAM_TAIL_LINES);
  const hasBody = step.notes.length > 0 || hasStream;

  return (
    <div>
      <button
        type="button"
        disabled={!hasStream}
        onClick={() => setCollapsedOverride(!expanded)}
        className="flex w-full items-center gap-2 py-1 text-left disabled:cursor-default"
      >
        <StepStatusIcon status={step.status} />
        <span
          className="min-w-0 truncate text-[13px] font-medium"
          style={{ color: 'var(--code-preview-text)' }}
        >
          {title ?? t(STEP_TITLE_KEYS[step.phase])}
        </span>
        {hasStream ? (
          <span
            className="ml-auto inline-flex flex-shrink-0 items-center gap-1 text-[11px] font-medium"
            style={{ color: 'var(--code-preview-muted)' }}
          >
            {!expanded
              ? t('data.rawTables.editor.generationStreamOutputLines', {
                  count: streamLineCount,
                })
              : null}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${expanded ? '' : '-rotate-90'}`}
            />
          </span>
        ) : null}
      </button>
      {hasBody ? (
        <div
          className="ml-[7px] border-l pl-3"
          style={{ borderColor: 'var(--code-preview-gutter-border)' }}
        >
          {step.notes.map((note, index) => (
            <div
              key={index}
              className="break-all py-0.5 text-[12px] leading-5"
              style={{ color: 'var(--code-preview-muted)' }}
            >
              {note}
            </div>
          ))}
          {hasStream ? (
            <pre
              className="whitespace-pre-wrap break-all py-1 font-mono text-[11px] leading-[1.7]"
              style={{ color: 'var(--code-preview-muted)' }}
            >
              {expanded ? null : <span className="block">…</span>}
              {shownStream}
              {step.status === 'active' ? (
                <span className="animate-pulse text-accent">▍</span>
              ) : null}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function serializeGenerationLog(
  log: NormalizerGenerationLog | null,
  errorMessage: string | null | undefined,
  t: TranslateFn
): string {
  const lines: string[] = [];
  if (log) {
    for (const item of log.meta) lines.push(`${item.label}: ${item.value}`);
    for (const step of log.steps) {
      const mark = step.status === 'active' ? '…' : step.status === 'error' ? '✕' : '✓';
      lines.push(`${mark} ${t(STEP_TITLE_KEYS[step.phase])}`);
      for (const note of step.notes) lines.push(`  ${note}`);
      if (step.stream) lines.push(step.stream);
    }
    if (log.outcome) {
      lines.push(`${log.outcome.status === 'success' ? '✓' : '✕'} ${log.outcome.title}`);
      lines.push(...log.outcome.details, ...log.outcome.files);
    }
  }
  if (errorMessage && !(log?.outcome?.status === 'error' && log.outcome.title === errorMessage)) {
    lines.push(`✕ ${errorMessage}`);
  }
  return lines.join('\n');
}

export function RawTableGenerationConsole({
  log,
  isStreaming,
  errorMessage,
  modelLabel,
  stepTitles,
  t,
}: {
  log: NormalizerGenerationLog | null;
  /** Override step titles (script packages use their own phases). */
  stepTitles?: Partial<Record<NormalizerGenerationStepPhase, string>>;
  isStreaming: boolean;
  /** Error raised outside the log (e.g. request failure); rendered as the final log line. */
  errorMessage?: string | null;
  modelLabel?: string;
  t: TranslateFn;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isStreaming) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [isStreaming]);

  useEffect(() => {
    stickToBottomRef.current = true;
  }, [log?.startedAt]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container && stickToBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [log, isStreaming, errorMessage]);

  const elapsedMs = log ? (log.finishedAt ?? now) - log.startedAt : 0;
  const failed = !isStreaming && (log?.outcome?.status === 'error' || !!errorMessage);
  const extraError =
    !isStreaming &&
    errorMessage &&
    !(log?.outcome?.status === 'error' && log.outcome.title === errorMessage)
      ? errorMessage
      : null;
  const statusChip = isStreaming ? (
    <span className="inline-flex h-5 items-center gap-1.5 rounded bg-accent-muted px-1.5 text-[11px] font-medium text-accent">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      {t('data.rawTables.editor.generationOutputStreaming')}
    </span>
  ) : failed ? (
    <span className="inline-flex h-5 items-center gap-1.5 rounded bg-error/10 px-1.5 text-[11px] font-medium text-error">
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {t('data.rawTables.editor.generationOutputFailedTitle')}
    </span>
  ) : log?.outcome ? (
    <span className="inline-flex h-5 items-center gap-1.5 rounded bg-success/10 px-1.5 text-[11px] font-medium text-success">
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {t('data.rawTables.editor.generationOutputDone')}
    </span>
  ) : (
    <span className="inline-flex h-5 items-center gap-1.5 rounded bg-surface-muted px-1.5 text-[11px] font-medium text-text-muted">
      <CircleDashed className="h-3 w-3" />
      {t('data.rawTables.editor.generationOutputIdle')}
    </span>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="generation-console">
      <div
        className="ui-form-row flex-shrink-0 !grid-cols-[104px_minmax(0,1fr)_120px_92px] !border-b"
        data-testid="generation-status-row"
      >
        <div className="ui-form-label items-center">
          {t('data.rawTables.editor.generationStatusLabel')}
        </div>
        <div
          className="flex min-w-0 items-center gap-2.5 px-2.5"
          data-status={isStreaming ? 'running' : failed ? 'error' : log?.outcome ? 'done' : 'idle'}
        >
          {statusChip}
          {log ? (
            <span className="font-mono text-[11.5px] tabular-nums text-text-muted">
              {formatGenerationElapsed(elapsedMs)}
            </span>
          ) : null}
        </div>
        <div
          className="flex min-w-0 items-center border-l border-border-subtle px-2.5 text-xs text-text-muted"
          title={modelLabel}
        >
          <span className="truncate">{modelLabel}</span>
        </div>
        <button
          type="button"
          disabled={!log && !errorMessage}
          data-testid="generation-copy-log"
          onClick={() => {
            void navigator.clipboard?.writeText(serializeGenerationLog(log, errorMessage, t));
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
          className={`inline-flex items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium transition-colors hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50 ${
            copied ? 'text-success' : 'text-text-secondary hover:text-accent'
          }`}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t('data.rawTables.editor.copiedLog') : t('data.rawTables.editor.copyLog')}
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const container = event.currentTarget;
          stickToBottomRef.current =
            container.scrollHeight - container.scrollTop - container.clientHeight < 48;
        }}
        className="min-h-0 flex-1 overflow-auto px-3.5 py-2.5"
        style={{ backgroundColor: 'var(--code-preview-background)' }}
        data-testid="generation-log"
      >
        {!log && !extraError ? (
          <div className="text-[12px] leading-6" style={{ color: 'var(--code-preview-muted)' }}>
            {t('data.rawTables.editor.generatedStatusEmpty')}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {log && log.meta.length > 0 ? (
              <div className="flex flex-wrap gap-x-4 text-[12px] leading-6">
                {log.meta.map((item, index) => (
                  <span key={index} className="break-all">
                    <span style={{ color: 'var(--code-preview-muted)' }}>{item.label}：</span>
                    <span style={{ color: 'var(--code-preview-text)' }}>{item.value}</span>
                  </span>
                ))}
              </div>
            ) : null}
            {log && log.steps.length > 0 ? (
              <div className="flex flex-col gap-0.5">
                {log.steps.map((step) => (
                  <GenerationStepView
                    key={`${log.startedAt}:${step.phase}`}
                    step={step}
                    t={t}
                    title={stepTitles?.[step.phase]}
                  />
                ))}
              </div>
            ) : null}
            {log?.outcome ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 py-1">
                  {log.outcome.status === 'success' ? (
                    <Check className="h-3.5 w-3.5 flex-shrink-0 text-success" />
                  ) : (
                    <X className="h-3.5 w-3.5 flex-shrink-0 text-error" />
                  )}
                  <span
                    className="min-w-0 break-all text-[13px] font-medium"
                    style={{
                      color:
                        log.outcome.status === 'success'
                          ? 'var(--color-success)'
                          : 'var(--color-error)',
                    }}
                  >
                    {log.outcome.title}
                  </span>
                </div>
                {log.outcome.details.map((line, index) => (
                  <div
                    key={index}
                    className="break-all pl-6 text-[12px] leading-5"
                    style={{ color: 'var(--code-preview-muted)' }}
                  >
                    {line}
                  </div>
                ))}
                {log.outcome.files.length > 0 ? (
                  <div
                    className="ml-[7px] border-l pl-3"
                    style={{ borderColor: 'var(--code-preview-gutter-border)' }}
                  >
                    {log.outcome.files.slice(0, OUTCOME_FILE_LIST_LIMIT).map((path) => (
                      <div
                        key={path}
                        className="break-all py-0.5 font-mono text-[11px] leading-5"
                        style={{ color: 'var(--code-preview-muted)' }}
                      >
                        {path}
                      </div>
                    ))}
                    {log.outcome.files.length > OUTCOME_FILE_LIST_LIMIT ? (
                      <div
                        className="py-0.5 font-mono text-[11px] leading-5"
                        style={{ color: 'var(--code-preview-muted)' }}
                      >
                        … +{log.outcome.files.length - OUTCOME_FILE_LIST_LIMIT}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            {extraError ? (
              <div className="flex items-start gap-2 py-1" data-testid="generation-error-line">
                <X className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-error" />
                <span
                  className="min-w-0 break-all text-[13px] font-medium"
                  style={{ color: 'var(--color-error)' }}
                >
                  {extraError}
                </span>
              </div>
            ) : null}
            {isStreaming ? (
              <div className="text-[12px]" style={{ color: 'var(--code-preview-muted)' }}>
                {t('data.rawTables.editor.generateProjectDrafting')}
                <span className="animate-pulse text-accent"> ▍</span>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
