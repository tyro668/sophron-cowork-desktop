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
    '1. Make sure the data source works: if this conversation has not fetched it yet, use webfetch (or the browser) on a public API/page first. Prefer a JSON/CSV API over HTML scraping; for front-end rendered pages find the XHR/JSON API the page calls (JS bundles, apiBaseUrl). Requests send a browser User-Agent and the site Referer. No login, no secrets, no headless browser.',
    '2. Write a multi-file package in a NEW folder inside the current working directory (for example ./<package_id>/, id = lowercase letters, digits, _ or -). Python is the default; use Node.js when the user asks for it or an npm library fits clearly better.',
    '   Python: manifest.json {"name": "<short Chinese display name>", "description": "...", "entry": "main.py", "runtime": "python", "output": {"format": "csv", "columns": ["..."]}}; main.py plus helper modules (e.g. client.py, transform.py); requirements.txt with pinned versions (may be empty).',
    '   Node.js: manifest.json {..., "entry": "main.js", "runtime": "node", ...}; main.js (CommonJS require, or ESM with "type": "module") plus helper modules under lib/; package.json with exact "dependencies" versions (no devDependencies needed). Node 20+ globals such as fetch are available.',
    '   Both: the entry reads parameters from the JSON file in env SOPHRON_CONFIG (config.json: URL, symbols, date range, ...), writes the result (CSV with header, or a JSON array of objects when output.format is "json") to the path in env SOPHRON_OUTPUT, and exits non-zero with a one-line reason on stderr on failure. 0 rows counts as a failure: when the requested slice can be empty (e.g. today), config.json states "on_empty": {"action": "fallback" | "error", ...} and the script falls back or exits non-zero.',
    `3. Save it with script_package_save {sourceDir: <absolute folder>, id} (packages live in ${rootDir}; each package is a git repo and every save is a version). Saving creates or updates a DRAFT version — automations keep running the published version until it is published.`,
    '4. Verify with script_package_test {id}: it installs deps in an isolated env (venv / npm), runs the draft and returns rows, preview and log. If it fails, fix the files in the source folder, save again (this overwrites the same draft) and re-test until ok. Prefer script_package_test over running the script with bash.',
    '5. Reply briefly: package name, the draft version (e.g. "已保存为 v2 草稿"), rows and columns from the test, and which version automations still run (the save result has publishedVersion; if none: "发布后才能被自动化运行"). The user publishes with the 发布 button on the package card below your reply; call script_package_publish only when the user explicitly asks you to publish. Then OFFER to create an automation that runs it with the 执行脚本 action (automation_prepare with action {kind: "script", packageId}); ask for the time if none was given, and create only after the user agrees.',
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
            publishedVersion: item.published?.version ?? null,
            draftVersion: item.draft?.version ?? null,
            lastSuccess: item.lastSuccess,
            invalid: item.invalid,
          }))
        ),
    },
    {
      name: 'script_package_save',
      label: 'Save script package',
      description:
        'Save a data fetch as a script package that the "执行脚本" automation action runs without any model call (固化成脚本 / 保存为脚本 / save as script). Pass the folder you wrote with manifest.json, the entry script, helper modules, requirements.txt or package.json and config.json; it is copied into the app script folder (.venv/node_modules are skipped) and committed as a DRAFT version. Re-saving the same id overwrites that draft; automations keep running the published version until the user publishes. Always run script_package_test afterwards.',
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
        const saved = await scripts.importFromDir(input.sourceDir, input.id);
        const published = saved.summary.published?.version;
        const draft = saved.version.version;
        return text({
          id: saved.summary.id,
          name: saved.summary.name,
          entry: saved.summary.entry,
          runtime: saved.version.runtime,
          version: draft,
          status: saved.version.status,
          publishedVersion: published ?? null,
          message:
            saved.version.status === 'draft'
              ? published
                ? `已保存为 v${draft} 草稿，自动化仍运行已发布的 v${published}，发布后下次运行起改用 v${draft}。`
                : `已保存为 v${draft} 草稿；还没有发布版本，发布后才能被自动化运行。`
              : `内容与 v${draft} 相同，未生成新版本。`,
        });
      },
    },
    {
      name: 'script_package_test',
      label: 'Test script package',
      description:
        'Dry-run a saved script package: installs its deps if needed, runs the entry and validates the output. Nothing is imported. By default it runs the package folder as it is now (the draft just saved, or the files an AI repair is editing); pass version to run a specific version. Returns the row count, the first output lines (preview) and the tail of stdout/stderr (log).',
      parameters: Type.Object({
        id: Type.String({ minLength: 1 }),
        timeoutSeconds: Type.Optional(Type.Integer({ minimum: 5, maximum: 3600 })),
        version: Type.Optional(Type.Integer({ minimum: 1 })),
      }),
      execute: async (_toolCallId, params) => {
        const input = params as { id: string; timeoutSeconds?: number; version?: number };
        const result = await scripts.testRun(input.id, {
          timeoutMs: input.timeoutSeconds ? input.timeoutSeconds * 1000 : DEFAULT_SCRIPT_TIMEOUT_MS,
          target: input.version ?? 'working',
        });
        const { previewRows: _rows, ...rest } = result;
        return text(rest);
      },
    },
    {
      name: 'script_package_publish',
      label: 'Publish script package',
      description:
        'Publish a script package version so automations run it (the previously published version is archived; publishing an older version rolls back). Only call this when the user explicitly asks to publish or roll back; otherwise the user publishes from the package card.',
      parameters: Type.Object({
        id: Type.String({ minLength: 1 }),
        version: Type.Integer({ minimum: 1 }),
      }),
      execute: async (_toolCallId, params) => {
        const input = params as { id: string; version: number };
        const summary = await scripts.publish(input.id, input.version);
        return text({
          id: summary.id,
          name: summary.name,
          publishedVersion: summary.published?.version ?? null,
        });
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
