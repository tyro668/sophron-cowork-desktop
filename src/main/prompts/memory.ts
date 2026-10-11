import coreMemoryUpdateSystemPromptRaw from './memory/core-memory-update-system.txt?raw';
import memoryNavigationPromptRaw from './memory/memory-navigation-system.txt?raw';
import promptIterationSystemPromptRaw from './memory/prompt-iteration-system.txt?raw';
import retrievalEvalSystemPromptRaw from './memory/retrieval-eval-system.txt?raw';
import retrievalEvalUserPromptTemplate from './memory/retrieval-eval-user.txt?raw';
import sessionChunkExtractionPromptRaw from './memory/session-chunk-extraction-system.txt?raw';
import { renderPromptTemplate } from './template';
import memoryAgentRuntimePromptRaw from './memory/agent-runtime.txt?raw';

export function buildMemoryAgentRuntimePrompt(enabled: boolean): string {
  return renderPromptTemplate(memoryAgentRuntimePromptRaw, {
    MEMORY_STATUS: enabled
      ? 'Memory is enabled for this conversation. After the turn ends, the application queues the conversation for background extraction; it decides which information is worth retaining. This is asynchronous and is not a guarantee of persistence.'
      : 'Memory is disabled for this conversation. No background memory extraction will be requested. Do not promise to remember information across conversations.',
  });
}

export interface MemoryPromptSet {
  coreMemoryUpdateSystemPrompt: string;
  sessionChunkExtractionPrompt: string;
  memoryNavigationPrompt: string;
  promptIterationSystemPrompt: string;
}

// Preserve the leading and trailing newlines of the legacy template literals so
// moving the text to files does not change the prompts sent to the model.
function preserveLegacyTemplateWhitespace(prompt: string): string {
  return `\n${prompt.trim()}\n`;
}

export const DEFAULT_MEMORY_PROMPTS: MemoryPromptSet = {
  coreMemoryUpdateSystemPrompt: preserveLegacyTemplateWhitespace(coreMemoryUpdateSystemPromptRaw),
  sessionChunkExtractionPrompt: preserveLegacyTemplateWhitespace(sessionChunkExtractionPromptRaw),
  memoryNavigationPrompt: preserveLegacyTemplateWhitespace(memoryNavigationPromptRaw),
  promptIterationSystemPrompt: preserveLegacyTemplateWhitespace(promptIterationSystemPromptRaw),
};

export const CORE_MEMORY_UPDATE_SYSTEM_PROMPT = DEFAULT_MEMORY_PROMPTS.coreMemoryUpdateSystemPrompt;
export const SESSION_CHUNK_EXTRACTION_PROMPT = DEFAULT_MEMORY_PROMPTS.sessionChunkExtractionPrompt;
export const MEMORY_NAVIGATION_PROMPT = DEFAULT_MEMORY_PROMPTS.memoryNavigationPrompt;
export const PROMPT_ITERATION_SYSTEM_PROMPT = DEFAULT_MEMORY_PROMPTS.promptIterationSystemPrompt;

export const MEMORY_RETRIEVAL_EVAL_SYSTEM_PROMPT = retrievalEvalSystemPromptRaw.trim();

export function buildMemoryRetrievalEvalUserPrompt(input: {
  prompt: string;
  promptPrefix: string;
}): string {
  return renderPromptTemplate(retrievalEvalUserPromptTemplate, {
    USER_PROMPT: input.prompt,
    PROMPT_PREFIX: input.promptPrefix,
  });
}
