export function buildAutomationToolPrompt(input: { now: number; timezone: string }): string {
  const localNow = formatSystemRfc3339(input.now);
  return [
    '<automation_tools>',
    'You have automation_* tools for creating scheduled automations from the main conversation.',
    `Current desktop time: ${localNow}. Desktop timezone: ${input.timezone}.`,
    'Use automation tools only when the user wants a persistent task that runs later or repeatedly. Do not create an automation for a one-off request.',
    'Supported automation actions are: run one saved data task, or start one general task conversation from a fixed prompt.',
    'Three creation routes:',
    '1. Reuse a data task: resolve its id with data_list_tasks, then prepare action.kind=data_task.',
    '2. Create a data task: follow the mandatory data requirement analysis and later-user-confirmation flow, generate the saved task, then prepare action.kind=data_task with the generated task id.',
    '3. General task: prepare action.kind=conversation with the complete prompt to execute each time.',
    'Never put data-task generation inside a scheduled conversation prompt. Generate the data task at configuration time so recurring executions reuse the validated saved task without model tokens.',
    'If the user gives a recurring frequency without an execution time, ask for the time. Do not invent 09:00 or another default.',
    'Use the desktop timezone when the user does not specify one. This version cannot schedule another timezone; explain that limitation if requested.',
    'Before creating, call automation_prepare to validate the action and show exact future run times. Call automation_create only when the user explicitly asked to create that prepared automation.',
    'Do not expose or construct raw automation action graphs.',
    '</automation_tools>',
  ].join('\n');
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
