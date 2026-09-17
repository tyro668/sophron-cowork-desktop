/**
 * Lima instance naming.
 *
 * The app-owned Lima instance is `sophron-sandbox`. Older builds used
 * `claude-sandbox`; existing instances keep working — when `limactl list`
 * output contains only the legacy name, it is adopted for all subsequent
 * shell calls in this process instead of forcing a fresh VM.
 */
export const LIMA_INSTANCE_NAME = 'sophron-sandbox';
export const LEGACY_LIMA_INSTANCE_NAME = 'claude-sandbox';

let resolvedInstanceName: string | null = null;

export function getLimaInstanceName(): string {
  return resolvedInstanceName ?? LIMA_INSTANCE_NAME;
}

/**
 * Pick the instance name to talk to from `limactl list` output.
 * Prefers the current name; falls back to a legacy instance that already
 * exists on this machine. Call whenever instance listing output is available.
 */
export function adoptLimaInstanceName(listOutput: string): string {
  if (listOutput.includes(LIMA_INSTANCE_NAME)) {
    resolvedInstanceName = LIMA_INSTANCE_NAME;
  } else if (listOutput.includes(LEGACY_LIMA_INSTANCE_NAME)) {
    resolvedInstanceName = LEGACY_LIMA_INSTANCE_NAME;
  }
  return getLimaInstanceName();
}
