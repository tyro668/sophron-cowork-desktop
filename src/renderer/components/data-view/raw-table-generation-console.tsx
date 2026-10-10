import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, CircleDashed, Loader2, Sparkles, Terminal, X } from 'lucide-react';
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

function GenerationStepView({ step, t }: { step: NormalizerGenerationStep; t: TranslateFn }) {
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
          {t(STEP_TITLE_KEYS[step.phase])}
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

export function RawTableGenerationConsole({
  log,
  isStreaming,
  onViewCode,
  t,
}: {
  log: NormalizerGenerationLog | null;
  isStreaming: boolean;
  onViewCode?: () => void;
  t: TranslateFn;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [now, setNow] = useState(() => Date.now());

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
  }, [log, isStreaming]);

  const elapsedMs = log ? (log.finishedAt ?? now) - log.startedAt : 0;
  const statusChip = isStreaming ? (
    <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-accent-muted px-2 text-[11px] font-medium text-accent">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      {t('data.rawTables.editor.generationOutputStreaming')}
    </span>
  ) : log?.outcome ? (
    log.outcome.status === 'success' ? (
      <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-success/10 px-2 text-[11px] font-medium text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {t('data.rawTables.editor.generationOutputDone')}
      </span>
    ) : (
      <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-error/10 px-2 text-[11px] font-medium text-error">
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {t('data.rawTables.editor.generationOutputFailedTitle')}
      </span>
    )
  ) : (
    <span
      className="inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium"
      style={{ color: 'var(--code-preview-muted)' }}
    >
      <CircleDashed className="h-3 w-3" />
      {t('data.rawTables.editor.generationOutputIdle')}
    </span>
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-muted"
      style={{ backgroundColor: 'var(--code-preview-background)' }}
    >
      <div
        className="flex h-10 flex-shrink-0 items-center justify-between gap-3 border-b px-3.5"
        style={{ borderColor: 'var(--code-preview-gutter-border)' }}
      >
        <div className="inline-flex min-w-0 items-center gap-2">
          <Terminal className="h-3.5 w-3.5 flex-shrink-0 text-accent" />
          <span
            className="truncate text-[13px] font-medium"
            style={{ color: 'var(--code-preview-text)' }}
          >
            {t('data.rawTables.editor.generationOutputTitle')}
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2.5">
          {log ? (
            <span className="font-mono text-[11px]" style={{ color: 'var(--code-preview-muted)' }}>
              {formatGenerationElapsed(elapsedMs)}
            </span>
          ) : null}
          {statusChip}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const container = event.currentTarget;
          stickToBottomRef.current =
            container.scrollHeight - container.scrollTop - container.clientHeight < 48;
        }}
        className="min-h-0 flex-1 overflow-auto px-4 py-3"
      >
        {!log ? (
          <div
            className="flex h-full min-h-24 flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 text-center"
            style={{
              borderColor: 'var(--code-preview-gutter-border)',
              color: 'var(--code-preview-muted)',
            }}
          >
            <Sparkles className="h-4 w-4" />
            <span className="text-[12px] font-medium">
              {t('data.rawTables.editor.generatedStatusEmpty')}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid gap-0.5">
              {log.meta.map((item, index) => (
                <div key={index} className="break-all text-[12px] leading-5">
                  <span style={{ color: 'var(--code-preview-muted)' }}>{item.label}: </span>
                  <span style={{ color: 'var(--code-preview-text)' }}>{item.value}</span>
                </div>
              ))}
            </div>
            {log.steps.length > 0 ? (
              <div className="flex flex-col gap-0.5">
                {log.steps.map((step) => (
                  <GenerationStepView key={`${log.startedAt}:${step.phase}`} step={step} t={t} />
                ))}
              </div>
            ) : null}
            {log.outcome ? (
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
                {log.outcome.status === 'success' && onViewCode ? (
                  <button
                    type="button"
                    onClick={onViewCode}
                    className="ml-6 mt-0.5 w-fit text-[12px] font-medium text-accent transition-colors hover:underline"
                  >
                    {t('data.rawTables.editor.generationViewCode')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {isStreaming ? (
        <div
          className="flex h-9 flex-shrink-0 items-center justify-between gap-3 border-t px-3.5"
          style={{ borderColor: 'var(--code-preview-gutter-border)' }}
        >
          <span
            className="inline-flex items-center gap-2 text-[12px] font-medium"
            style={{ color: 'var(--code-preview-text)' }}
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
            {t('data.rawTables.editor.generateProjectDrafting')}
          </span>
          <span className="font-mono text-[11px]" style={{ color: 'var(--code-preview-muted)' }}>
            {formatGenerationElapsed(elapsedMs)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
