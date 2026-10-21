/**
 * Best-effort skill usage log backing the 近 7 天调用 counter in Settings → Skills.
 * A skill counts as invoked when the user selects it for a run, or when the agent
 * loads its SKILL.md. Each skill is counted at most once per run.
 */
import path from 'node:path';

export interface SkillUsageSink {
  record: (entry: {
    skillName: string;
    sessionId: string | null;
    source: string;
    invokedAt: number;
  }) => void;
  countSince: (sinceMs: number) => Record<string, number>;
}

let sink: SkillUsageSink | null = null;
const countedPerRun = new Map<string, Set<string>>();

export function setSkillUsageSink(next: SkillUsageSink | null): void {
  sink = next;
}

/** Start a fresh per-run de-duplication window for a session. */
export function beginSkillUsageRun(sessionId: string): void {
  countedPerRun.set(sessionId, new Set());
}

export function recordSkillInvocation(
  skillName: string,
  sessionId: string | null,
  source: 'selected' | 'loaded',
  now = Date.now()
): boolean {
  const name = skillName.trim();
  if (!name || !sink) return false;
  if (sessionId) {
    const seen = countedPerRun.get(sessionId) ?? new Set<string>();
    countedPerRun.set(sessionId, seen);
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
  }
  sink.record({ skillName: name, sessionId, source, invokedAt: now });
  return true;
}

/** Skill directory name when a tool call reads `<skills>/<name>/SKILL.md`, else null. */
export function skillNameFromToolInput(
  toolName: string,
  input: Record<string, unknown>
): string | null {
  if (!/^(read|read_file|view)$/i.test(toolName)) return null;
  const raw = input.path ?? input.file_path ?? input.filePath;
  if (typeof raw !== 'string') return null;
  const normalized = raw.replace(/\\/g, '/');
  if (!/\/SKILL\.md$/i.test(normalized)) return null;
  const dir = path.posix.basename(path.posix.dirname(normalized));
  return dir && dir !== '.' && dir !== '/' ? dir : null;
}

export function countSkillInvocationsSince(sinceMs: number): Record<string, number> {
  return sink?.countSince(sinceMs) ?? {};
}
