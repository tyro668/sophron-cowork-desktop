/**
 * Source fingerprint for incremental watermarks (jflow v4 §11.5).
 *
 * A watermark is only valid for the source it was read from. The fingerprint covers the
 * resource identity (URI), the read options and the incremental column; lookback is not part
 * of it. Changing any of them invalidates the stored watermark (W_WATERMARK_RESET).
 */
import { createHash } from 'crypto';

const READ_OPTION_KEYS = [
  'sheet',
  'sheetName',
  'range',
  'headerRow',
  'header_row',
  'encoding',
  'delimiter',
  'sourceParams',
] as const;

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Canonical URI of an input node's resource. */
export function inputSourceUri(config: Record<string, unknown>, sourcePath: string | null): string {
  const rawTableId = stringValue(config.rawTableId);
  const source = stringValue(config.source) || (rawTableId ? 'rawTable' : 'pipeline');
  if (source === 'rawTable') return `local:raw/${rawTableId}`;
  if (source === 'file') return `file:${stringValue(config.filePath)}`;
  return `local:pipeline-source/${sourcePath ?? ''}`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

export function inputSourceFingerprint(
  config: Record<string, unknown>,
  sourcePath: string | null
): string {
  const read: Record<string, unknown> = {};
  for (const key of READ_OPTION_KEYS) {
    if (config[key] !== undefined && config[key] !== null && config[key] !== '') {
      read[key] = config[key];
    }
  }
  const payload = canonical({
    uri: inputSourceUri(config, sourcePath),
    read,
    incremental: { field: stringValue(config.incrementalBy) },
  });
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
