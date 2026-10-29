import type { SessionManager } from '../session/session-manager';

export async function waitForSession(
  sessionManager: SessionManager,
  sessionId: string,
  timeoutMs: number,
  now: () => number
): Promise<void> {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const session = sessionManager.listSessions().find((row) => row.id === sessionId);
    if (!session || session.status === 'completed' || session.status === 'idle') return;
    if (session.status === 'error') {
      throw new Error(`Conversation failed: ${session.title}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Conversation timed out after ${timeoutMs}ms`);
}
