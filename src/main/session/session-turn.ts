import { randomUUID } from 'node:crypto';

export type SessionTurnOutcome =
  { status: 'succeeded' | 'cancelled' | 'timed_out' } | { status: 'failed'; error: string };

export interface SessionTurn {
  sessionId: string;
  turnId: string;
  completion: Promise<SessionTurnOutcome>;
}

export function createSessionTurn(sessionId: string, turnId: string = randomUUID()) {
  let finish!: (outcome: SessionTurnOutcome) => void;
  const completion = new Promise<SessionTurnOutcome>((resolve) => {
    finish = resolve;
  });
  const turn: SessionTurn = { sessionId, turnId, completion };
  return { turn, finish };
}
