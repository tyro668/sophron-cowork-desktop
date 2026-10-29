import { Type } from 'typebox';
import type {
  AgentRuntimeCustomTool,
  AgentRuntimeExtension,
} from '../../extensions/agent-runtime-extension';
import { DEFAULT_SCRIPT_TIMEOUT_MS } from '../../../shared/automation/script-package';
import type { ScriptPackageService } from './service';
import { detectScriptPackageIntent, SessionPackActivation } from '../../extensions/agent-intent';

const PACK = 'automation.scripts';

/** Stable guide for the script_package_* tools: when to use them and the exact flow. */
export function buildScriptPackageGuide(rootDir: string): string {
  return [
    '<script_packages>',
    'A script package is a saved folder that the automation action "执行脚本" runs on a schedule with ZERO model calls: the script fetches data and its output is imported into a raw table.',
    '',
    'Recognise this intent (Chinese or English), including follow-ups that refer to a fetch done earlier in this conversation:',
    '- 固化成脚本 / 把这个取数过程固化下来 / 保存为脚本 / 做成脚本包 / 生成脚本 / 脚本化',
    '- 以后每天自动取 / 定时取数不要用 AI / 不消耗 token / 不调用大模型',
    '- "save this as a script", "turn this into a script", "make it a script package", "fetch it daily without AI / without spending tokens"',
    'Do NOT create a package for questions about scripts or code, one-off fetches, or processing tables that already exist (use data pipelines for that).',
    '',
    'Flow (do it, do not just describe it):',
    '1. Make sure the data source works: if this conversation has not fetched it yet, use webfetch (or the browser) on a public API/page first. Prefer a JSON/CSV API over HTML scraping; no login, no secrets, no headless browser.',
    '2. Write a multi-file package in a NEW folder inside the current working directory (for example ./<package_id>/, id = lowercase letters, digits, _ or -):',
    '   - manifest.json: {"name": "<short Chinese display name>", "description": "...", "entry": "main.py", "runtime": "python", "output": {"format": "csv", "columns": ["..."]}} (runtime "node" with main.js is also allowed)',
    '   - main.py: reads parameters from the JSON file in env SOPHRON_CONFIG, calls the helpers, writes the result (CSV with header) to the path in env SOPHRON_OUTPUT, exits non-zero with a one-line reason on stderr on failure',
    '   - at least one helper module (for example <pkg>/client.py for HTTP, <pkg>/transform.py for rows)',
    '   - requirements.txt with pinned versions (or package.json); config.json for the parameters (URL, symbols, date range, ...)',
    `3. Register it with script_package_save {sourceDir: <absolute folder>, id} (packages live in ${rootDir}).`,
    '4. Verify with script_package_test {id}: it installs deps in an isolated env, runs the entry and returns rows, preview and log. If it fails, fix the files in the source folder, save again and re-test until ok. Prefer script_package_test over running the script with bash.',
    '5. Reply briefly: package name and id, rows and columns from the test, and that runs will not use the model. Then OFFER to create an automation that runs it with the 执行脚本 action (automation_prepare with action {kind: "script", packageId}); ask for the time if none was given, and create only after the user agrees.',
    '</script_packages>',
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
        'Save a data fetch as a script package that the "执行脚本" automation action runs without any model call (固化成脚本 / 保存为脚本 / save as script). Pass the folder you wrote with manifest.json, the entry script, helper modules, requirements.txt or package.json and config.json; it is copied into the app script folder (.venv/node_modules are skipped). Re-saving the same id updates it. Always run script_package_test afterwards.',
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
  const activations = new SessionPackActivation();
  return {
    name: 'script-package-tools',
    async beforeSessionRun(context) {
      const tools = createScriptPackageTools(scripts);
      const names = tools.map((tool) => tool.name);
      const guide = buildScriptPackageGuide(scripts.rootDir);
      const intent = detectScriptPackageIntent(context, {
        stickyActive: activations.activePacks(context.session.id).size > 0,
      });
      if (intent.active) activations.activate(context.session.id, [PACK]);
      else activations.clear(context.session.id);
      return {
        customTools: tools,
        activateTools: intent.active ? names : [],
        toolPacks: {
          [PACK]: {
            description:
              'Save a data fetch (website/API) as a script package that automations run daily without AI (固化成脚本 / 保存为脚本 / 不消耗 token); list and test script packages',
            tools: names,
          },
        },
        toolContexts: [{ tools: names, stablePrompt: guide }],
        ...(intent.active ? { stablePrompt: guide } : {}),
      };
    },
    async onSessionDeleted({ sessionId }) {
      activations.clear(sessionId);
    },
  };
}
