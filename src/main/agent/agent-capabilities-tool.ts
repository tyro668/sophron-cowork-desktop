/**
 * `capabilities_search` — the always-exposed discovery entry for optional tool
 * packs. Domain packs stay registered but hidden until activated; this tool
 * lists packs and activates them mid-run so the next provider request already
 * sees the tools.
 */
import { Type } from '@sinclair/typebox';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { AgentToolPack, ToolActivationResult } from '../extensions/agent-runtime-extension';

export const CAPABILITIES_SEARCH_TOOL_NAME = 'capabilities_search';

export function createCapabilitiesSearchTool(options: {
  getPacks: () => Record<string, AgentToolPack>;
  activateTools: (toolNames: string[]) => ToolActivationResult;
}): ToolDefinition {
  return {
    name: CAPABILITIES_SEARCH_TOOL_NAME,
    label: 'Capabilities search',
    description:
      'Discover and activate optional capability packs (data table creation, normalizer drafts, cloud sync, workflow plan/DSL authoring, automation create/reschedule). Call when a needed data_* or automation_* tool is not currently available.',
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({
          description:
            'What you want to do, e.g. "edit workflow plan" or "update automation schedule"',
        })
      ),
      pack: Type.Optional(Type.String({ description: 'Exact pack name from a previous listing' })),
    }),
    async execute(_toolCallId, params) {
      const packs = options.getPacks();
      const input = (params ?? {}) as { query?: string; pack?: string };

      if (input.pack && packs[input.pack]) {
        const result = options.activateTools([...packs[input.pack].tools]);
        return {
          content: [
            {
              type: 'text' as const,
              text:
                result.activated.length > 0
                  ? `Activated pack "${input.pack}". Tools now available: ${result.activated.join(', ')}. Call them now.`
                  : `No tools could be activated from pack "${input.pack}".`,
            },
          ],
          details: { pack: input.pack, ...result },
        };
      }

      const query = input.query?.trim().toLowerCase() ?? '';
      const matches = Object.entries(packs).filter(
        ([name, pack]) =>
          query.length > 0 &&
          (name.toLowerCase().includes(query) ||
            pack.description.toLowerCase().includes(query) ||
            pack.tools.some((tool) => tool.toLowerCase().includes(query)))
      );

      if (matches.length === 0) {
        const listing = Object.entries(packs)
          .map(([name, pack]) => `- ${name}: ${pack.description} (${pack.tools.length} tools)`)
          .join('\n');
        return {
          content: [
            {
              type: 'text' as const,
              text: `Available capability packs:\n${listing}\nCall again with {"pack":"<name>"} to activate one.`,
            },
          ],
          details: { packs: Object.keys(packs) },
        };
      }

      const result = options.activateTools(matches.flatMap(([, pack]) => [...pack.tools]));
      return {
        content: [
          {
            type: 'text' as const,
            text: `Activated ${matches.map(([name]) => name).join(', ')}. Tools now available: ${result.activated.join(', ')}. Call them now.`,
          },
        ],
        details: { packs: matches.map(([name]) => name), ...result },
      };
    },
  };
}
