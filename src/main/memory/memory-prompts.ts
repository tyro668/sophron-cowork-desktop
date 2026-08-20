// Compatibility facade: memory callers keep their existing import path while
// the prompt content and defaults are maintained in the central prompt catalog.
export {
  CORE_MEMORY_UPDATE_SYSTEM_PROMPT,
  DEFAULT_MEMORY_PROMPTS,
  MEMORY_NAVIGATION_PROMPT,
  PROMPT_ITERATION_SYSTEM_PROMPT,
  SESSION_CHUNK_EXTRACTION_PROMPT,
  type MemoryPromptSet,
} from '../prompts/memory';
