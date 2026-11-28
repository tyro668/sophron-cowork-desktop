import type { ServerResponse } from 'node:http';

/** Avora negotiates device concurrency, but a subscription scheme has its own single slot. */
export class LmbpSchemeQueue {
  private readonly queues = new Map<string, Set<() => void>>();

  dispatch(scheme: string, response: ServerResponse, start: () => void): void {
    const queue = this.queues.get(scheme) ?? new Set<() => void>();
    this.queues.set(scheme, queue);
    queue.add(start);

    const release = () => {
      response.off('finish', release);
      response.off('close', release);
      const wasActive = queue.values().next().value === start;
      if (!queue.delete(start)) return;
      if (!queue.size) this.queues.delete(scheme);
      else if (wasActive) queue.values().next().value?.();
    };
    response.once('finish', release);
    response.once('close', release);
    if (queue.size === 1) start();
  }

  clear(): void {
    for (const queue of this.queues.values()) queue.clear();
    this.queues.clear();
  }
}
