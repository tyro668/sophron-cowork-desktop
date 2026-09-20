/**
 * Per-session serial task queue with a global concurrency bound.
 *
 * Tasks for the same key run strictly in order; tasks for different keys may
 * run in parallel up to the configured limit. A task that is superseded before
 * it runs is a no-op — callers coalesce by having the task read the latest
 * snapshot at execution time.
 */
export class MemoryIngestionQueue {
  private readonly chains = new Map<string, Promise<void>>();
  private running = 0;
  private readonly slotWaiters: Array<() => void> = [];

  constructor(private readonly getMaxConcurrency: () => number = () => 1) {}

  get pendingCount(): number {
    return this.chains.size;
  }

  get runningCount(): number {
    return this.running;
  }

  private get maxConcurrency(): number {
    return Math.max(1, this.getMaxConcurrency() || 1);
  }

  private async acquireSlot(): Promise<void> {
    if (this.running < this.maxConcurrency) {
      this.running += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.slotWaiters.push(resolve);
    });
    this.running += 1;
  }

  private releaseSlot(): void {
    this.running -= 1;
    const waiter = this.slotWaiters.shift();
    if (waiter) {
      waiter();
    }
  }

  private async runTask(task: () => Promise<void>): Promise<void> {
    await this.acquireSlot();
    try {
      await task();
    } finally {
      this.releaseSlot();
    }
  }

  enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.chains.get(key) || Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.runTask(task));
    const tracked = next.then(
      () => {
        if (this.chains.get(key) === tracked) {
          this.chains.delete(key);
        }
      },
      () => {
        if (this.chains.get(key) === tracked) {
          this.chains.delete(key);
        }
      }
    );
    this.chains.set(key, tracked);
    return next;
  }

  /** Resolves when every queued task has finished (failures included). */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.chains.values()]);
  }
}
