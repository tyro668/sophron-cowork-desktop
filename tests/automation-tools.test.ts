import { describe, expect, it, vi } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import type { Automation } from '../src/shared/automation/types';
import { compileAutomationSchedule } from '../src/main/automation/tools/schedule-compiler';
import { AutomationToolService } from '../src/main/automation/tools/service';
import { AutomationDraftReceiptStore } from '../src/main/automation/tools/draft-receipt-store';
import { createAutomationCustomTools } from '../src/main/automation/tools';
import {
  AutomationPrepareParametersSchema,
  AutomationPrepareScheduleUpdateParametersSchema,
  AutomationSetEnabledInputSchema,
  parseAutomationPrepareScheduleUpdateInput,
  parseAutomationPrepareInput,
  parseAutomationSetEnabledInput,
} from '../src/main/automation/tools/contract';
import { createDefaultAutomationActionRegistry } from '../src/main/automation/default-actions';

function createServiceFixture(options: { now?: () => number } = {}) {
  const automations: Automation[] = [];
  const create = vi.fn((input) => {
    const now = options.now?.() ?? Date.now();
    const automation: Automation = {
      id: `automation-${automations.length + 1}`,
      name: input.name,
      description: input.description ?? null,
      projectId: input.projectId ?? null,
      enabled: input.enabled !== false,
      status: input.enabled === false ? 'disabled' : 'enabled',
      trigger: input.trigger,
      actionGraph: input.actionGraph,
      delivery: null,
      failurePolicy: {
        disableOnFailure: false,
        retry: { enabled: false, maxAttempts: 0, backoffMs: 60_000 },
        notifyOnFailure: true,
      },
      concurrencyPolicy: { overlapPolicy: 'skip' },
      nextRunAt: input.trigger.kind === 'once' ? input.trigger.runAt : now + 60_000,
      lockedRunId: null,
      lastRunAt: null,
      lastRunStatus: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    automations.push(automation);
    return automation;
  });
  const update = vi.fn((id: string, input: Partial<Automation>) => {
    const index = automations.findIndex((automation) => automation.id === id);
    if (index < 0) return null;
    const current = automations[index];
    const trigger = input.trigger ?? current.trigger;
    const enabled = input.enabled ?? current.enabled;
    const now = options.now?.() ?? Date.now();
    const updated: Automation = {
      ...current,
      ...input,
      enabled,
      status: !enabled
        ? 'disabled'
        : current.status === 'paused'
          ? 'paused'
          : current.status === 'running'
            ? 'running'
            : 'enabled',
      trigger,
      nextRunAt:
        enabled && trigger.kind === 'once'
          ? trigger.runAt > now
            ? trigger.runAt
            : null
          : enabled
            ? now + 60_000
            : null,
      updatedAt: now,
    };
    automations[index] = updated;
    return updated;
  });
  const automationService = {
    list: vi.fn(() => automations),
    get: vi.fn((id: string) => automations.find((automation) => automation.id === id) ?? null),
    create,
    update,
    setEnabled: vi.fn((id: string, enabled: boolean) => {
      const index = automations.findIndex((automation) => automation.id === id);
      if (index < 0) return null;
      const current = automations[index];
      const now = options.now?.() ?? Date.now();
      const updated: Automation = {
        ...current,
        enabled,
        status: enabled ? 'enabled' : 'disabled',
        nextRunAt:
          enabled && current.trigger.kind === 'once'
            ? current.trigger.runAt > now
              ? current.trigger.runAt
              : null
            : enabled
              ? now + 60_000
              : null,
        lastError: enabled ? null : current.lastError,
        updatedAt: now,
      };
      automations[index] = updated;
      return updated;
    }),
  };
  const task = {
    id: 'task-1',
    name: 'Clean sales',
    status: 'completed',
    nodeCount: 2,
  };
  const dataTaskStore = {
    getTaskRecord: vi.fn(async (id: string) => (id === task.id ? task : null)),
    getTaskWorkflow: vi.fn(async (id: string) => {
      if (id !== task.id) throw new Error('not found');
      return { nodes: [{ id: 'input' }, { id: 'output' }], edges: [] };
    }),
  };
  const onAutomationsChanged = vi.fn();
  const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const service = new AutomationToolService({
    automationService: automationService as never,
    dataTaskStore: dataTaskStore as never,
    receiptStore: new AutomationDraftReceiptStore({ now: options.now }),
    now: options.now,
    systemTimezone: () => systemTimezone,
    onAutomationsChanged,
  });
  return {
    service,
    automations,
    create,
    update,
    dataTaskStore,
    onAutomationsChanged,
    systemTimezone,
  };
}

describe('automation conversation tools', () => {
  it('exposes create and schedule-update tools', () => {
    const { service } = createServiceFixture();
    const tools = createAutomationCustomTools(service, { sessionId: 'session-1' });
    expect(tools.map((tool) => tool.name)).toEqual([
      'automation_list',
      'automation_set_enabled',
      'automation_prepare',
      'automation_create',
      'automation_prepare_schedule_update',
      'automation_update_schedule',
    ]);
  });

  it('validates enable and disable tool input', () => {
    expect(
      Value.Check(AutomationSetEnabledInputSchema, {
        automationId: 'automation-1',
        enabled: false,
        confirmed: true,
      })
    ).toBe(true);
    expect(
      parseAutomationSetEnabledInput({
        automationId: 'automation-1',
        enabled: true,
        confirmed: true,
      })
    ).toEqual({ automationId: 'automation-1', enabled: true, confirmed: true });
    expect(() =>
      parseAutomationSetEnabledInput({ automationId: 'automation-1', enabled: false })
    ).toThrow('Invalid automation_set_enabled arguments');
  });

  it('accepts model-serialized schedule and action objects, then validates them with Zod', async () => {
    const { service } = createServiceFixture();
    const tools = createAutomationCustomTools(service, { sessionId: 'session-1' });
    const prepareTool = tools.find((tool) => tool.name === 'automation_prepare');
    const rawArguments = {
      name: 'Daily sales cleanup',
      schedule: JSON.stringify({ kind: 'daily', times: ['10:00'] }),
      action: JSON.stringify({ kind: 'data_task', taskId: 'task-1' }),
    };

    expect(Value.Check(AutomationPrepareParametersSchema, rawArguments)).toBe(true);
    expect(prepareTool).toBeDefined();

    const prepared = await Reflect.apply(prepareTool!.execute, prepareTool, [
      'tool-call-1',
      rawArguments,
    ]);
    expect(prepared.details).toMatchObject({ status: 'ready' });
  });

  it('keeps strict validation after parsing compatibility JSON strings', () => {
    expect(() =>
      parseAutomationPrepareInput({
        name: 'Invalid time',
        schedule: JSON.stringify({ kind: 'daily', times: ['25:00'] }),
        action: JSON.stringify({ kind: 'data_task', taskId: 'task-1' }),
      })
    ).toThrow('Invalid automation_prepare arguments');

    expect(() =>
      parseAutomationPrepareInput({
        name: 'Malformed JSON',
        schedule: '{not-json}',
        action: JSON.stringify({ kind: 'data_task', taskId: 'task-1' }),
      })
    ).toThrow('schedule must be an object or a valid JSON object string');

    expect(() =>
      parseAutomationPrepareInput({
        name: 'Unexpected field',
        schedule: { kind: 'daily', times: ['10:00'], unexpected: true },
        action: { kind: 'data_task', taskId: 'task-1' },
      })
    ).toThrow('schedule: Invalid input');

    expect(
      parseAutomationPrepareScheduleUpdateInput({
        automationId: 'automation-1',
        schedule: JSON.stringify({ kind: 'daily', times: ['10:00'] }),
      })
    ).toEqual({
      automationId: 'automation-1',
      schedule: { kind: 'daily', times: ['10:00'] },
    });
    expect(
      Value.Check(AutomationPrepareScheduleUpdateParametersSchema, {
        automationId: 'automation-1',
        schedule: JSON.stringify({ kind: 'daily', times: ['10:00'] }),
      })
    ).toBe(true);
  });

  it('prepares a saved data task and creates it idempotently', async () => {
    const { service, create, onAutomationsChanged } = createServiceFixture();
    const runAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const prepared = await service.prepare(
      {
        name: 'Hourly sales cleanup',
        schedule: { kind: 'once', runAt },
        action: { kind: 'data_task', taskId: 'task-1' },
      },
      { sessionId: 'session-1', currentUserMessageId: 'message-1' }
    );
    const draftId = (prepared.details as { draftId: string }).draftId;

    const first = await service.create(
      { draftId, confirmed: true },
      { sessionId: 'session-1', currentUserMessageId: 'message-1' }
    );
    const second = await service.create(
      { draftId, confirmed: true },
      { sessionId: 'session-1', currentUserMessageId: 'message-1' }
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(onAutomationsChanged).toHaveBeenCalledTimes(1);
    expect((first.details as { status: string }).status).toBe('created');
    expect((second.details as { status: string }).status).toBe('already_created');
    expect(create.mock.calls[0]?.[0].actionGraph.nodes[0]).toMatchObject({
      type: 'data.task.run',
      config: { taskId: 'task-1', outputMode: 'persisted' },
    });
  });

  it('rejects a data task that does not exist', async () => {
    const { service } = createServiceFixture();
    await expect(
      service.prepare(
        {
          name: 'Missing task',
          schedule: { kind: 'once', runAt: new Date(Date.now() + 60_000).toISOString() },
          action: { kind: 'data_task', taskId: 'missing' },
        },
        { sessionId: 'session-1' }
      )
    ).rejects.toThrow('Data task not found');
  });

  it('rejects a prepared one-time schedule after its run time has passed', async () => {
    let now = Date.now();
    const { service, create } = createServiceFixture({ now: () => now });
    const prepared = await service.prepare(
      {
        name: 'Soon',
        schedule: { kind: 'once', runAt: new Date(now + 60_000).toISOString() },
        action: { kind: 'conversation', prompt: 'Do something.' },
      },
      { sessionId: 'session-1' }
    );
    const draftId = (prepared.details as { draftId: string }).draftId;
    now += 120_000;

    await expect(
      service.create({ draftId, confirmed: true }, { sessionId: 'session-1' })
    ).rejects.toThrow('no longer has a future execution time');
    expect(create).not.toHaveBeenCalled();
  });

  it('maps a general recurring task to conversation.run with unattended defaults', async () => {
    const { service, create } = createServiceFixture();
    const prepared = await service.prepare(
      {
        name: 'Daily joke',
        schedule: { kind: 'daily', times: ['09:00'] },
        action: { kind: 'conversation', prompt: '讲一个不重复的冷笑话。' },
      },
      { sessionId: 'session-1' }
    );
    const draftId = (prepared.details as { draftId: string }).draftId;
    await service.create({ draftId, confirmed: true }, { sessionId: 'session-1' });

    const createInput = create.mock.calls[0]?.[0];
    expect(createInput.actionGraph.nodes[0]).toMatchObject({
      type: 'conversation.run',
      config: {
        prompt: '讲一个不重复的冷笑话。',
        completionMode: 'wait',
        permissionPolicy: 'auto_review',
      },
    });
  });

  it('previews and applies a schedule-only update idempotently', async () => {
    const now = new Date(2026, 7, 17, 8, 0, 0, 0).getTime();
    const { service, create, update, onAutomationsChanged } = createServiceFixture({
      now: () => now,
    });
    create({
      name: 'Daily sales cleanup',
      enabled: true,
      trigger: {
        kind: 'daily',
        times: ['09:00'],
        startAt: null,
        endAt: null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      },
      actionGraph: { version: 1, nodes: [], edges: [] },
    });

    const prepared = service.prepareScheduleUpdate(
      {
        automationId: 'automation-1',
        schedule: { kind: 'daily', times: ['10:00'] },
      },
      { sessionId: 'session-1', currentUserMessageId: 'message-1' }
    );
    const details = prepared.details as {
      draftId: string;
      summary: { previousScheduleText: string; scheduleText: string };
    };
    expect(details.summary.previousScheduleText).toContain('09:00');
    expect(details.summary.scheduleText).toContain('10:00');

    const first = service.updateSchedule(
      { draftId: details.draftId, confirmed: true },
      { sessionId: 'session-1' }
    );
    const second = service.updateSchedule(
      { draftId: details.draftId, confirmed: true },
      { sessionId: 'session-1' }
    );

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      'automation-1',
      expect.objectContaining({
        trigger: expect.objectContaining({ kind: 'daily', times: ['10:00'] }),
      })
    );
    expect(Object.keys(update.mock.calls[0]?.[1] ?? {})).toEqual(['trigger']);
    expect(onAutomationsChanged).toHaveBeenCalledTimes(1);
    expect(first.details).toMatchObject({ status: 'updated' });
    expect(second.details).toMatchObject({ status: 'already_updated' });
  });

  it('disables and re-enables an automation, rescheduling only on state changes', () => {
    const { service, create, automations, onAutomationsChanged } = createServiceFixture();
    create({
      name: 'Daily report',
      enabled: true,
      trigger: {
        kind: 'daily',
        times: ['09:00'],
        startAt: null,
        endAt: null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      },
      actionGraph: { version: 1, nodes: [], edges: [] },
    });

    const disabled = service.setEnabled({
      automationId: 'automation-1',
      enabled: false,
      confirmed: true,
    });
    const disabledAgain = service.setEnabled({
      automationId: 'automation-1',
      enabled: false,
      confirmed: true,
    });
    const enabled = service.setEnabled({
      automationId: 'automation-1',
      enabled: true,
      confirmed: true,
    });

    expect(disabled.details).toMatchObject({
      status: 'updated',
      automation: { enabled: false, status: 'disabled', nextRunAt: null },
    });
    expect(disabledAgain.details).toMatchObject({ status: 'unchanged' });
    expect(enabled.details).toMatchObject({
      status: 'updated',
      automation: { enabled: true, status: 'enabled' },
    });
    expect(automations[0]?.enabled).toBe(true);
    expect(onAutomationsChanged).toHaveBeenCalledTimes(2);
  });

  it('enabling a paused automation makes it active again', () => {
    const { service, create, automations, onAutomationsChanged } = createServiceFixture();
    create({
      name: 'Paused report',
      enabled: true,
      trigger: {
        kind: 'daily',
        times: ['09:00'],
        startAt: null,
        endAt: null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      },
      actionGraph: { version: 1, nodes: [], edges: [] },
    });
    automations[0] = { ...automations[0], status: 'paused' };

    const result = service.setEnabled({
      automationId: 'automation-1',
      enabled: true,
      confirmed: true,
    });

    expect(result.details).toMatchObject({
      status: 'updated',
      automation: { enabled: true, status: 'enabled' },
    });
    expect(onAutomationsChanged).toHaveBeenCalledOnce();
  });

  it('uses the custom tool to disable the exact automation id', async () => {
    const { service, create, automations } = createServiceFixture();
    create({
      name: 'Daily report',
      enabled: true,
      trigger: {
        kind: 'daily',
        times: ['09:00'],
        startAt: null,
        endAt: null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      },
      actionGraph: { version: 1, nodes: [], edges: [] },
    });
    const tool = createAutomationCustomTools(service, { sessionId: 'session-1' }).find(
      (candidate) => candidate.name === 'automation_set_enabled'
    );

    const result = await Reflect.apply(tool!.execute, tool, [
      'tool-call-1',
      { automationId: 'automation-1', enabled: false, confirmed: true },
    ]);

    expect(result.details).toMatchObject({ status: 'updated' });
    expect(automations[0]).toMatchObject({ enabled: false, status: 'disabled' });
  });

  it('rejects enabling or disabling an automation that does not exist', () => {
    const { service, onAutomationsChanged } = createServiceFixture();

    expect(() =>
      service.setEnabled({
        automationId: 'missing',
        enabled: false,
        confirmed: true,
      })
    ).toThrow('Automation not found: missing');
    expect(onAutomationsChanged).not.toHaveBeenCalled();
  });

  it('does not overwrite a schedule changed after update preparation', () => {
    const now = new Date(2026, 7, 17, 8, 0, 0, 0).getTime();
    const { service, automations, create, update } = createServiceFixture({ now: () => now });
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    create({
      name: 'Daily report',
      trigger: { kind: 'daily', times: ['09:00'], startAt: null, endAt: null, timezone },
      actionGraph: { version: 1, nodes: [], edges: [] },
    });
    const prepared = service.prepareScheduleUpdate(
      { automationId: 'automation-1', schedule: { kind: 'daily', times: ['10:00'] } },
      { sessionId: 'session-1' }
    );
    automations[0] = {
      ...automations[0],
      trigger: { kind: 'daily', times: ['11:00'], startAt: null, endAt: null, timezone },
    };

    expect(() =>
      service.updateSchedule(
        { draftId: (prepared.details as { draftId: string }).draftId, confirmed: true },
        { sessionId: 'session-1' }
      )
    ).toThrow('schedule changed after this draft was prepared');
    expect(update).not.toHaveBeenCalled();
  });

  it('does not allow a schedule update draft to cross conversations', () => {
    const now = new Date(2026, 7, 17, 8, 0, 0, 0).getTime();
    const { service, create, update } = createServiceFixture({ now: () => now });
    create({
      name: 'Daily report',
      trigger: {
        kind: 'daily',
        times: ['09:00'],
        startAt: null,
        endAt: null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      },
      actionGraph: { version: 1, nodes: [], edges: [] },
    });
    const prepared = service.prepareScheduleUpdate(
      { automationId: 'automation-1', schedule: { kind: 'daily', times: ['10:00'] } },
      { sessionId: 'session-1' }
    );

    expect(() =>
      service.updateSchedule(
        { draftId: (prepared.details as { draftId: string }).draftId, confirmed: true },
        { sessionId: 'session-2' }
      )
    ).toThrow('belongs to another conversation');
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a one-time schedule update after its future time has passed', () => {
    let now = new Date(2026, 7, 17, 8, 0, 0, 0).getTime();
    const { service, create, update } = createServiceFixture({ now: () => now });
    create({
      name: 'One time report',
      trigger: {
        kind: 'once',
        runAt: now + 60_000,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      },
      actionGraph: { version: 1, nodes: [], edges: [] },
    });
    const prepared = service.prepareScheduleUpdate(
      {
        automationId: 'automation-1',
        schedule: { kind: 'once', runAt: new Date(now + 120_000).toISOString() },
      },
      { sessionId: 'session-1' }
    );
    now += 180_000;

    expect(() =>
      service.updateSchedule(
        { draftId: (prepared.details as { draftId: string }).draftId, confirmed: true },
        { sessionId: 'session-1' }
      )
    ).toThrow('no longer has a future execution time');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('saved data task automation action', () => {
  it('emits the workflow output table id instead of the task id', async () => {
    const emitArtifact = vi.fn();
    const registry = createDefaultAutomationActionRegistry({
      dataTaskStore: {
        runTask: vi.fn(async () => ({
          id: 'task-1',
          name: 'Clean sales',
          rowCount: 2,
          columnCount: 3,
        })),
        getTaskWorkflow: vi.fn(async () => ({
          nodes: [
            {
              id: 'output',
              type: 'output',
              config: { outputDatasetId: 'output-table-1' },
            },
          ],
          edges: [],
        })),
      } as never,
      sessionManager: {} as never,
    });

    await registry.get('data.task.run')?.execute(
      { taskId: 'task-1', outputMode: 'persisted' },
      {
        automationId: 'automation-1',
        runId: 'run-1',
        now: Date.now(),
        outputs: new Map(),
        emitArtifact,
        log: vi.fn(),
      },
      { id: 'node-1', type: 'data.task.run', enabled: true, config: {} }
    );

    expect(emitArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        dataRef: { kind: 'output_table', id: 'output-table-1' },
      })
    );
  });
});

describe('automation schedule compiler', () => {
  it('computes future daily runs in the system timezone', () => {
    const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const now = new Date(2026, 7, 14, 8, 0, 0, 0).getTime();
    const compiled = compileAutomationSchedule(
      { kind: 'daily', times: ['09:00'] },
      { now, systemTimezone, nextRunCount: 3 }
    );
    expect(compiled.nextRuns).toHaveLength(3);
    expect(compiled.nextRuns[0]?.at).toBe(new Date(2026, 7, 14, 9, 0, 0, 0).getTime());
  });

  it('rejects an empty recurring time and a non-system timezone', () => {
    const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    expect(() =>
      compileAutomationSchedule({ kind: 'daily', times: [] }, { systemTimezone })
    ).toThrow('requires at least one execution time');

    const unsupportedTimezone = systemTimezone === 'UTC' ? 'Asia/Shanghai' : 'UTC';
    expect(() =>
      compileAutomationSchedule(
        { kind: 'daily', times: ['09:00'], timezone: unsupportedTimezone },
        { systemTimezone }
      )
    ).toThrow('only schedule in the system timezone');
  });
});
