import type { ScriptVersionSource } from '../../../shared/automation/script-package';

/** i18n keys for a version's 来源. */
export const SCRIPT_SOURCE_KEYS: Record<ScriptVersionSource, string> = {
  chat: 'scripts.source.chat',
  rule: 'scripts.source.rule',
  ai_repair: 'scripts.source.ai_repair',
  manual: 'scripts.source.manual',
};
