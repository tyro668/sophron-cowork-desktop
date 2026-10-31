/**
 * Automation-triggered AI 修复 jobs that outlive their run. One job per package; stopping an
 * automation (pause / disable / delete) or quitting the app aborts its jobs.
 */
export class BackgroundRepairs {
  private readonly jobs = new Map<
    string,
    { automationId: string; controller: AbortController; done: Promise<void> }
  >();

  isRunning(packageId: string): boolean {
    return this.jobs.has(packageId);
  }

  /** Start `task` for the package; false when one is already running. */
  start(
    packageId: string,
    automationId: string,
    task: (signal: AbortSignal) => Promise<void>
  ): boolean {
    if (this.jobs.has(packageId)) return false;
    const controller = new AbortController();
    const done = Promise.resolve()
      .then(() => task(controller.signal))
      .catch(() => undefined)
      .finally(() => {
        if (this.jobs.get(packageId)?.controller === controller) this.jobs.delete(packageId);
      });
    this.jobs.set(packageId, { automationId, controller, done });
    return true;
  }

  /** Abort the jobs started by one automation, or all of them. */
  stop(automationId?: string): void {
    for (const job of this.jobs.values()) {
      if (automationId === undefined || job.automationId === automationId) job.controller.abort();
    }
  }

  /** Resolves once every current job has settled (tests, shutdown). */
  async idle(): Promise<void> {
    await Promise.all([...this.jobs.values()].map((job) => job.done));
  }
}

export const backgroundRepairs = new BackgroundRepairs();
