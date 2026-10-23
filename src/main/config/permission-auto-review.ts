import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PERMISSION_RULES } from '../../shared/permission-policies';
import { reviewShellCommand } from './permission-command-review';

/** Routine local work is allowed; destructive, privileged and externally
 * consequential operations need a human decision. This permission policy
 * complements, rather than replaces, the execution sandbox. */
export type AutoReviewReason =
  | 'read_only_manifest'
  | 'read_only_normalizer_versions'
  | 'routine_read'
  | 'local_file_change'
  | 'local_command'
  | 'local_data_operation'
  | 'browser_interaction'
  | 'model_routine_operation'
  | 'model_high_risk'
  | 'review_unavailable'
  | 'sensitive_path'
  | 'destructive_operation'
  | 'privileged_operation'
  | 'external_side_effect'
  | 'arguments_need_confirmation'
  | 'tool_needs_confirmation';

export interface AutoReviewResult {
  decision: 'allow' | 'ask';
  reason: AutoReviewReason;
}

const READ_TOOLS = new Set(
  DEFAULT_PERMISSION_RULES.filter((rule) => rule.action === 'allow').map((rule) => rule.tool)
);
const FILE_TOOLS = new Set([
  'write',
  'edit',
  'write_file',
  'edit_file',
  'create_file',
  'apply_patch',
]);
const COMMAND_TOOLS = new Set(['bash', 'shell', 'execute_command', 'run_command', 'exec_command']);
const LOCAL_DATA_TOOLS = new Set([
  'data_import_cloud_table',
  'data_create_raw_table',
  'data_create_raw_table_with_processing_strategy',
  'data_update_raw_table',
  'data_refresh_raw_source',
  'data_summarize_raw_table_source',
  'data_generate_raw_table_normalizer_draft',
  'data_preview_raw_table_normalizer_version',
  'data_publish_raw_table_normalizer_version', // A local version, not a remote publication.
  'data_create_result_table',
  'data_update_result_table',
  'data_generate_pipeline_from_requirement',
  'data_create_pipeline',
  'data_update_pipeline',
  'data_apply_workflow_plan',
  'data_apply_workflow_dsl',
  'data_configure_input_operator',
  'data_configure_output_operator',
  'data_apply_operator_dsl',
  'data_run_pipeline',
]);
const BROWSER_TOOLS = new Set([
  'navigate_page',
  'new_page',
  'close_page',
  'select_page',
  'list_pages',
  'take_screenshot',
  'take_snapshot',
  'screenshot',
  'screenshot_for_display',
  'get_displays',
  'get_mouse_position',
  'move_mouse',
  'hover',
  'scroll',
  'wait',
  'wait_for',
  'gui_locate_element',
  'gui_verify_vision',
  'gui_extract_info',
  'get_all_visited_apps',
  'get_network_request',
  'list_network_requests',
  'list_console_messages',
]);
const HIGH_IMPACT_ACTION =
  /(?:^|[_\s.-])(delete|remove|drop|truncate|purge|wipe|destroy|format|reset|send|publish|upload|deploy|pay|purchase|transfer|grant|revoke)(?:$|[_\s.-])/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Resolve path traversal and existing symlink ancestors before classifying. */
export function isSensitivePermissionPath(
  value: string,
  cwd = process.cwd(),
  includeSystemPaths = true
): boolean {
  const sensitive = (candidate: string): boolean => {
    const normalized = path.posix.normalize(candidate.replace(/\\/g, '/')).toLowerCase();
    return (
      (includeSystemPaths &&
        /^(?:[a-z]:)?\/(?:etc|private\/etc|usr|bin|sbin|dev|proc|sys|boot|root|(?:private\/)?var\/(?:db|lib|run)|system|library|windows|program files(?: \(x86\))?)(?:\/|$)/.test(
          normalized
        )) ||
      /^\/(?:private\/)?etc\/(?:shadow|sudoers|ssl\/private)(?:\/|$)/.test(normalized) ||
      /(?:^|\/)(?:\.ssh|\.aws|\.azure|\.kube|\.gnupg|\.config\/gcloud|\.git\/(?:hooks|config)|keychains)(?:\/|$)/.test(
        normalized
      ) ||
      /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.pypirc|\.netrc|credentials(?:\.json)?|id_rsa|id_ed25519|authorized_keys|known_hosts|\.bashrc|\.zshrc|\.profile)$/.test(
        normalized
      )
    );
  };
  if (sensitive(value)) return true;
  let current = path.resolve(cwd, value.replace(/^~(?=[/\\]|$)/, os.homedir()));
  const suffix: string[] = [];
  for (;;) {
    try {
      return sensitive(path.join(fs.realpathSync(current), ...suffix));
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return false;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

function hasSensitivePath(input: Record<string, unknown>, cwd?: string, readOnly = false): boolean {
  // Inspect path fields, not document contents or replacement text.
  for (const [key, value] of Object.entries(input)) {
    if (/^(?:path|paths|file_?path|file_?paths|target|destination|cwd|directory)$/i.test(key)) {
      const paths = Array.isArray(value) ? value : [value];
      if (
        paths.some(
          (item) =>
            typeof item === 'string' &&
            isSensitivePermissionPath(item, cwd, !readOnly && key !== 'cwd')
        )
      )
        return true;
    }
  }
  return false;
}

export function reviewAutoPermission(
  toolName: string,
  input: unknown,
  cwd?: string
): AutoReviewResult {
  const ask = (reason: AutoReviewReason): AutoReviewResult => ({ decision: 'ask', reason });
  const allow = (reason: AutoReviewReason): AutoReviewResult => ({ decision: 'allow', reason });
  if (!isRecord(input)) return ask('arguments_need_confirmation');
  const readOnly =
    READ_TOOLS.has(toolName) ||
    /^(?:get|list|read|search|find|inspect|preview|describe|fetch)_/.test(toolName);
  if (hasSensitivePath(input, cwd, readOnly)) return ask('sensitive_path');
  if (COMMAND_TOOLS.has(toolName)) {
    const command = input.command ?? input.cmd ?? input.script ?? input.shell_command;
    return typeof command === 'string' && command.trim()
      ? reviewShellCommand(command, (value, readOnly) =>
          isSensitivePermissionPath(value, cwd, !readOnly)
        )
      : ask('arguments_need_confirmation');
  }
  if (FILE_TOOLS.has(toolName)) {
    if (toolName === 'apply_patch') {
      const patch = input.patch ?? input.input;
      if (typeof patch !== 'string') return ask('arguments_need_confirmation');
      if (/^\*\*\* Delete File:/m.test(patch)) return ask('destructive_operation');
      const paths = [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Move to):\s*(.+)$/gm)];
      if (!paths.length) return ask('arguments_need_confirmation');
      return paths.some((match) => isSensitivePermissionPath(match[1], cwd))
        ? ask('sensitive_path')
        : allow('local_file_change');
    }
    const target = input.path ?? input.file_path ?? input.filePath;
    return typeof target === 'string' && target.trim()
      ? allow('local_file_change')
      : ask('arguments_need_confirmation');
  }
  for (const key of ['action', 'operation', 'method']) {
    const action = input[key];
    if (
      typeof action === 'string' &&
      (HIGH_IMPACT_ACTION.test(action) || /^(?:post|put|patch)$/i.test(action))
    ) {
      return ask('external_side_effect');
    }
  }
  if (toolName === 'data_get_workflow_capability_manifest') {
    const ids = [input.rawTableIds, input.resultTableIds];
    return Object.keys(input).every((key) => ['rawTableIds', 'resultTableIds'].includes(key)) &&
      ids.every(
        (value) =>
          value === undefined ||
          (Array.isArray(value) &&
            value.length <= 8 &&
            value.every((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)))
      )
      ? allow('read_only_manifest')
      : ask('arguments_need_confirmation');
  }
  if (toolName === 'data_list_raw_table_normalizer_versions') {
    return Object.keys(input).every((key) => key === 'artifactId') &&
      typeof input.artifactId === 'string' &&
      /^[A-Za-z0-9_-]{1,128}$/.test(input.artifactId)
      ? allow('read_only_normalizer_versions')
      : ask('arguments_need_confirmation');
  }
  if (LOCAL_DATA_TOOLS.has(toolName)) return allow('local_data_operation');
  if (
    HIGH_IMPACT_ACTION.test(toolName) ||
    /^automation_(?:create|update|set_enabled)/.test(toolName)
  ) {
    return ask('external_side_effect');
  }
  if (READ_TOOLS.has(toolName)) return allow('routine_read');
  if (BROWSER_TOOLS.has(toolName.replace(/^chrome_/, ''))) return allow('browser_interaction');
  if (
    /^(?:get|list|read|search|find|inspect|preview|describe|fetch)_/.test(toolName) &&
    !Object.keys(input).some((key) => /^(?:command|cmd|script|code|sql)$/i.test(key))
  ) {
    return allow('routine_read');
  }
  // Opaque execution tools cannot be classified as routine from their name.
  return ask('tool_needs_confirmation');
}
