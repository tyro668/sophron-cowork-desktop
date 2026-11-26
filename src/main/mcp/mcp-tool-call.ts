import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { setTimeout as delay } from 'node:timers/promises';
import type { MCPTool } from './mcp-manager';
import { harnessMessage } from '../utils/harness-messages';
import { logCtx, logCtxError, logTiming } from '../utils/logger';
import { waitWithSignal } from '../utils/wait-with-signal';

const CALL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;

interface ToolCall {
  tool: MCPTool;
  name: string;
  args: Record<string, unknown>;
  getClient: () => Client | undefined;
  reconnect: () => Promise<boolean>;
  signal?: AbortSignal;
  toolCallId?: string;
}

function isTimeout(error: unknown): boolean {
  return (
    (error as { code?: unknown } | null)?.code === ErrorCode.RequestTimeout ||
    /timed? ?out/i.test(String(error))
  );
}

function isConnectionFailure(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    code === ErrorCode.ConnectionClosed ||
    [502, 503, 504].includes(Number(code)) ||
    /not connected|connection (closed|reset|lost)|ECONNRESET|EPIPE|fetch failed|socket hang up/i.test(
      String(error)
    )
  );
}

function unknownOutcome(tool: string, error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return harnessMessage('unknownToolOutcome', { tool, reason });
}

export async function callMcpTool(call: ToolCall): Promise<unknown> {
  const start = Date.now();
  const deadline = start + CALL_TIMEOUT_MS;
  const timeout = new AbortController();
  const timeoutError = new Error(`Tool call timeout after ${CALL_TIMEOUT_MS}ms`);
  const timer = setTimeout(() => timeout.abort(timeoutError), CALL_TIMEOUT_MS);
  const signal = call.signal ? AbortSignal.any([call.signal, timeout.signal]) : timeout.signal;
  let hotReloadTried = false;

  logCtx(`[MCPManager] Calling ${call.name} on ${call.tool.serverName}`);
  try {
    for (let attempt = 1; ; attempt++) {
      signal.throwIfAborted();
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw timeoutError;
      const client = call.getClient();
      try {
        if (!client) throw new Error(`MCP server not connected: ${call.tool.serverId}`);
        const result = await waitWithSignal(
          client.callTool(
            {
              name: call.name,
              arguments: call.args,
              ...(call.toolCallId && { _meta: { 'sophron/tool-call-id': call.toolCallId } }),
            },
            undefined,
            {
              signal,
              timeout: remaining,
            }
          ),
          signal
        );
        const message = extractStructuredToolErrorMessage(result);
        if (isReconnectableErrorText(message)) {
          if (call.tool.readOnly) throw new Error(message);
          return {
            ...result,
            isError: true,
            content: [
              ...(Array.isArray(result.content) ? result.content : []),
              { type: 'text', text: unknownOutcome(call.name, message) },
            ],
          };
        }
        if (
          call.tool.readOnly &&
          !hotReloadTried &&
          attempt < MAX_ATTEMPTS &&
          shouldHotReloadGuiVisionServer(call.tool.serverName, call.name, message)
        ) {
          hotReloadTried = true;
          signal.throwIfAborted();
          if (await waitWithSignal(call.reconnect(), signal)) continue;
        }
        return result;
      } catch (error) {
        // A rejected client request has no receipt. Replaying a write can commit it twice.
        if (client && !call.tool.readOnly)
          throw new Error(unknownOutcome(call.name, error), { cause: error });
        signal.throwIfAborted();
        if (attempt >= MAX_ATTEMPTS) throw error;
        if (isConnectionFailure(error)) {
          if (await waitWithSignal(call.reconnect(), signal)) continue;
        } else if (!isTimeout(error)) {
          throw error;
        }
        try {
          await delay(2000 * attempt, undefined, { signal });
        } catch (error) {
          signal.throwIfAborted();
          throw error;
        }
      }
    }
  } catch (error) {
    logCtxError(
      `[MCPManager] Calling ${call.name} failed on ${call.tool.serverName}`,
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  } finally {
    clearTimeout(timer);
    logTiming(`MCP tool ${call.name}`, start);
  }
}

function extractStructuredToolErrorMessage(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return '';
  }

  const topLevelIsError = (result as { isError?: unknown }).isError === true;
  const resultObj = result as { content?: unknown };
  const content = Array.isArray(resultObj.content) ? resultObj.content : [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    if ((item as { type?: string }).type !== 'text') continue;
    const text = (item as { text?: unknown }).text;
    if (typeof text !== 'string') continue;

    const trimmed = text.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
        if (parsed.error === true && typeof parsed.message === 'string' && parsed.message.trim()) {
          return parsed.message.trim();
        }
      } catch {
        // Ignore malformed JSON payloads
      }
    }

    if (topLevelIsError && isReconnectableErrorText(trimmed)) {
      return trimmed;
    }
  }

  return '';
}

function isReconnectableErrorText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized === 'not connected' ||
    normalized.includes('mcp server not connected') ||
    normalized.includes('connection closed')
  );
}

function shouldHotReloadGuiVisionServer(
  serverName: string,
  actualToolName: string,
  errorMessage: string
): boolean {
  if (!errorMessage) {
    return false;
  }
  if (actualToolName !== 'gui_verify_vision') {
    return false;
  }
  if (!serverName.toLowerCase().includes('gui')) {
    return false;
  }

  return (
    errorMessage.includes('Unsupported parameter: max_output_tokens') ||
    errorMessage.includes('Instructions are required') ||
    errorMessage.includes('Stream must be set to true')
  );
}
