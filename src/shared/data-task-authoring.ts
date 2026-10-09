import type {
  DataGenerateTaskFromRequirementInput,
  DataGenerateTaskFromRequirementResult,
  Message,
} from './contracts';

/** Durable bindings shared by conversation and UI task authoring. */
export interface DataTaskAuthoringRequest {
  id: string;
  source: DataGenerateTaskFromRequirementInput['source'];
  /** A selected destination is pinned; otherwise it is resolved at generation. */
  output?: DataGenerateTaskFromRequirementInput['output'];
  reuseTaskId?: string | null;
  startFromNodeId?: string | null;
  workflow?: DataGenerateTaskFromRequirementInput['workflow'];
}

export interface DataTaskAuthoringCompletion {
  requestId: string;
  result: DataGenerateTaskFromRequirementResult;
}

export interface DataTaskAuthoringSession {
  sessionId: string;
  requestId: string;
}

export function findDataTaskCompletion(messages: Message[], requestId: string) {
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const block of message.content) {
      if (
        block.type === 'tool_result' &&
        !block.isError &&
        block.dataTaskCompletion?.requestId === requestId
      ) {
        return block.dataTaskCompletion;
      }
    }
  }
  return undefined;
}

export function pendingDataTaskRequest(messages: Message[]) {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'user') continue;
    for (const block of message.content) {
      if (block.type === 'data_task_request') {
        return findDataTaskCompletion(messages, block.request.id) ? undefined : block.request;
      }
    }
  }
  return undefined;
}
