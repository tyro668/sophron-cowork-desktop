import { AsyncLocalStorage } from 'node:async_hooks';

// Carries the causal chain through output commits, including asynchronous cloud
// actions, so A -> output -> B -> output cannot recursively invoke A.
export const automationRunScope = new AsyncLocalStorage<readonly string[]>();

// Commits produced during a run can activate a later matching output action
// without scheduling the same automation recursively.
export const automationTableChangeScope = new AsyncLocalStorage<
  import('../../shared/automation/types').AutomationTableTriggerContext
>();
