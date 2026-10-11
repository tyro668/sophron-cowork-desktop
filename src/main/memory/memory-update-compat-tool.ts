import { Type } from 'typebox';
import type { MemoryToolDefinition } from './memory-types';

/**
 * Old conversation history and model priors can produce this unsupported call.
 * Keep a truthful compatibility response without adding a second write path or
 * treating model-authored notes as user-verified durable memory.
 */
export function createMemoryUpdateCompatibilityTool(
  isEnabled: () => boolean
): MemoryToolDefinition {
  return {
    name: 'memory_update',
    label: 'memory_update',
    description:
      'Compatibility handler for legacy memory_update calls. Does not save memory. The application handles memory automatically after the turn; do not call this tool to save or correct memories.',
    parameters: Type.Object({
      content: Type.String({
        minLength: 1,
        description: 'Legacy memory note; not a direct memory write.',
      }),
    }),
    async execute() {
      const enabled = isEnabled();
      return {
        content: [
          {
            type: 'text' as const,
            text: enabled
              ? 'No memory was written by this call. After the turn ends, the application queues the conversation for automatic background memory extraction. Do not retry memory_update or claim that this note has been saved. Continue the user task.'
              : 'Memory is disabled for this conversation. No memory was written or queued by this call. Do not retry memory_update or promise cross-conversation retention. Continue the user task.',
          },
        ],
        details: { status: enabled ? 'managed_automatically' : 'disabled', saved: false },
      };
    },
  };
}
