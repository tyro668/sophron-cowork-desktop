import automationToolsRoutingPrompt from './automation-tools-routing.txt?raw';
import { renderPromptTemplate } from './template';

/** Stable automation rules — delivered once per session, not per user turn. */
export function buildAutomationToolStablePrompt(): string {
  return renderPromptTemplate(automationToolsRoutingPrompt, {});
}

/** Per-turn dynamic state: desktop clock used to resolve relative times. */
export function buildAutomationToolStatePrompt(input: { now: number; timezone: string }): string {
  return `Current desktop time: ${formatSystemRfc3339(input.now)}. Desktop timezone: ${input.timezone}.`;
}

function formatSystemRfc3339(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offset = `${offsetSign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`;
}
