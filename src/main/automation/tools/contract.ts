import { Type, type Static, type TSchema } from 'typebox';
import { z } from 'zod';
import type {
  Automation,
  AutomationCreateInput,
  AutomationTrigger,
} from '../../../shared/automation/types';
import { TOOL_SCHEMA_COPY } from '../../prompts/tool-copy';

const TimezoneSchema = Type.Optional(
  Type.String({
    minLength: 1,
    description: TOOL_SCHEMA_COPY.automation.timezone,
  })
);

const DateRangeProperties = {
  timezone: TimezoneSchema,
  startDate: Type.Optional(Type.String({ description: TOOL_SCHEMA_COPY.automation.startDate })),
  endDate: Type.Optional(Type.String({ description: TOOL_SCHEMA_COPY.automation.endDate })),
};

const TimesSchema = Type.Array(Type.String({ pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$' }), {
  minItems: 1,
  maxItems: 24,
  description: TOOL_SCHEMA_COPY.automation.times,
});

export const AutomationWeekdaySchema = Type.Union([
  Type.Literal('monday'),
  Type.Literal('tuesday'),
  Type.Literal('wednesday'),
  Type.Literal('thursday'),
  Type.Literal('friday'),
  Type.Literal('saturday'),
  Type.Literal('sunday'),
]);

export const AutomationScheduleInputSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('once'),
      runAt: Type.String({
        minLength: 1,
        description: TOOL_SCHEMA_COPY.automation.runAt,
      }),
      timezone: TimezoneSchema,
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal('daily'),
      times: TimesSchema,
      ...DateRangeProperties,
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal('weekly'),
      weekdays: Type.Array(AutomationWeekdaySchema, { minItems: 1, maxItems: 7 }),
      times: TimesSchema,
      ...DateRangeProperties,
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal('monthly'),
      daysOfMonth: Type.Array(Type.Integer({ minimum: 1, maximum: 31 }), { maxItems: 31 }),
      includeLastDay: Type.Optional(Type.Boolean()),
      times: TimesSchema,
      ...DateRangeProperties,
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal('interval'),
      every: Type.Integer({ minimum: 1 }),
      unit: Type.Union([Type.Literal('minute'), Type.Literal('hour'), Type.Literal('day')]),
      startAt: Type.String({
        minLength: 1,
        description: TOOL_SCHEMA_COPY.automation.intervalStartAt,
      }),
      endAt: Type.Optional(Type.String({ description: TOOL_SCHEMA_COPY.automation.intervalEndAt })),
      timezone: TimezoneSchema,
    },
    { additionalProperties: false }
  ),
]);

export const AutomationActionInputSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('data_task'),
      taskId: Type.String({
        minLength: 1,
        description: TOOL_SCHEMA_COPY.automation.dataTaskId,
      }),
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal('conversation'),
      prompt: Type.String({
        minLength: 1,
        maxLength: 20_000,
        description: TOOL_SCHEMA_COPY.automation.conversationPrompt,
      }),
      projectId: Type.Optional(Type.String({ minLength: 1 })),
      selectedSkillNames: Type.Optional(
        Type.Array(Type.String({ minLength: 1 }), { maxItems: 50 })
      ),
    },
    { additionalProperties: false }
  ),
]);

export const AutomationListInputSchema = Type.Object(
  {
    query: Type.Optional(Type.String({ description: TOOL_SCHEMA_COPY.automation.query })),
    status: Type.Optional(
      Type.Union([
        Type.Literal('enabled'),
        Type.Literal('disabled'),
        Type.Literal('paused'),
        Type.Literal('running'),
        Type.Literal('failed'),
        Type.Literal('all'),
      ])
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false }
);

export const AutomationPrepareInputSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    enabled: Type.Optional(Type.Boolean({ default: true })),
    schedule: AutomationScheduleInputSchema,
    action: AutomationActionInputSchema,
  },
  { additionalProperties: false }
);

const SerializedObjectFallbackSchema = Type.String({
  minLength: 2,
  description: TOOL_SCHEMA_COPY.automation.serializedObject,
});

export const AutomationPrepareParametersSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    enabled: Type.Optional(Type.Boolean({ default: true })),
    schedule: Type.Union([AutomationScheduleInputSchema, SerializedObjectFallbackSchema]),
    action: Type.Union([AutomationActionInputSchema, SerializedObjectFallbackSchema]),
  },
  { additionalProperties: false }
);

export const AutomationCreateInputSchema = Type.Object(
  {
    draftId: Type.String({ minLength: 1 }),
    confirmed: Type.Literal(true, {
      description: TOOL_SCHEMA_COPY.automation.createConfirmed,
    }),
  },
  { additionalProperties: false }
);

export const AutomationPrepareScheduleUpdateInputSchema = Type.Object(
  {
    automationId: Type.String({
      minLength: 1,
      description: TOOL_SCHEMA_COPY.automation.automationId,
    }),
    schedule: AutomationScheduleInputSchema,
  },
  { additionalProperties: false }
);

export const AutomationPrepareScheduleUpdateParametersSchema = Type.Object(
  {
    automationId: Type.String({
      minLength: 1,
      description: TOOL_SCHEMA_COPY.automation.automationId,
    }),
    schedule: Type.Union([AutomationScheduleInputSchema, SerializedObjectFallbackSchema]),
  },
  { additionalProperties: false }
);

export const AutomationUpdateScheduleInputSchema = Type.Object(
  {
    draftId: Type.String({ minLength: 1 }),
    confirmed: Type.Literal(true, {
      description: TOOL_SCHEMA_COPY.automation.scheduleUpdateConfirmed,
    }),
  },
  { additionalProperties: false }
);

export const AutomationSetEnabledInputSchema = Type.Object(
  {
    automationId: Type.String({
      minLength: 1,
      description: TOOL_SCHEMA_COPY.automation.automationId,
    }),
    enabled: Type.Boolean({
      description: TOOL_SCHEMA_COPY.automation.enabled,
    }),
    confirmed: Type.Literal(true, {
      description: TOOL_SCHEMA_COPY.automation.enabledConfirmed,
    }),
  },
  { additionalProperties: false }
);

export type AutomationWeekdayName = Static<typeof AutomationWeekdaySchema>;
export type AutomationToolScheduleInput = Static<typeof AutomationScheduleInputSchema>;
export type AutomationToolActionInput = Static<typeof AutomationActionInputSchema>;
export type AutomationPrepareToolInput = Static<typeof AutomationPrepareInputSchema>;
export type AutomationCreateToolInput = Static<typeof AutomationCreateInputSchema>;
export type AutomationListToolInput = Static<typeof AutomationListInputSchema>;
export type AutomationPrepareScheduleUpdateToolInput = Static<
  typeof AutomationPrepareScheduleUpdateInputSchema
>;
export type AutomationUpdateScheduleToolInput = Static<typeof AutomationUpdateScheduleInputSchema>;
export type AutomationSetEnabledToolInput = Static<typeof AutomationSetEnabledInputSchema>;

export interface AutomationToolExecutionContext {
  sessionId: string;
  currentUserMessageId?: string;
}

export interface AutomationToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details: unknown;
}

export interface PreparedAutomationSummary {
  name: string;
  actionKind: 'data_task' | 'conversation';
  actionText: string;
  scheduleText: string;
  timezone: string;
  nextRuns: Array<{ at: number; text: string }>;
}

export interface PreparedAutomationDraft {
  input: AutomationPrepareToolInput;
  createInput: AutomationCreateInput;
  summary: PreparedAutomationSummary;
  dependency: PreparedAutomationDependency;
}

export interface PreparedAutomationScheduleUpdateSummary {
  automationId: string;
  name: string;
  previousScheduleText: string;
  scheduleText: string;
  timezone: string;
  nextRuns: Array<{ at: number; text: string }>;
  enabled: boolean;
  status: Automation['status'];
}

export interface PreparedAutomationScheduleUpdateDraft {
  input: AutomationPrepareScheduleUpdateToolInput;
  automationId: string;
  expectedTrigger: AutomationTrigger;
  trigger: AutomationTrigger;
  summary: PreparedAutomationScheduleUpdateSummary;
}

export type PreparedAutomationDependency =
  | { kind: 'data_task'; taskId: string; taskName: string }
  | { kind: 'conversation'; projectId: string | null };

export interface AutomationToolListItem {
  id: string;
  name: string;
  enabled: boolean;
  status: Automation['status'];
  actionKind: 'data_task' | 'conversation' | 'other';
  dataTaskId?: string;
  scheduleSummary: string;
  timezone: string;
  nextRunAt: number | null;
  nextRunAtText: string | null;
}

const AutomationListRuntimeSchema = createRuntimeSchema(AutomationListInputSchema);
const AutomationPrepareRuntimeSchema = createRuntimeSchema(AutomationPrepareInputSchema);
const AutomationCreateRuntimeSchema = createRuntimeSchema(AutomationCreateInputSchema);
const AutomationPrepareScheduleUpdateRuntimeSchema = createRuntimeSchema(
  AutomationPrepareScheduleUpdateInputSchema
);
const AutomationUpdateScheduleRuntimeSchema = createRuntimeSchema(
  AutomationUpdateScheduleInputSchema
);
const AutomationSetEnabledRuntimeSchema = createRuntimeSchema(AutomationSetEnabledInputSchema);

export function parseAutomationListInput(input: unknown): Static<typeof AutomationListInputSchema> {
  return parseRuntimeInput('automation_list', AutomationListRuntimeSchema, input);
}

export function parseAutomationPrepareInput(input: unknown): AutomationPrepareToolInput {
  const normalized = normalizeSerializedObjectFields(input, ['schedule', 'action']);
  return parseRuntimeInput('automation_prepare', AutomationPrepareRuntimeSchema, normalized);
}

export function parseAutomationCreateInput(
  input: unknown
): Static<typeof AutomationCreateInputSchema> {
  return parseRuntimeInput('automation_create', AutomationCreateRuntimeSchema, input);
}

export function parseAutomationPrepareScheduleUpdateInput(
  input: unknown
): AutomationPrepareScheduleUpdateToolInput {
  const normalized = normalizeSerializedObjectFields(
    input,
    ['schedule'],
    'automation_prepare_schedule_update'
  );
  return parseRuntimeInput(
    'automation_prepare_schedule_update',
    AutomationPrepareScheduleUpdateRuntimeSchema,
    normalized
  );
}

export function parseAutomationUpdateScheduleInput(
  input: unknown
): AutomationUpdateScheduleToolInput {
  return parseRuntimeInput(
    'automation_update_schedule',
    AutomationUpdateScheduleRuntimeSchema,
    input
  );
}

export function parseAutomationSetEnabledInput(input: unknown): AutomationSetEnabledToolInput {
  return parseRuntimeInput('automation_set_enabled', AutomationSetEnabledRuntimeSchema, input);
}

function normalizeSerializedObjectFields(
  input: unknown,
  fields: string[],
  toolName = 'automation_prepare'
): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const normalized = { ...(input as Record<string, unknown>) };
  for (const field of fields) {
    const value = normalized[field];
    if (typeof value !== 'string') continue;
    try {
      normalized[field] = JSON.parse(value);
    } catch {
      throw new Error(
        `Invalid ${toolName} arguments: ${field} must be an object or a valid JSON object string`
      );
    }
  }
  return normalized;
}

function createRuntimeSchema<T extends TSchema>(schema: T): z.ZodType<Static<T>> {
  // TypeBox emits valid JSON Schema, but its optional $schema property is wider than Zod's
  // accepted draft literals. The runtime representation is compatible.
  return z.fromJSONSchema(schema as unknown as Parameters<typeof z.fromJSONSchema>[0]) as z.ZodType<
    Static<T>
  >;
}

function parseRuntimeInput<T>(toolName: string, schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const issues = result.error.issues
    .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid ${toolName} arguments: ${issues}`);
}
