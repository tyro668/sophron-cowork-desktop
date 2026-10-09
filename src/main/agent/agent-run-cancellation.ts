import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { logWarn } from '../utils/logger';

/** The app and SDK own different controllers. Forward cancellation to the SDK
 * so its active model, tools, retries and compaction stop together. */
export function bindAgentRunCancellation(
  session: Pick<AgentSession, 'abort'>,
  signal: AbortSignal
): () => void {
  const abort = () => {
    void session.abort().catch((error: unknown) => {
      logWarn('[AgentRunner] SDK cancellation failed:', error);
    });
  };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  return () => signal.removeEventListener('abort', abort);
}
