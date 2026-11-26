import type { AppConfig, Automation } from '../../../types';
import type { PendingTableAutomationNavigation } from '../../../store/types';
import {
  automationToDraft,
  createEmptyDraft,
  draftToPayload,
  getCloudAutomationConfigsFromDraft,
  normalizeDraftTrigger,
  relinkLinearGraph,
  validateEnabledActionNodes,
} from './model';
import {
  getOutputLocation,
  getSourceLocation,
  type AutomationDraft,
  type TranslateFn,
} from './types';

export function computeUnsavedDraftParts(
  selectedAutomation: Automation | null,
  draft: AutomationDraft,
  appConfig: AppConfig | null,
  tr: TranslateFn
): string[] {
  if (!selectedAutomation) return [];
  const saved = draftToPayload(automationToDraft(selectedAutomation), appConfig);
  const current = draftToPayload(draft, appConfig);
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const parts: string[] = [];
  if (saved.name !== current.name) parts.push(tr('schedule.partName'));
  if (!same(saved.trigger, current.trigger)) parts.push(tr('schedule.partTrigger'));
  if (saved.projectId !== current.projectId) parts.push(tr('schedule.partProject'));
  if (saved.enabled !== current.enabled) parts.push(tr('schedule.partEnabled'));
  if (!same(saved.actionGraph, current.actionGraph)) {
    const savedNodes = saved.actionGraph?.nodes ?? [];
    const changed = (current.actionGraph?.nodes ?? []).filter(
      (node, index) => !same(savedNodes[index] ?? null, node)
    ).length;
    parts.push(
      `${tr('schedule.partActions')} ${Math.max(changed, 1)} ${tr('schedule.partActionsUnit')}`
    );
  }
  return parts;
}

export function validateAutomationDraft(draft: AutomationDraft, tr: TranslateFn): string | null {
  if (!draft.name.trim()) return tr('schedule.titleRequired');
  if (draft.actionGraph.nodes.length === 0) return tr('schedule.actionRequired');

  const normalizedTrigger = normalizeDraftTrigger(draft.triggerMode, draft.trigger);
  if (normalizedTrigger.kind === 'weekly' && normalizedTrigger.weekdays.length === 0) {
    return tr('schedule.weekdayRequired');
  }
  if (
    normalizedTrigger.kind === 'monthly' &&
    normalizedTrigger.daysOfMonth.length === 0 &&
    !normalizedTrigger.includeLastDay
  ) {
    return tr('schedule.monthDayRequired');
  }
  if (
    normalizedTrigger.kind === 'interval' &&
    normalizedTrigger.endAt != null &&
    normalizedTrigger.endAt <= normalizedTrigger.startAt
  ) {
    return tr('schedule.endAtAfterStartRequired');
  }

  const actionValidationError = validateEnabledActionNodes(draft, tr);
  if (actionValidationError) return actionValidationError;

  const cloudAutomations = getCloudAutomationConfigsFromDraft(draft);
  const missingSource = cloudAutomations.find(
    (cloudAutomation) =>
      !cloudAutomation.source.tableId.trim() || !cloudAutomation.source.tableName.trim()
  );
  if (missingSource) {
    return getSourceLocation(missingSource) === 'local'
      ? tr('schedule.localSourceRequired')
      : tr('schedule.cloudSourceRequired');
  }

  const missingTarget = cloudAutomations.find(
    (cloudAutomation) =>
      cloudAutomation.output.writeMode === 'replace' && !cloudAutomation.output.targetTableId.trim()
  );
  if (missingTarget) {
    return getOutputLocation(missingTarget) === 'local'
      ? tr('schedule.localTargetRequired')
      : tr('schedule.cloudTargetRequired');
  }

  return null;
}

export function prependMissingCloudInputNode(
  draft: AutomationDraft,
  navigation: PendingTableAutomationNavigation
): AutomationDraft {
  if (!navigation.rawTable) return draft;
  const alreadyPresent = draft.actionGraph.nodes.some(
    (node) =>
      node.type === 'cloud.sync' &&
      node.config.direction === 'input' &&
      node.config.rawTableId === navigation.rawTable?.id
  );
  if (alreadyPresent) return draft;

  const node = {
    id: crypto.randomUUID(),
    type: 'cloud.sync',
    enabled: true,
    config: {
      direction: 'input',
      spaceId: navigation.cloudSource?.spaceId ?? '',
      projectId: navigation.cloudSource?.projectId ?? '',
      tableId: navigation.cloudSource?.tableId ?? '',
      tableKind: navigation.cloudSource?.tableKind ?? 'analysis',
      tableName: navigation.cloudSource?.tableName,
      rawTableId: navigation.rawTable.id,
      rawTableName: navigation.rawTable.name,
    },
  };
  return {
    ...draft,
    actionGraph: relinkLinearGraph({
      ...draft.actionGraph,
      nodes: [node, ...draft.actionGraph.nodes],
    }),
  };
}

export function buildTableNavigationDraft(
  navigation: PendingTableAutomationNavigation,
  tr: TranslateFn
): AutomationDraft | null {
  if (navigation.scriptPackage) {
    const pkg = navigation.scriptPackage;
    const base = createEmptyDraft(pkg.name);
    return {
      ...base,
      trigger: { ...base.trigger, kind: 'daily', times: [pkg.time] },
      actionGraph: {
        version: 1,
        edges: [],
        nodes: [
          {
            id: crypto.randomUUID(),
            type: 'script.run',
            enabled: true,
            config: { packageId: pkg.id, timeoutMs: 120_000, onScriptError: 'notify' },
          },
        ],
      },
    };
  }

  if (navigation.resultTable) {
    const table = navigation.resultTable;
    return {
      ...createEmptyDraft(table.name),
      triggerMode: 'manual',
      trigger: {
        kind: 'manual',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      },
      tableBindings: [{ kind: 'result', tableId: table.id, runOnChange: true, runOnTrigger: true }],
      actionGraph: {
        version: 1,
        edges: [],
        nodes: [
          {
            id: crypto.randomUUID(),
            type: 'cloud.sync',
            enabled: true,
            config: {
              direction: 'output',
              resultTableId: table.id,
              type: 'drive_file',
              writeMode: 'create',
              spaceId: '',
              projectId: '',
            },
          },
        ],
      },
    };
  }

  if (navigation.rawTable || navigation.newRawTableName !== undefined) {
    const table = navigation.rawTable;
    const cloudSource = navigation.cloudSource;
    const name = table?.name || navigation.newRawTableName || tr('schedule.cloudInput.title');
    if (table && !cloudSource) {
      return {
        ...createEmptyDraft(name),
        triggerMode: 'manual',
        trigger: {
          kind: 'manual',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        },
        tableBindings: [{ kind: 'raw', tableId: table.id, runOnChange: true, runOnTrigger: false }],
        actionGraph: {
          version: 1,
          edges: [],
          nodes: [
            {
              id: crypto.randomUUID(),
              type: 'data.pipeline.run',
              enabled: true,
              config: { pipelineId: '', outputMode: 'persisted' },
            },
          ],
        },
      };
    }

    return {
      ...createEmptyDraft(name),
      actionGraph: {
        version: 1,
        edges: [],
        nodes: [
          {
            id: crypto.randomUUID(),
            type: 'cloud.sync',
            enabled: true,
            config: {
              direction: 'input',
              spaceId: cloudSource?.spaceId ?? '',
              projectId: cloudSource?.projectId ?? '',
              tableId: cloudSource?.tableId ?? '',
              tableKind: cloudSource?.tableKind ?? 'analysis',
              tableName: cloudSource?.tableName,
              rawTableId: table?.id,
              rawTableName:
                table?.name || navigation.newRawTableName || cloudSource?.tableName || '',
            },
          },
        ],
      },
    };
  }

  return null;
}
