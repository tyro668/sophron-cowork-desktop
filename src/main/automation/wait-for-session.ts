import type { SessionTurn } from '../session/session-turn';
import { harnessMessage } from '../utils/harness-messages';

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export async function waitForSessionTurn(turn: SessionTurn, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    const checkDeadline = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) reject(new Error(harnessMessage('waitTimeout', { timeoutMs })));
      else timer = setTimeout(checkDeadline, Math.min(remaining, MAX_TIMER_DELAY_MS));
    };
    checkDeadline();
  });
  try {
    const outcome = await Promise.race([turn.completion, timeout]);
    switch (outcome.status) {
      case 'succeeded':
        return;
      case 'failed':
        throw new Error(outcome.error);
      case 'cancelled':
        throw new Error(harnessMessage('cancelled'));
      case 'timed_out':
        throw new Error(harnessMessage('turnTimeout'));
    }
  } finally {
    clearTimeout(timer);
  }
}
