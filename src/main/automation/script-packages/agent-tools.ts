import { Type } from 'typebox';
import type {
  AgentRuntimeCustomTool,
  AgentRuntimeExtension,
} from '../../extensions/agent-runtime-extension';
import { DEFAULT_SCRIPT_TIMEOUT_MS } from '../../../shared/automation/script-package';
import type { ScriptPackageService } from './service';

const PACK = 'automation.scripts';
const INTENT = /脚本|固化|定时|每天|每日|自动化|抓取|采集|爬|script|scrap|schedul|automat|cron/i;

export function buildScriptPackageGuide(rootDir: string): string {
  return [
    '## Script packages (执行脚本)',
    'A script package is a folder that an automation runs on a schedule with no AI call (action "执行脚本").',
    'Use one when the user wants a data fetch (website/API) "fixed" into a script that runs daily without spending tokens.',
    'Layout:',
    '- manifest.json: {"name": "<display name>", "description": "...", "entry": "main.py", "runtime": "python" | "node", "output": {"format": "csv" | "json", "columns": ["col", ...]}}',
    '- entry script + helper modules; deps in requirements.txt (python) or package.json (node); optional config.json (path in env SOPHRON_CONFIG).',
    '- The entry must write its result to the path in env SOPHRON_OUTPUT: CSV with a header row, or a JSON array of flat objects when output.format is "json". Exit non-zero on failure with a short reason on the last stderr line.',
    '- Do not print secrets. Keep runs short and deterministic; no interactive input.',
    `Write the package in the working directory, test it by running the entry with SOPHRON_OUTPUT set, then call script_package_save to register it (packages live in ${rootDir}).`,
    'After saving, run script_package_test. To schedule it, tell the user to add the "执行脚本" action to an automation (or create one).',
  ].join('\n');
}

export function createScriptPackageTools(scripts: ScriptPackageService): AgentRuntimeCustomTool[] {
  const text = (value: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    details: value,
  });
  return [
    {
      name: 'script_package_list',
      label: 'List script packages',
      description: 'List saved script packages that the "执行脚本" automation action can run.',
      parameters: Type.Object({}),
      execute: async () =>
        text(
          (await scripts.list()).map((item) => ({
            id: item.id,
            name: item.name,
            entry: item.entry,
            runtime: item.runtime,
            depsReady: item.depsReady,
            lastSuccess: item.lastSuccess,
            invalid: item.invalid,
          }))
        ),
    },
    {
      name: 'script_package_save',
      label: 'Save script package',
      description:
        'Register a folder containing manifest.json + entry script as a script package (copied into the app script folder; runtime dirs like .venv are skipped). Re-saving the same id updates it.',
      parameters: Type.Object({
        sourceDir: Type.String({
          minLength: 1,
          description: 'Absolute folder path with manifest.json',
        }),
        id: Type.Optional(
          Type.String({
            minLength: 1,
            description: 'Package id (folder name); defaults to the folder name',
          })
        ),
      }),
      execute: async (_toolCallId, params) => {
        const input = params as { sourceDir: string; id?: string };
        return text(await scripts.importFromDir(input.sourceDir, input.id));
      },
    },
    {
      name: 'script_package_test',
      label: 'Test script package',
      description:
        'Dry-run a saved script package: installs its deps if needed, runs the entry and validates the output. Nothing is imported. Returns the row count, the first output lines (preview) and the tail of stdout/stderr (log). Set pending=true to test the version being repaired (.sophron/pending).',
      parameters: Type.Object({
        id: Type.String({ minLength: 1 }),
        timeoutSeconds: Type.Optional(Type.Integer({ minimum: 5, maximum: 3600 })),
        pending: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, params) => {
        const input = params as { id: string; timeoutSeconds?: number; pending?: boolean };
        return text(
          await scripts.testRun(input.id, {
            timeoutMs: input.timeoutSeconds
              ? input.timeoutSeconds * 1000
              : DEFAULT_SCRIPT_TIMEOUT_MS,
            pending: input.pending === true,
          })
        );
      },
    },
  ] as AgentRuntimeCustomTool[];
}

export function createScriptPackageAgentRuntimeExtension(
  scripts: ScriptPackageService
): AgentRuntimeExtension {
  return {
    name: 'script-package-tools',
    async beforeSessionRun(context) {
      const tools = createScriptPackageTools(scripts);
      const names = tools.map((tool) => tool.name);
      const guide = buildScriptPackageGuide(scripts.rootDir);
      const active = INTENT.test(context.prompt);
      return {
        customTools: tools,
        activateTools: active ? names : [],
        toolPacks: {
          [PACK]: {
            description:
              'Create, list and test script packages for the "执行脚本" automation action',
            tools: names,
          },
        },
        toolContexts: [{ tools: names, stablePrompt: guide }],
        ...(active ? { stablePrompt: guide } : {}),
      };
    },
  };
}
