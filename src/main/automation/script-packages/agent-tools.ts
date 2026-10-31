import { Type } from 'typebox';
import type {
  AgentRuntimeCustomTool,
  AgentRuntimeExtension,
} from '../../extensions/agent-runtime-extension';
import type { ScriptPackageService } from './service';
import { detectScriptPackageIntent, SessionPackActivation } from '../../extensions/agent-intent';

const PACK = 'automation.scripts';

/** Stable guide for the script_package_* tools: when to use them and the exact flow. */
export function buildScriptPackageGuide(_rootDir?: string): string {
  return [
    '<script_packages>',
    'A script package is a saved folder that the automation action "执行脚本" runs on a schedule with ZERO model calls: the script fetches data and its output is imported into a raw table.',
    'Packages are generated ONLY by the script generation agent in 脚本管理 (the user clicks 「转成脚本」, confirms the key points, and the editor generates, self-tests and saves a draft). You never write, save, test or publish script packages yourself in this conversation.',
    '',
    'Recognise this intent (Chinese or English), including follow-ups that refer to a fetch done earlier in this conversation:',
    '- 固化成脚本 / 把这个取数过程固化下来 / 保存为脚本 / 做成脚本包 / 生成脚本 / 脚本化 / 转成脚本',
    '- 以后每天自动取 / 每天自动跑 / 定时取数不要用 AI / 不消耗 token / 不调用大模型',
    '- "save this as a script", "turn this into a script", "make it a script package", "fetch it daily without AI / without spending tokens"',
    'Do NOT propose a package for questions about scripts or code, one-off fetches, or processing tables that already exist (use data pipelines for that).',
    '',
    'Flow (do it, do not just describe it):',
    '1. The package is generated from a turn of this conversation that fetched the data from the network successfully (webfetch, or bash with curl / requests) AND showed a structured result (a Markdown table, a csv/json/xlsx file or a data table). If no turn did that yet, fetch the data now: find the real JSON/XHR API the page calls (front-end rendered pages load data from an API; send a browser User-Agent and the site Referer) and show the result as a table.',
    '2. Call script_package_propose once (pass scheduleTime "HH:MM" when the user mentioned a time). It places a 「转成脚本」 card under your reply that opens the confirm dialog.',
    '3. Reply in 1-2 sentences: 定时自动跑用脚本包，不调用模型、不消耗 token；点「转成脚本」在脚本管理里生成并自测，发布后可直接创建自动化。 Interfaces that need a login, cookie or key are not supported yet — say so instead of proposing.',
    'Never end an ordinary answer by asking whether to save it as a script package; finished fetch turns already show a 「转成脚本」 entry.',
    'Automations: an automation can run a package only after it is published. script_package_list shows packages with publishedVersion; for "用脚本包 X 每天 9 点跑" prepare action {kind: "script", packageId} with automation_prepare. If the package does not exist yet, propose it first (the editor offers 「创建自动化」 after publishing).',
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
      description:
        'List saved script packages that the "执行脚本" automation action can run (publishedVersion is null until the user publishes one).',
      parameters: Type.Object({}),
      execute: async () =>
        text(
          (await scripts.list()).map((item) => ({
            id: item.id,
            name: item.name,
            entry: item.entry,
            runtime: item.runtime,
            publishedVersion: item.published?.version ?? null,
            draftVersion: item.draft?.version ?? null,
            lastSuccess: item.lastSuccess,
            invalid: item.invalid,
          }))
        ),
    },
    {
      name: 'script_package_propose',
      label: 'Propose script package',
      description:
        'Place a 「转成脚本」 card under your reply (固化成脚本 / 每天自动跑 / 不消耗 token). The card opens the confirm dialog for the latest turn of this conversation that fetched data from the network and showed a table or file; the script generation agent in 脚本管理 then writes and self-tests the package. Call it once, after such a turn exists. It writes nothing itself.',
      parameters: Type.Object({
        scheduleTime: Type.Optional(
          Type.String({
            pattern: '^\\d{2}:\\d{2}$',
            description: 'Daily run time the user asked for, "HH:MM"',
          })
        ),
      }),
      execute: async (_toolCallId, params) => {
        const input = params as { scheduleTime?: string };
        return text({
          proposed: true,
          ...(input.scheduleTime ? { scheduleTime: input.scheduleTime } : {}),
          message:
            '已在回复下放置「转成脚本」卡片：用户确认要点后在脚本管理中生成并自测，发布后可创建自动化。不要自己写脚本文件。',
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
      const guide = buildScriptPackageGuide();
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
              'Turn a data fetch (website/API) of this conversation into a script package that automations run daily without AI (固化成脚本 / 转成脚本 / 每天自动跑 / 不消耗 token): propose the 转成脚本 card; list script packages',
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
