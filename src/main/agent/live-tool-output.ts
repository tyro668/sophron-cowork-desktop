import { redactTraceText } from './trace-utils';

const MAX_LIVE_OUTPUT_LINES = 200;
const MAX_LIVE_OUTPUT_CHARS = 24_000;
const ANSI_CSI_SEQUENCE = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');

export interface LiveToolOutputSnapshot {
  text: string;
  truncated: boolean;
}

/** Tool updates contain a cumulative tail, not a delta. Keep only displayable text. */
export function buildLiveToolOutputSnapshot(partialResult: unknown): LiveToolOutputSnapshot | null {
  const content =
    partialResult && typeof partialResult === 'object' && 'content' in partialResult
      ? (partialResult as { content: unknown }).content
      : partialResult;
  const parts = Array.isArray(content) ? content : [content];
  const raw = parts
    .flatMap((part) => {
      if (typeof part === 'string') return [part];
      if (
        part &&
        typeof part === 'object' &&
        'type' in part &&
        part.type === 'text' &&
        'text' in part &&
        typeof part.text === 'string'
      ) {
        return [part.text];
      }
      return [];
    })
    .join('\n');
  if (!raw) return null;

  // Strip terminal control sequences and normalize carriage-return progress output.
  const normalized = raw.replace(ANSI_CSI_SEQUENCE, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const lineTail = lines.slice(-MAX_LIVE_OUTPUT_LINES).join('\n');
  const bounded = lineTail.slice(-MAX_LIVE_OUTPUT_CHARS);
  const text = redactTraceText(bounded).trimEnd();
  if (!text) return null;

  return {
    text,
    truncated: lines.length > MAX_LIVE_OUTPUT_LINES || lineTail.length > MAX_LIVE_OUTPUT_CHARS,
  };
}
