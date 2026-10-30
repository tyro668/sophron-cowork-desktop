import { formatLocation, runAutoFixLoop, type FixErrorReport } from '../../../shared/fix-error';
import {
  applyNormalizerGenerationProgress,
  formatGenerationElapsed,
  type GenerationHistoryItem,
  markNormalizerGenerationError,
  type NormalizerGenerationLog,
  type NormalizerGenerationStepPhase,
} from './raw-table-normalizer-utils';
import type { TranslateFn } from './shared';

/** A failed preview / trial run (or a 通过但结果异常 verdict) to hand to the model. */
export interface FixFailure {
  /** One-line reason for rows, the step bar and previousAttempts. */
  message: string;
  /** Raw error text sent to the main process (prefixes/paths/secrets stripped there). */
  error: string;
  log?: string;
  exitCode?: number;
  durationMs?: number;
}

export interface FixTurnRequest {
  error: string;
  log?: string;
  exitCode?: number;
  durationMs?: number;
  note?: string;
  round: number;
  maxRounds: number;
  previousAttempts: string[];
}

export interface FixTurnResult {
  versionNumber: number;
  changedFiles: string[];
  summary?: string;
  replaced?: boolean;
}

export interface VerifyResult {
  passed: boolean;
  failure?: FixFailure;
  rows?: number;
  cols?: number;
}

export interface FixFlowResult {
  passed: boolean;
  rounds: number;
  last?: FixTurnResult;
  lastVerify?: VerifyResult;
  changedFiles: string[];
  error?: string;
}

export function fixStepTitles(
  t: TranslateFn,
  verifyKind: 'preview' | 'trial'
): Partial<Record<NormalizerGenerationStepPhase, string>> {
  return {
    source_summary: t('fixError.stepRead'),
    source_analysis: t('fixError.stepAnalyze'),
    code_generation: t('fixError.stepEdit'),
    saving: t('fixError.stepSave'),
    verify: verifyKind === 'trial' ? t('fixError.stepVerifyTrial') : t('fixError.stepVerify'),
  };
}

/**
 * One 交给 AI 修复 turn in the generation console: fix the current draft → rerun the preview /
 * trial → judge it, repeating up to `maxRounds` (自动修复) with the new failure each time.
 * Finished rounds fold into one row each with their reason; the result stays a draft.
 */
export async function runFixFlow(options: {
  log: NormalizerGenerationLog;
  flush: () => void;
  maxRounds: number;
  initial: FixFailure;
  note?: string;
  verifyKind: 'preview' | 'trial';
  t: TranslateFn;
  fix: (
    request: FixTurnRequest,
    onProgress: (event: { phase: string; kind: 'message' | 'delta'; text: string }) => void
  ) => Promise<FixTurnResult>;
  verify: (fixed: FixTurnResult) => Promise<VerifyResult>;
}): Promise<FixFlowResult> {
  const { log, flush, t } = options;
  const max = Math.max(1, Math.min(5, options.maxRounds));
  const multi = max > 1;
  const changed = new Set<string>();
  let last: FixTurnResult | undefined;
  let lastVerify: VerifyResult | undefined;
  let roundStartedAt = Date.now();
  log.stepTitles = fixStepTitles(t, options.verifyKind);
  log.rounds = multi ? [] : undefined;
  const result = await runAutoFixLoop<FixFailure>({
    maxRounds: max,
    initialFailure: options.initial,
    fix: async (failure, round, previous) => {
      roundStartedAt = Date.now();
      if (round > 1) log.steps = [];
      log.roundLabel = multi ? t('fixError.roundLabel', { round, max }) : undefined;
      flush();
      const fixed = await options.fix(
        {
          error: failure.error,
          log: failure.log,
          exitCode: failure.exitCode,
          durationMs: failure.durationMs,
          note: options.note?.trim() || undefined,
          round,
          maxRounds: max,
          previousAttempts: previous,
        },
        (event) => {
          if (event.phase === 'error') return; // reported once by the catch below
          applyNormalizerGenerationProgress(log, event);
          flush();
        }
      );
      for (const step of log.steps) if (step.status === 'active') step.status = 'done';
      last = fixed;
      fixed.changedFiles.forEach((path) => changed.add(path));
      return {
        version: fixed.versionNumber,
        changedFiles: fixed.changedFiles,
        summary: fixed.summary,
      };
    },
    verify: async (round) => {
      const fixed = last!;
      applyNormalizerGenerationProgress(log, {
        phase: 'verify',
        kind: 'message',
        text: t(
          options.verifyKind === 'trial' ? 'fixError.verifyRunningTrial' : 'fixError.verifyRunning',
          {
            version: fixed.versionNumber,
          }
        ),
      });
      flush();
      let verdict: VerifyResult;
      try {
        verdict = await options.verify(fixed);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        verdict = { passed: false, failure: { message, error: message } };
      }
      lastVerify = verdict;
      const step = log.steps.find((item) => item.phase === 'verify');
      const passedText =
        options.verifyKind === 'trial'
          ? t('fixError.trialPassed', { rows: verdict.rows ?? 0, cols: verdict.cols ?? 0 })
          : t('fixError.verifyPassed', { rows: verdict.rows ?? 0, cols: verdict.cols ?? 0 });
      const verdictText = verdict.passed
        ? passedText
        : t('fixError.verifyFailed', { reason: verdict.failure?.message ?? '' });
      if (step) {
        step.notes.splice(0, step.notes.length, verdictText);
        step.status = verdict.passed ? 'done' : 'error';
      }
      if (multi) {
        log.rounds!.push({
          title: fixed.changedFiles.length
            ? t('fixError.roundTitle', { round, files: fixed.changedFiles.join('、') })
            : t('fixError.roundTitleNoFiles', { round }),
          status: verdict.passed ? 'success' : 'error',
          lines: [fixed.summary, verdictText].filter((line): line is string => Boolean(line)),
          elapsedMs: Date.now() - roundStartedAt,
        });
        log.steps = [];
      }
      flush();
      return verdict.passed
        ? null
        : (verdict.failure ?? { message: verdictText, error: verdictText });
    },
  });
  log.finishedAt = Date.now();
  if (result.stoppedReason === 'fix_error') {
    const reason = result.rounds.at(-1)?.reason ?? '';
    markNormalizerGenerationError(log, t('fixError.fixError', { reason }));
    flush();
    return {
      passed: false,
      rounds: result.rounds.length,
      last,
      lastVerify,
      changedFiles: [...changed],
      error: reason,
    };
  }
  const files = [...changed];
  if (last) {
    log.outcome = {
      status: result.passed ? 'success' : 'error',
      title: result.passed
        ? t(last.replaced ? 'fixError.resultOverwritten' : 'fixError.resultSaved', {
            version: last.versionNumber,
            count: files.length,
          })
        : t('fixError.resultFailed', {
            rounds: result.rounds.length,
            reason: lastVerify?.failure?.message ?? '',
          }),
      details: result.passed && !multi && last.summary ? [last.summary] : [],
      files,
    };
  }
  log.roundLabel = multi
    ? t('fixError.roundLabel', { round: result.rounds.length, max })
    : undefined;
  flush();
  return {
    passed: result.passed,
    rounds: result.rounds.length,
    last,
    lastVerify,
    changedFiles: files,
  };
}

/** Fold a finished console turn into one history row. */
export function historyFromLog(
  log: NormalizerGenerationLog,
  fallbackTitle: string
): GenerationHistoryItem[] {
  const own = log.history ?? [];
  const elapsed =
    log.finishedAt !== undefined ? formatGenerationElapsed(log.finishedAt - log.startedAt) : '';
  const files = log.outcome?.files ?? [];
  return [
    ...own,
    {
      title: log.turnTitle ?? fallbackTitle,
      detail: [elapsed, files.length ? `${files.length} 个文件` : ''].filter(Boolean).join(' · '),
      status: log.outcome?.status === 'error' ? 'error' : 'success',
      lines: [
        ...(log.rounds ?? []).map(
          (round) => `${round.status === 'success' ? '✓' : '✕'} ${round.title}`
        ),
        ...(log.outcome ? [log.outcome.title, ...log.outcome.details] : []),
      ],
    },
  ];
}

/** History row for the failure being fixed (title + reason, location and traceback tail). */
export function failureHistoryItem(title: string, report: FixErrorReport): GenerationHistoryItem {
  return {
    title,
    detail: report.message,
    status: 'error',
    lines: [
      ...(report.location ? [formatLocation(report.location)] : []),
      ...report.traceback.split('\n').slice(-8),
    ],
  };
}

/** Console log for a new fix turn: folded history, the 修复 divider and 报错 / 位置 / 补充. */
export function createFixLog(input: {
  history: GenerationHistoryItem[];
  turnTitle: string;
  report: FixErrorReport;
  note?: string;
  request?: string;
  verifyKind: 'preview' | 'trial';
  t: TranslateFn;
}): NormalizerGenerationLog {
  const { t } = input;
  return {
    history: input.history,
    turnTitle: input.turnTitle,
    meta: [
      ...(input.request
        ? [{ label: t('fixError.metaRequest'), value: input.request }]
        : [{ label: t('fixError.metaError'), value: input.report.message }]),
      ...(input.report.location
        ? [{ label: t('fixError.metaLocation'), value: formatLocation(input.report.location) }]
        : []),
      ...(!input.request
        ? [{ label: t('fixError.metaNote'), value: input.note?.trim() || '—' }]
        : []),
    ],
    steps: [],
    startedAt: Date.now(),
    stepTitles: fixStepTitles(t, input.verifyKind),
  };
}
