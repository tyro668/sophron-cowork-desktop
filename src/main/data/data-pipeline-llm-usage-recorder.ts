import { randomUUID } from 'node:crypto';
import type { DatabaseInstance } from '../db/database';

export interface DataPipelineLlmUsageEvent {
  generationId: string;
  feature: 'data_pipeline_requirement_analysis' | 'data_pipeline_generation';
  phase: 'requirement_analysis' | 'initial_generation' | 'repair';
  pipelineId?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costTotal: number;
  durationMs: number;
  stopReason?: string;
  metadata?: Record<string, unknown>;
  createdAt?: number;
}

export type DataPipelineLlmUsageRecorder = (event: DataPipelineLlmUsageEvent) => void;

export function createDataPipelineLlmUsageRecorder(
  database: DatabaseInstance
): DataPipelineLlmUsageRecorder {
  const insert = database.raw.prepare(`
    INSERT INTO llm_usage_events (
      id, generation_id, feature, phase, pipeline_id, provider, model,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      total_tokens, cost_total, duration_ms, stop_reason, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return (event) => {
    insert.run(
      randomUUID(),
      event.generationId,
      event.feature,
      event.phase,
      event.pipelineId ?? null,
      event.provider,
      event.model,
      event.inputTokens,
      event.outputTokens,
      event.cacheReadTokens,
      event.cacheWriteTokens,
      event.totalTokens,
      event.costTotal,
      event.durationMs,
      event.stopReason ?? null,
      event.metadata ? JSON.stringify(event.metadata) : null,
      event.createdAt ?? Date.now()
    );
  };
}
