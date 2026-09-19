/**
 * Deterministic per-turn intent routing for domain tool packs.
 *
 * No routing LLM: a domain activates when the current prompt matches domain
 * keywords, when the user attached domain resources, when earlier turns already
 * used that domain's tools, or when the domain holds a pending receipt
 * (unconfirmed analysis / uncommitted draft). Once activated, packs stay
 * registered for the session so multi-turn flows do not lose tools mid-task.
 */
import type { Message } from '../../shared/contracts';

const DATA_PROMPT_PATTERN =
  /数据|数据集|数据表|输入表|输出表|字段|列名|清洗|筛选|过滤|聚合|透视|去重|缺失值|工作流|数据处理|导入|合并表|连接表|table\b|tables\b|dataset|workflow|data ?task|excel|csv|etl\b|pivot|aggregate|dedup|join\b/i;
const DATA_FILE_PATTERN = /文件|文件夹|excel|csv|导入|上传|file\b|folder\b|import\b|upload/i;
const DATA_CLOUD_PATTERN = /云|个人分析|云端|cloud|space\b|project\b/i;
const DATA_AUTHORING_PATTERN =
  /工作流|流程|节点|算子|dsl\b|plan\b|多表|多源|join\b|编排|修改流程|编辑流程|workflow|创建.{0,8}任务|新建.{0,8}任务|生成.{0,8}任务|需求|create.{0,20}task|new.{0,10}task|generate.{0,20}task|requirement/i;
const DATA_NORMALIZER_PATTERN = /标准化|归一化|清洗规则|normaliz|规则引擎/i;
const AUTOMATION_PROMPT_PATTERN =
  /自动化|定时|调度|周期|每天|每日|每周|每小时|每月|明天|稍后|提醒|cron|schedule[ds]?\b|automat|reschedule|改期|暂停|启用|停用/i;
const AUTOMATION_UPDATE_PATTERN =
  /改期|修改.*(时间|频率|调度)|调整.*(时间|频率)|reschedule|change.*schedule|update.*schedule|暂停|停用|启用|disable|enable|pause|resume/i;
const AUTOMATION_CREATE_PATTERN =
  /创建|新建|添加|安排|设置|create|new\b|add\b|set up|schedule\b|automate/i;

const TOOL_USE_SCAN_LIMIT = 30;

export interface DataIntentSignals {
  active: boolean;
  file: boolean;
  cloud: boolean;
  authoring: boolean;
  normalizer: boolean;
}

export interface AutomationIntentSignals {
  active: boolean;
  create: boolean;
  update: boolean;
}

function lastUserText(context: { prompt: string; existingMessages: Message[] }): string {
  const attachmentText = context.existingMessages
    .slice(-3)
    .flatMap((message) => message.content)
    .filter((block) => block.type === 'cloud_table_attachment')
    .map(() => 'cloud table attachment')
    .join(' ');
  return `${context.prompt}\n${attachmentText}`;
}

function sessionUsedToolsWithPrefix(
  existingMessages: Message[],
  prefixes: readonly string[]
): boolean {
  for (const message of existingMessages.slice(-TOOL_USE_SCAN_LIMIT)) {
    for (const block of message.content) {
      if (block.type === 'tool_use' && prefixes.some((prefix) => block.name.startsWith(prefix))) {
        return true;
      }
    }
  }
  return false;
}

function hasCloudTableAttachment(existingMessages: Message[]): boolean {
  const lastUser = [...existingMessages].reverse().find((m) => m.role === 'user');
  return lastUser?.content.some((block) => block.type === 'cloud_table_attachment') ?? false;
}

export function detectDataIntent(
  context: { prompt: string; existingMessages: Message[] },
  options: { stickyActive: boolean; hasPendingReceipts: boolean }
): DataIntentSignals {
  const text = lastUserText(context);
  const promptHit = DATA_PROMPT_PATTERN.test(text);
  const cloudAttachment = hasCloudTableAttachment(context.existingMessages);
  const historyHit = sessionUsedToolsWithPrefix(context.existingMessages, ['data_']);
  // Sticky/pending state keeps the domain active but does not expand packs —
  // previously activated packs come from SessionPackActivation, not keywords.
  const active =
    promptHit ||
    cloudAttachment ||
    historyHit ||
    options.stickyActive ||
    options.hasPendingReceipts;
  return {
    active,
    file: DATA_FILE_PATTERN.test(text),
    cloud: DATA_CLOUD_PATTERN.test(text) || cloudAttachment,
    authoring: DATA_AUTHORING_PATTERN.test(text),
    normalizer: DATA_NORMALIZER_PATTERN.test(text),
  };
}

export function detectAutomationIntent(
  context: { prompt: string; existingMessages: Message[] },
  options: { stickyActive: boolean; hasPendingReceipts: boolean }
): AutomationIntentSignals {
  const text = lastUserText(context);
  const promptHit = AUTOMATION_PROMPT_PATTERN.test(text);
  const historyHit = sessionUsedToolsWithPrefix(context.existingMessages, ['automation_']);
  const active = promptHit || historyHit || options.stickyActive || options.hasPendingReceipts;
  const update = AUTOMATION_UPDATE_PATTERN.test(text);
  // Scheduling phrasing ("每天早上9点自动运行") implies create even without an
  // explicit create verb; list-only intents still get the small prepare/create pack.
  const create = AUTOMATION_CREATE_PATTERN.test(text) || (promptHit && !update);
  return { active, create, update };
}

/** Per-session sticky pack activation shared by domain extensions. */
export class SessionPackActivation {
  private readonly packs = new Map<string, Set<string>>();

  activate(sessionId: string, packNames: Iterable<string>): Set<string> {
    const existing = this.packs.get(sessionId) ?? new Set<string>();
    for (const name of packNames) existing.add(name);
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
