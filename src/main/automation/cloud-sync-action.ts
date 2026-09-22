import { CLOUD_SYNC_ACTION, cloudSyncSchema } from '../../shared/automation/cloud-sync';
import type { AutomationActionRegistry } from './automation-action-registry';
import { objectSchema } from './automation-action-registry';
import type { DataCommandService } from '../data/data-command-service';
import type { AutomationStore } from './automation-store';
import { cloudActionState } from './cloud-action-state';

export function registerCloudSyncAction(
  registry: AutomationActionRegistry,
  commands: DataCommandService | undefined,
  store: AutomationStore | undefined
): void {
  const pending = new Map<string, { original: string; updates: Record<string, unknown> }>();
  registry.register({
    type: CLOUD_SYNC_ACTION,
    title: 'Sync between cloud space and local tables',
    category: 'integration',
    icon: 'cloud',
    version: 1,
    defaultConfig: {
      direction: '',
      spaceId: '',
      projectId: '',
    },
    configSchema: objectSchema(
      {
        direction: { type: 'string', enum: ['input', 'output'] },
        syncKey: { type: 'string' },
        spaceId: { type: 'string' },
        projectId: { type: 'string' },
        tableId: { type: 'string' },
        tableKind: { type: 'string', enum: ['analysis', 'base'] },
        tableName: { type: 'string' },
        inputTableId: { type: 'string' },
        inputTableName: { type: 'string' },
        outputTableId: { type: 'string', title: 'Output table' },
        type: { type: 'string', enum: ['drive_file'] },
        writeMode: { type: 'string', enum: ['create', 'replace', 'append'] },
        fileId: { type: 'string' },
        fileName: { type: 'string' },
        version: { type: 'integer' },
      },
      ['direction', 'spaceId', 'projectId']
    ),
    validate: (config) => {
      cloudSyncSchema.parse(config);
    },
    execute: async (raw, context, node) => {
      if (!commands || !store) throw new Error('Cloud sync action is unavailable');
      const config = cloudSyncSchema.parse(raw);
      const state = cloudActionState(store, context.automationId, node, cloudSyncSchema, config);
      if (config.direction === 'input') {
        const result = await commands.syncInputTableFromCloud(
          config,
          config.syncKey ?? `automation-${context.automationId}-${node.id}`
        );
        state.save(result);
        context.emitArtifact({
          sourceNodeId: node.id,
          kind: 'data_input',
          title: result.inputTableName,
          dataRef: { kind: 'input_table', id: result.inputTableId },
        });
        return { ...config, ...result };
      }
      const key = `${context.automationId}:${node.id}`;
      const recovery = pending.get(key);
      if (recovery) {
        if (recovery.original === JSON.stringify(state.config) && state.save(recovery.updates)) {
          pending.delete(key);
          return state.config;
        }
        pending.delete(key);
      }
      const updates = await commands.syncOutputTableToCloud(
        config.outputTableId,
        config,
        config.syncKey ?? `automation-${context.automationId}-${node.id}`,
        (version) => {
          if (!state.save({ version }))
            throw new Error('Cloud output action changed during execution');
        }
      );
      pending.set(key, { original: JSON.stringify(state.config), updates });
      state.save(updates);
      pending.delete(key);
      context.emitArtifact({
        sourceNodeId: node.id,
        kind: 'data_output',
        title: String(updates.fileName ?? config.outputTableId),
        dataRef: { kind: 'output_table', id: config.outputTableId },
      });
      return { ...state.config, ...updates };
    },
  });
}
