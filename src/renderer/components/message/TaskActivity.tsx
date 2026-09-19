import { useId, useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Loader2, Terminal } from 'lucide-react';
import { useAppStore } from '../../store';
import type { LiveToolOutput } from '../../store';
import type { TraceStep } from '../../types';

const EMPTY_STEPS: TraceStep[] = [];
const EMPTY_OUTPUTS: Record<string, LiveToolOutput> = {};

interface TaskActivityProps {
  sessionId: string;
  activeTurnStepId: string;
  hasStreamingText: boolean;
  elapsedMs: number;
  now: number;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export function TaskActivity({
  sessionId,
  activeTurnStepId,
  hasStreamingText,
  elapsedMs,
  now,
}: TaskActivityProps) {
  const { t } = useTranslation();
  const steps = useAppStore((state) => state.sessionStates[sessionId]?.traceSteps ?? EMPTY_STEPS);
  const outputs = useAppStore(
    (state) => state.sessionStates[sessionId]?.liveToolOutputs ?? EMPTY_OUTPUTS
  );
  const lastActivityAt = useAppStore(
    (state) => state.sessionStates[sessionId]?.lastActivityAt ?? null
  );
  const activeTool = [...steps]
    .reverse()
    .find(
      (step) =>
        step.type === 'tool_call' && step.status === 'running' && step.parentId === activeTurnStepId
    );
  const showingInput = activeTool?.toolPhase === 'preparing' || activeTool?.toolPhase === 'ready';
  const liveOutput = showingInput
    ? activeTool?.toolInputPreview
    : activeTool
      ? outputs[activeTool.id]
      : undefined;
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);
  const expanded = Boolean(activeTool && expandedToolId === activeTool.id);
  const outputId = useId();
  const outputRef = useRef<HTMLPreElement>(null);
  const outputWasAtBottomRef = useRef(true);

  useEffect(() => {
    if (!expanded || !outputWasAtBottomRef.current || !outputRef.current) return;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [expanded, liveOutput?.text]);

  const status = activeTool
    ? t(
        activeTool.toolPhase === 'preparing'
          ? 'chat.activity.preparingTool'
          : activeTool.toolPhase === 'ready'
            ? 'chat.activity.readyTool'
            : 'chat.activity.runningTool',
        { tool: activeTool.title }
      )
    : hasStreamingText
      ? t('chat.activity.responding')
      : t('chat.activity.waitingModel');
  const idleSeconds = lastActivityAt ? Math.max(0, Math.floor((now - lastActivityAt) / 1000)) : 0;

  return (
    <div className="-mx-2 rounded-lg border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-text-secondary">
      <div className="flex min-w-0 items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" aria-hidden="true" />
        <span className="min-w-0 truncate" role="status" aria-live="polite">
          {status}
        </span>
        <span className="ml-auto shrink-0 tabular-nums text-text-muted" aria-hidden="true">
          {formatElapsed(elapsedMs)}
        </span>
      </div>
      {activeTool && (
        <button
          type="button"
          className="mt-1 flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-[11px] text-text-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          onClick={() => {
            outputWasAtBottomRef.current = true;
            setExpandedToolId(expanded ? null : activeTool.id);
          }}
          aria-expanded={expanded}
          aria-controls={expanded ? outputId : undefined}
        >
          <Terminal className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{t(showingInput ? 'chat.activity.inputPreview' : 'chat.activity.liveOutput')}</span>
          {!showingInput && liveOutput?.text && (
            <span className="min-w-0 truncate text-text-muted">
              {liveOutput.text.split('\n').at(-1)}
            </span>
          )}
          {expanded ? (
            <ChevronDown className="ml-auto h-3 w-3 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="ml-auto h-3 w-3 shrink-0" aria-hidden="true" />
          )}
        </button>
      )}
      {activeTool && expanded && (
        <div id={outputId} className="mt-1 border-t border-border-subtle pt-2">
          {liveOutput?.text ? (
            <>
              <pre
                ref={outputRef}
                onScroll={(event) => {
                  const element = event.currentTarget;
                  outputWasAtBottomRef.current =
                    element.scrollHeight - element.scrollTop - element.clientHeight <= 24;
                }}
                className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-muted p-2 font-mono text-[11px] leading-4 text-text-secondary"
              >
                {liveOutput.text}
              </pre>
              {liveOutput.truncated && (
                <p className="mt-1 text-[11px] text-text-muted">
                  {t(
                    showingInput ? 'chat.activity.inputTruncated' : 'chat.activity.outputTruncated'
                  )}
                </p>
              )}
            </>
          ) : (
            <p className="px-1 py-1 text-[11px] text-text-muted">
              {t(showingInput ? 'chat.activity.noInputYet' : 'chat.activity.noOutputYet')}
            </p>
          )}
        </div>
      )}
      {idleSeconds >= 15 && (
        <p className="mt-1 px-1 text-[11px] text-text-muted">
          {t('chat.activity.lastActivity', { count: idleSeconds })}
        </p>
      )}
    </div>
  );
}
