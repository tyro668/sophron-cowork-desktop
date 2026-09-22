import { AsyncLocalStorage } from 'node:async_hooks';

// Carries the causal chain through output commits, including asynchronous cloud
// actions, so A -> output -> B -> output cannot recursively invoke A.
export const automationRunScope = new AsyncLocalStorage<readonly string[]>();
