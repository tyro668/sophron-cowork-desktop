export class DataCommandLockCoordinator {
  private readonly keyedLocks = new Map<string, Promise<void>>();

  async withKeyedLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.keyedLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.keyedLocks.set(key, current);
    await previous.catch(() => undefined);
    try {
      return await work();
    } finally {
      release();
      if (this.keyedLocks.get(key) === current) {
        this.keyedLocks.delete(key);
      }
    }
  }
}
