import type {
  AutomationActionDefinitionSummary,
  AutomationActionNode,
  AutomationArtifact,
  AutomationJsonSchema,
} from '../../shared/automation/types';

export interface AutomationRunContext {
  automationId: string;
  runId: string;
  projectId?: string | null;
  cwd?: string | null;
  now: number;
  outputs: Map<string, unknown>;
  emitArtifact: (artifact: Omit<AutomationArtifact, 'id' | 'runId' | 'createdAt'>) => void;
  log: (event: AutomationRunLogEvent) => void;
}

export interface AutomationRunLogEvent {
  level: 'debug' | 'info' | 'warning' | 'error';
  message: string;
  nodeId?: string;
  timestamp?: number;
  details?: Record<string, unknown>;
}

export interface AutomationActionDefinition<TConfig = Record<string, unknown>, TResult = unknown>
  extends AutomationActionDefinitionSummary {
  defaultConfig: TConfig;
  outputSchema?: AutomationJsonSchema;
  validate?: (config: TConfig) => void | Promise<void>;
  execute: (
    config: TConfig,
    context: AutomationRunContext,
    node: AutomationActionNode
  ) => Promise<TResult>;
}

export class AutomationActionRegistry {
  private readonly definitions = new Map<string, AutomationActionDefinition>();

  register(definition: AutomationActionDefinition): void {
    if (this.definitions.has(definition.type)) {
      throw new Error(`Automation action already registered: ${definition.type}`);
    }
    this.definitions.set(definition.type, definition);
  }

  get(type: string): AutomationActionDefinition | null {
    return this.definitions.get(type) ?? null;
  }

  list(): AutomationActionDefinitionSummary[] {
    return Array.from(this.definitions.values()).map((definition) => ({
      type: definition.type,
      title: definition.title,
      description: definition.description,
      category: definition.category,
      icon: definition.icon,
      version: definition.version,
      configSchema: definition.configSchema,
    }));
  }
}

export function objectSchema(
  properties: AutomationJsonSchema['properties'],
  required?: string[]
): AutomationJsonSchema {
  return {
    type: 'object',
    required,
    properties,
  };
}

