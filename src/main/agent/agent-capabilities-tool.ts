import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { AgentToolPack, ToolActivationResult } from '../extensions/agent-runtime-extension';
import english from '../../shared/i18n/locales/en.json';
import chinese from '../../shared/i18n/locales/zh.json';

export const CAPABILITIES_SEARCH_TOOL_NAME = 'capabilities_search';

interface CapabilityCatalog {
  getPacks: () => Record<string, AgentToolPack>;
  getTools?: () => ReadonlyArray<SearchableTool>;
  refresh?: () => void;
  activateTools: (toolNames: string[]) => ToolActivationResult;
}

type SearchableTool = Pick<ToolDefinition, 'name' | 'description'>;

function buildSearchAliases(): Map<string, string[]> {
  const aliases = new Map<string, string[]>();
  for (const locale of [english, chinese]) {
    for (const [name, words] of Object.entries(locale.agentHarness.searchAliases)) {
      aliases.set(name, [...(aliases.get(name) ?? []), ...words]);
    }
  }
  return aliases;
}

const searchAliases = buildSearchAliases();

function searchTools(
  query: string,
  packs: Record<string, AgentToolPack>,
  definitions: ReadonlyArray<SearchableTool>
) {
  const descriptions = new Map(definitions.map((tool) => [tool.name, tool.description]));
  const names = [...new Set(Object.values(packs).flatMap((pack) => pack.tools))];
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return names
    .map((name) => {
      const words = name.toLowerCase().split(/[_-]/);
      const description = descriptions.get(name) ?? '';
      const aliasesForTool = searchAliases.get(name) ?? [];
      const score =
        terms.reduce(
          (sum, term) =>
            sum +
            (words.includes(term) ? 5 : 0) +
            (description.toLowerCase().includes(term) ? 1 : 0) +
            (aliasesForTool.some((phrase) => phrase.includes(term)) ? 3 : 0),
          0
        ) + (aliasesForTool.some((alias) => query.includes(alias)) || name === query ? 40 : 0);
      return { name, description, score };
    })
    .filter((tool) => tool.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 6)
    .map(({ name, description }) => ({ name, description }));
}

export function createCapabilitiesSearchTool(options: CapabilityCatalog): ToolDefinition {
  return {
    name: CAPABILITIES_SEARCH_TOOL_NAME,
    label: 'Capabilities search',
    description:
      'Find optional tools by task in English or Chinese. Search returns ranked names. Load an exact tool for the next request, or load a named pack for a multi-step task.',
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({ description: 'Task or keywords, e.g. edit workflow plan' })
      ),
      tool: Type.Optional(Type.String({ description: 'Exact tool name to activate' })),
      pack: Type.Optional(Type.String({ description: 'Exact pack name to activate' })),
    }),
    async execute(_id, params) {
      options.refresh?.();
      const packs = options.getPacks();
      const { query, tool, pack } = params as { query?: string; tool?: string; pack?: string };
      if (tool || pack) {
        let names: readonly string[] = [];
        if (tool) {
          if (Object.values(packs).some((group) => group.tools.includes(tool))) names = [tool];
        } else if (pack && Object.hasOwn(packs, pack)) {
          names = packs[pack].tools;
        }
        const result = names.length
          ? options.activateTools([...names])
          : { activated: [], unknown: [tool ?? pack] };
        const details = { ...(pack && { pack }), ...result };
        return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
      }
      const candidates = query?.trim()
        ? searchTools(query.trim().toLowerCase(), packs, options.getTools?.() ?? [])
        : [];
      if (candidates.length) {
        return {
          content: [
            { type: 'text', text: JSON.stringify({ candidates, load: { tool: '<exact name>' } }) },
          ],
          details: { candidates },
        };
      }
      const listing = Object.entries(packs)
        .map(([name, entry]) => `- ${name}: ${entry.description}`)
        .join('\n');
      return {
        content: [
          {
            type: 'text',
            text: `Available capability packs:\n${listing}\nUse {"pack":"<name>"} to activate one.`,
          },
        ],
        details: { packs: Object.keys(packs) },
      };
    },
  };
}
