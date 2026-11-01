/**
 * Registry of cancellable AI runs started from the renderer (规则生成, AI 修复, 转成脚本 要点提取).
 * 取消 aborts one run by id; closing the window that started a run, or quitting the app, aborts
 * it too, so no model request keeps streaming (and billing) without anyone waiting for it.
 */
import { log } from '../utils/logger';

interface RunOwner {
  isDestroyed(): boolean;
  once(event: 'destroyed', listener: () => void): unknown;
  removeListener(event: 'destroyed', listener: () => void): unknown;
}

interface TrackedRun {
  controller: AbortController;
  release: () => void;
}

const runs = new Map<string, TrackedRun>();

/**
 * Track `id` until the returned release is called. Starting a run under an id that is still
 * running aborts the older one (a renderer retry must not leave an orphan request).
 */
export function startAiRun(
  id: string,
  owner?: RunOwner
): { signal: AbortSignal; release: () => void } {
  runs.get(id)?.controller.abort();
  const controller = new AbortController();
  const onDestroyed = () => {
    log('[AiRuns] window closed, aborting', id);
    controller.abort();
  };
  if (owner) {
    if (owner.isDestroyed()) controller.abort();
    else owner.once('destroyed', onDestroyed);
  }
  const entry: TrackedRun = {
    controller,
    release: () => {
      if (runs.get(id) === entry) runs.delete(id);
      if (owner && !owner.isDestroyed()) owner.removeListener('destroyed', onDestroyed);
    },
  };
  runs.set(id, entry);
  return { signal: controller.signal, release: entry.release };
}

/** 取消: true when a run with this id was running. */
export function cancelAiRun(id: string): boolean {
  const entry = runs.get(id);
  if (!entry) return false;
  entry.controller.abort();
  return true;
}

/** App quit: abort everything still running. */
export function abortAllAiRuns(): number {
  const count = runs.size;
  for (const entry of runs.values()) entry.controller.abort();
  runs.clear();
  return count;
}

export function runningAiRunCount(): number {
  return runs.size;
}
