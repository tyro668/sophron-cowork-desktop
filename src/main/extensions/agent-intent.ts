/**
 * Deterministic per-turn intent routing for domain tool packs.
 *
 * No routing LLM: a domain activates when the current prompt matches domain
 * keywords, when the user attached domain resources, when earlier turns already
 * used that domain's tools AND the user explicitly continues that work.
 * Catalog registration survives topic changes; model exposure does not.
 */
import type { Message } from '../../shared/contracts';

const DATA_PROMPT_PATTERN =
  /数据|数据集|数据表|输入表|输出表|原始表|结果表|数据加工|字段|列名|清洗|筛选|过滤|聚合|透视|去重|缺失值|工作流|数据处理|导入|合并表|连接表|table\b|tables\b|rawTable|workflow|data ?(task|pipeline)|excel|csv|etl\b|pivot|aggregate|dedup|join\b/i;
const DATA_FILE_PATTERN = /文件|文件夹|excel|csv|导入|上传|file\b|folder\b|import\b|upload/i;
const DATA_CLOUD_PATTERN = /云|云空间|云端|cloud|space\b|project\b/i;
const DATA_AUTHORING_PATTERN =
  /工作流|流程|节点|算子|dsl\b|plan\b|多表|多源|join\b|编排|修改流程|编辑流程|workflow/i;
const DATA_GENERATION_PATTERN =
  /创建.{0,8}任务|新建.{0,8}任务|生成.{0,8}任务|需求|create.{0,20}task|new.{0,10}task|generate.{0,20}task|requirement/i;
const DATA_RUN_PATTERN = /运行|执行|重跑|再跑|run\b|execute\b/i;
const DATA_NORMALIZER_PATTERN = /标准化|归一化|清洗规则|normaliz|规则引擎/i;
const AUTOMATION_PROMPT_PATTERN =
  /自动化|定时|调度|周期|每天|每日|每周|每小时|每月|明天|稍后|提醒|cron|schedule[ds]?\b|automat|\bevery (?:day|morning|evening|night|hour|week|month|weekday)\b|\b(?:daily|hourly|weekly|monthly)\b|reschedule|改期|暂停|启用|停用/i;
const AUTOMATION_UPDATE_PATTERN =
  /改期|修改.*(时间|频率|调度)|调整.*(时间|频率)|reschedule|change.*schedule|update.*schedule|暂停|停用|启用|disable|enable|pause|resume/i;
const AUTOMATION_CREATE_PATTERN =
  /创建|新建|添加|安排|设置|create|new\b|add\b|set up|schedule\b|automate/i;

/**
 * "Turn this fetch into a script that runs without the model": explicit script-package
 * wording, token-free wording, or a recurring fetch from a website/API. A bare mention
 * of 脚本 (e.g. a question about a shell script) is deliberately not enough.
 */
const SCRIPT_PACKAGE_PATTERN =
  /脚本包|执行脚本|固化|脚本化|(?:保存|存|做|生成|整理|转|变|打包)(?:成|为|一个|个|一下)?.{0,8}脚本|(?:不|别|无需|不需要)(?:要|用|再|会)?(?:消耗|花费?|调用|使用|用|走|经过).{0,6}(?:ai|token|llm|大模型|模型)|零\s*token|省\s*token|script[ -]?package|\b(?:save|turn|convert|make|package|freeze|wrap)\b.{0,24}\bscripts?\b|\bscripted\b|without (?:an? |the |using |spending |calling )?(?:ai|llm|model|tokens?)\b|\bno (?:ai|llm|tokens?)\b|zero[- ]token/i;
const SCRIPT_RECURRING_FETCH_PATTERN =
  /(?:每天|每日|每周|每小时|每月|定时|定期|以后|今后|自动)(?:都|自动)?.{0,10}(?:取数|抓取|采集|拉取|获取|爬取|同步|抓|取)|(?:每天|每日|每周|每小时|每月|定时|定期)[^，。,.!?！？]{0,10}自动(?:跑|运行|执行)|(?:fetch|pull|scrape|download|collect)\b.{0,40}\b(?:daily|every (?:day|hour|week|morning)|hourly|weekly|on a schedule)|(?:daily|every (?:day|hour|week|morning)|hourly|weekly)\b.{0,40}\b(?:fetch|pull|scrape|download|collect)/i;

const TOOL_USE_SCAN_LIMIT = 30;

export interface DataIntentSignals {
  active: boolean;
  file: boolean;
  cloud: boolean;
  authoring: boolean;
  generate: boolean;
  run: boolean;
  continuation: boolean;
  normalizer: boolean;
}

export interface AutomationIntentSignals {
  active: boolean;
  create: boolean;
  update: boolean;
  continuation: boolean;
}

/** Bare follow-ups inherit only the immediately preceding operation. */
export function isOperationContinuation(prompt: string): boolean {
  return /^(继续(?:处理|执行)?|然后呢|再来一次|再试一次|重试|确认(?:执行|创建|修改)?|好的?|可以|就用这个|按这个来|continue|retry|try again|confirm|yes|go ahead)[。.!！?？\s]*$/i.test(
    prompt.trim()
  );
}

function sessionUsedToolsWithPrefix(
  existingMessages: Message[],
  prefixes: readonly string[]
): boolean {
  const lastAssistant = existingMessages
    .slice(-TOOL_USE_SCAN_LIMIT)
    .reverse()
    .find((m) => m.role === 'assistant');
  return (
    lastAssistant?.content.some(
      (block) =>
        block.type === 'tool_use' && prefixes.some((prefix) => block.name.startsWith(prefix))
    ) ?? false
  );
}

function hasCloudTableAttachment(existingMessages: Message[]): boolean {
  const lastUser = [...existingMessages].reverse().find((m) => m.role === 'user');
  return lastUser?.content.some((block) => block.type === 'cloud_table_attachment') ?? false;
}

export function detectDataIntent(
  context: { prompt: string; existingMessages: Message[] },
  options: { stickyActive: boolean; hasPendingReceipts: boolean; hasSelectedPipeline?: boolean }
): DataIntentSignals {
  const text = context.prompt;
  const continuation = isOperationContinuation(text);
  const promptHit = DATA_PROMPT_PATTERN.test(text);
  const cloudAttachment = hasCloudTableAttachment(context.existingMessages);
  const historyHit = sessionUsedToolsWithPrefix(context.existingMessages, ['data_']);
  const run = DATA_RUN_PATTERN.test(text);
  const active =
    promptHit ||
    cloudAttachment ||
    (run &&
      (/taskId\s*[=:]|任务|task\b/i.test(text) ||
        (options.hasSelectedPipeline &&
          /当前|这个|该任务|它|再(?:次|运行|执行)|重跑|再跑|current|this|again/i.test(text)))) ||
    (continuation && (historyHit || options.stickyActive || options.hasPendingReceipts));
  return {
    active,
    file: DATA_FILE_PATTERN.test(text),
    cloud: DATA_CLOUD_PATTERN.test(text) || cloudAttachment,
    authoring: DATA_AUTHORING_PATTERN.test(text),
    generate: DATA_GENERATION_PATTERN.test(text),
    run,
    continuation,
    normalizer: DATA_NORMALIZER_PATTERN.test(text),
  };
}

export function detectAutomationIntent(
  context: { prompt: string; existingMessages: Message[] },
  options: { stickyActive: boolean; hasPendingReceipts: boolean; hasSelectedPipeline?: boolean }
): AutomationIntentSignals {
  const text = context.prompt;
  const continuation = isOperationContinuation(text);
  const promptHit = AUTOMATION_PROMPT_PATTERN.test(text);
  // Right after a script package was saved the assistant offers to schedule it, so a bare
  // "yes" / "好的" continues into automation creation.
  const historyHit = sessionUsedToolsWithPrefix(context.existingMessages, [
    'automation_',
    'script_package_',
  ]);
  const active =
    promptHit ||
    (continuation && (historyHit || options.stickyActive || options.hasPendingReceipts));
  const update = AUTOMATION_UPDATE_PATTERN.test(text);
  // Scheduling phrasing ("每天早上9点自动运行") implies create even without an
  // explicit create verb. List-only intents expose the core read/control tools.
  const create =
    AUTOMATION_CREATE_PATTERN.test(text) ||
    (promptHit && !update && !/列出|列表|有哪些|查看|list\b|show\b/i.test(text));
  return { active, create, update, continuation };
}

/** Last operation context; each explicit intent replaces, rather than expands, it. */
export interface ScriptPackageIntentSignals {
  active: boolean;
  /** Explicit script-package wording, as opposed to a recurring-fetch hint. */
  explicit: boolean;
}

export function detectScriptPackageIntent(
  context: { prompt: string; existingMessages: Message[] },
  options: { stickyActive: boolean }
): ScriptPackageIntentSignals {
  const text = context.prompt;
  const explicit = SCRIPT_PACKAGE_PATTERN.test(text);
  const fetchHit = SCRIPT_RECURRING_FETCH_PATTERN.test(text);
  const continuation = isOperationContinuation(text);
  const historyHit = sessionUsedToolsWithPrefix(context.existingMessages, ['script_package_']);
  return {
    active: explicit || fetchHit || (continuation && (historyHit || options.stickyActive)),
    explicit,
  };
}

export class SessionPackActivation {
  private readonly packs = new Map<string, Set<string>>();

  activate(sessionId: string, packNames: Iterable<string>): Set<string> {
    const existing = new Set(packNames);
    this.packs.set(sessionId, existing);
    return existing;
  }

  activePacks(sessionId: string): ReadonlySet<string> {
    return this.packs.get(sessionId) ?? new Set();
  }

  clear(sessionId: string): void {
    this.packs.delete(sessionId);
  }
}
