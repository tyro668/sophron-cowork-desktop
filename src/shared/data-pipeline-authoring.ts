import type {
  DataGeneratePipelineFromRequirementInput,
  DataGeneratePipelineFromRequirementResult,
  Message,
} from './contracts';

/** Durable bindings shared by conversation and UI pipeline authoring. */
export interface DataPipelineAuthoringRequest {
  id: string;
  source: DataGeneratePipelineFromRequirementInput['source'];
  /** A selected destination is pinned; otherwise it is resolved at generation. */
  output?: DataGeneratePipelineFromRequirementInput['output'];
  reusePipelineId?: string | null;
  startFromNodeId?: string | null;
  workflow?: DataGeneratePipelineFromRequirementInput['workflow'];
}

export interface DataPipelineAuthoringCompletion {
  requestId: string;
  result: DataGeneratePipelineFromRequirementResult;
}

export interface DataPipelineAuthoringSession {
  sessionId: string;
  requestId: string;
}

export function findDataPipelineCompletion(messages: Message[], requestId: string) {
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const block of message.content) {
      if (
        block.type === 'tool_result' &&
        !block.isError &&
        block.dataPipelineCompletion?.requestId === requestId
      ) {
        return block.dataPipelineCompletion;
      }
    }
  }
  return undefined;
}

export function pendingDataPipelineRequest(messages: Message[]) {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'user') continue;
    for (const block of message.content) {
      if (block.type === 'data_pipeline_request') {
        return findDataPipelineCompletion(messages, block.request.id) ? undefined : block.request;
      }
    }
  }
  return undefined;
}
