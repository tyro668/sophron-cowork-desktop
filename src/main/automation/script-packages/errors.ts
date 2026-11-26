import { scriptRunMessage } from '../script-run-messages';
import type { RepairDraftIssue } from '../../../shared/automation/script-package';

export class ScriptPackageError extends Error {
  constructor(
    message: string,
    readonly kind: 'invalid' | 'deps' | 'timeout' | 'script' | 'output',
    /** Tail of the process output, for the AI / test-run details. */
    readonly log?: string,
    /** Exit code of the entry for script failures. */
    readonly exitCode?: number
  ) {
    super(message);
  }
}

export class RepairDraftError extends ScriptPackageError {
  constructor(readonly reasonKey: RepairDraftIssue) {
    super(scriptRunMessage(reasonKey), 'invalid');
  }
}
