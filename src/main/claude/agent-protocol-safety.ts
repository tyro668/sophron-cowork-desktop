import type {
  AssistantMessage as PiAssistantMessage,
  Message as PiMessage,
  TextContent as PiTextContent,
  ToolCall as PiToolCall,
  ToolResultMessage as PiToolResultMessage,
  UserMessage as PiUserMessage,
} from '@mariozechner/pi-ai';
import type { ContentBlock, Message } from '../../renderer/types';

const TOOL_PROTOCOL_OPENERS = [
  '<tool_use',
  '<tool_call',
  '<function_call',
  '<function=',
  '<parameter=',
] as const;
const MAX_PROTOCOL_CANDIDATE_LENGTH = 512;
const MAX_HISTORICAL_TOOL_RESULT_CHARS = 8_000;

export interface ColdStartHistoryOptions {
  api: string;
  provider: string;
  model: string;
  maxChars: number;
}

export interface ProtocolGuardResult {
  text: string;
  violated: boolean;
}

function zeroUsage(): PiAssistantMessage['usage'] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function normalizeToolResultText(block: ContentBlock): string {
  if (block.type !== 'tool_result') return '';
  const rawContent = (block as { content: unknown }).content;
  let text = '';
  if (typeof rawContent === 'string') {
    text = rawContent;
  } else if (Array.isArray(rawContent)) {
    text = rawContent
      .map((item) =>
        item && typeof item === 'object' && 'text' in item
          ? String((item as { text: unknown }).text ?? '')
          : ''
      )
      .filter(Boolean)
      .join('\n');
  }
  if (text.length <= MAX_HISTORICAL_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_HISTORICAL_TOOL_RESULT_CHARS)}\n[historical tool result truncated]`;
}

function containsProtocolOpener(text: string): boolean {
  const lower = text.toLocaleLowerCase();
  return TOOL_PROTOCOL_OPENERS.some((opener) => lower.includes(opener));
}

/**
 * Detects high-confidence pseudo tool calls emitted through ordinary assistant text.
 * It intentionally requires a call-like field after the opening marker so ordinary
 * prose that merely names a tag is less likely to be treated as a protocol failure.
 */
export function containsPseudoToolCallMarkup(text: string): boolean {
  if (!containsProtocolOpener(text)) return false;
  return (
    /<\s*(?:tool_use|tool_call|function_call)\b[\s\S]{0,512}?(?:\bname\s*=|["']name["']\s*:|<\s*parameter\s*=)/i.test(
      text
    ) || /<\s*(?:function|parameter)\s*=/i.test(text)
  );
}

function longestProtocolPrefixSuffix(text: string): number {
  const lower = text.toLocaleLowerCase();
  let longest = 0;
  for (const opener of TOOL_PROTOCOL_OPENERS) {
    const limit = Math.min(lower.length, opener.length - 1);
    for (let length = limit; length > longest; length--) {
      if (lower.endsWith(opener.slice(0, length))) {
        longest = length;
        break;
      }
    }
  }
  return longest;
}

function findProtocolOpener(text: string): number {
  const lower = text.toLocaleLowerCase();
  let earliest = -1;
  for (const opener of TOOL_PROTOCOL_OPENERS) {
    const index = lower.indexOf(opener);
    if (index >= 0 && (earliest < 0 || index < earliest)) earliest = index;
  }
  return earliest;
}

/**
 * Streaming guard that withholds only text beginning with a possible tool-protocol
 * marker. Normal text continues to stream without a fixed-size latency buffer.
 */
export class PseudoToolCallStreamGuard {
  private normalBuffer = '';
  private candidateBuffer = '';
  private violated = false;

  push(delta: string): ProtocolGuardResult {
    if (!delta || this.violated) return { text: '', violated: this.violated };

    if (this.candidateBuffer) {
      return this.pushCandidate(delta);
    }

    this.normalBuffer += delta;
    const openerIndex = findProtocolOpener(this.normalBuffer);
    if (openerIndex >= 0) {
      const safeText = this.normalBuffer.slice(0, openerIndex);
      this.candidateBuffer = this.normalBuffer.slice(openerIndex);
      this.normalBuffer = '';
      const candidateResult = this.evaluateCandidate();
      return {
        text: safeText + candidateResult.text,
        violated: candidateResult.violated,
      };
    }

    const pendingLength = longestProtocolPrefixSuffix(this.normalBuffer);
    const safeText = this.normalBuffer.slice(0, this.normalBuffer.length - pendingLength);
    this.normalBuffer = this.normalBuffer.slice(this.normalBuffer.length - pendingLength);
    return { text: safeText, violated: false };
  }

  flush(): ProtocolGuardResult {
    if (this.violated) return { text: '', violated: true };
    const text = this.normalBuffer + this.candidateBuffer;
    this.normalBuffer = '';
    this.candidateBuffer = '';
    if (containsPseudoToolCallMarkup(text)) {
      this.violated = true;
      return { text: '', violated: true };
    }
    return { text, violated: false };
  }

  reset(): void {
    this.normalBuffer = '';
    this.candidateBuffer = '';
    this.violated = false;
  }

  private pushCandidate(delta: string): ProtocolGuardResult {
    this.candidateBuffer += delta;
    return this.evaluateCandidate();
  }

  private evaluateCandidate(): ProtocolGuardResult {
    if (containsPseudoToolCallMarkup(this.candidateBuffer)) {
      this.violated = true;
      this.candidateBuffer = '';
      return { text: '', violated: true };
    }
    if (this.candidateBuffer.length <= MAX_PROTOCOL_CANDIDATE_LENGTH) {
      return { text: '', violated: false };
    }

    // The marker did not develop into a call-shaped payload. Release it as text
    // and resume normal scanning rather than buffering the rest of the response.
    const released = this.candidateBuffer;
    this.candidateBuffer = '';
    return { text: released, violated: false };
  }
}

function convertTurnToPiMessages(turn: Message[], options: ColdStartHistoryOptions): PiMessage[] {
  const resultPositions = new Map<string, number>();
  const toolNames = new Map<string, string>();
  for (let messageIndex = 0; messageIndex < turn.length; messageIndex++) {
    const message = turn[messageIndex];
    for (const block of message.content) {
      if (block.type === 'tool_result' && block.toolUseId) {
        resultPositions.set(block.toolUseId, messageIndex);
      }
      if (block.type === 'tool_use' && block.id) toolNames.set(block.id, block.name || 'unknown');
    }
  }

  const converted: PiMessage[] = [];
  const emittedToolCalls = new Set<string>();
  const emittedToolResults = new Set<string>();
  for (let messageIndex = 0; messageIndex < turn.length; messageIndex++) {
    const message = turn[messageIndex];
    if (message.role === 'user') {
      const text = message.content
        .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
        .map((block) => block.text)
        .filter(Boolean)
        .join('\n');
      if (text) {
        const userMessage: PiUserMessage = {
          role: 'user',
          content: text,
          timestamp: message.timestamp,
        };
        converted.push(userMessage);
      }
      continue;
    }
    if (message.role !== 'assistant') continue;

    const assistantContent: PiAssistantMessage['content'] = [];
    let addedProtocolOmissionNotice = false;
    for (const block of message.content) {
      if (block.type === 'text' && block.text) {
        if (containsPseudoToolCallMarkup(block.text)) {
          if (!addedProtocolOmissionNotice) {
            assistantContent.push({
              type: 'text',
              text: '[Previous assistant response omitted because it did not use the structured tool-call channel.]',
            });
            addedProtocolOmissionNotice = true;
          }
        } else {
          const text: PiTextContent = { type: 'text', text: block.text };
          assistantContent.push(text);
        }
      }
      if (
        block.type === 'tool_use' &&
        block.id &&
        (resultPositions.get(block.id) ?? -1) > messageIndex
      ) {
        const toolCall: PiToolCall = {
          type: 'toolCall',
          id: block.id,
          name: block.name || 'unknown',
          arguments: block.input ?? {},
        };
        assistantContent.push(toolCall);
        emittedToolCalls.add(block.id);
      }
      // Persisted reasoning has no provider signature. Replaying it as plain text
      // or unsigned thinking can violate provider contracts, so it is omitted.
    }
    if (assistantContent.length > 0) {
      const hasToolCall = assistantContent.some((block) => block.type === 'toolCall');
      const assistantMessage: PiAssistantMessage = {
        role: 'assistant',
        content: assistantContent,
        api: message.api ?? options.api,
        provider: message.provider ?? options.provider,
        model: message.model ?? options.model,
        usage: zeroUsage(),
        stopReason: hasToolCall ? 'toolUse' : 'stop',
        timestamp: message.timestamp,
      };
      converted.push(assistantMessage);
    }

    for (const block of message.content) {
      if (block.type !== 'tool_result') continue;
      if (!emittedToolCalls.has(block.toolUseId) || emittedToolResults.has(block.toolUseId))
        continue;
      const toolName = toolNames.get(block.toolUseId);
      if (!toolName) continue;
      const toolResult: PiToolResultMessage = {
        role: 'toolResult',
        toolCallId: block.toolUseId,
        toolName,
        content: [{ type: 'text', text: normalizeToolResultText(block) }],
        isError: Boolean(block.isError),
        timestamp: message.timestamp,
      };
      converted.push(toolResult);
      emittedToolResults.add(block.toolUseId);
    }
  }
  return converted;
}

function groupMessagesByUserTurn(messages: Message[]): Message[][] {
  const turns: Message[][] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      turns.push([message]);
    } else if (turns.length > 0) {
      turns[turns.length - 1].push(message);
    }
  }
  return turns;
}

/**
 * Rebuilds cold-start history as provider-neutral pi messages. Tool calls and
 * results remain in the SDK's structured channel; no control syntax is inserted
 * into the current user prompt.
 */
export function buildColdStartAgentHistory(
  messages: Message[],
  options: ColdStartHistoryOptions
): PiMessage[] {
  if (options.maxChars <= 0) return [];
  const turns = groupMessagesByUserTurn(messages);
  const selected: PiMessage[][] = [];
  let usedChars = 0;

  for (let index = turns.length - 1; index >= 0; index--) {
    const converted = convertTurnToPiMessages(turns[index], options);
    if (converted.length === 0) continue;
    const chars = JSON.stringify(converted).length;
    if (usedChars + chars > options.maxChars) break;
    selected.unshift(converted);
    usedChars += chars;
  }

  return selected.flat();
}
