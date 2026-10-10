/**
 * Turns a raw run error (IPC wrapper + DuckDB Binder/Parser text + the
 * executor's "Workflow node <id> (<type>) failed:" prefix) into a structured
 * shape the UI can localize: which node, which field, what line, what the
 * engine suggested — with the untouched message kept for technical details.
 */
export interface ParsedRunError {
  /** Short user-facing summary with wrappers stripped. */
  headline: string;
  /** Engine error class when recognizable (Binder/Parser/Catalog/…). */
  kind?: string;
  nodeId?: string;
  nodeType?: string;
  /** Referenced-but-missing column ("Referenced column …"). */
  missingField?: string;
  /** Fields DuckDB offered as alternatives ("Candidate columns: …"). */
  candidateFields: string[];
  /** DuckDB's own "Did you mean" suggestion when present. */
  suggestion?: string;
  /** 1-based line number from "LINE n:" position info. */
  line?: number;
  /** Original untouched message for the technical-details disclosure. */
  raw: string;
}

const NODE_WRAPPER_RE =
  /Workflow node (\S+) \((\w+)\)(?:\s+in generated helper (\S+))?\s*failed:\s*/;
const IPC_WRAPPER_RE = /^Error invoking remote method '[^']+':\s*/;
const ERROR_PREFIX_RE =
  /^(?:Error:\s*)?((?:Binder|Parser|Catalog|Constraint|Conversion|Executor|Internal|Out of Range|Serialization|Transaction|Type|Interrupt|Fatal|Invalid Input|Not Implemented|Permission) Error):\s*/;
const MISSING_FIELD_RE = /Referenced column "([^"]+)" not found/i;
const CANDIDATE_COLUMNS_RE = /Candidate columns:\s*(.+?)(?:\n|$)/is;
const QUOTED_TOKEN_RE = /"([^"]+)"/g;
const DID_YOU_MEAN_RE = /Did you mean "([^"]+)"\??/i;
const LINE_RE = /LINE\s+(\d+)/i;

function stripPositionBlock(message: string): string {
  // DuckDB appends a "\nLINE n: …\n    ^" block — drop it from the headline.
  return message.replace(/\n?LINE\s+\d+:[\s\S]*$/i, '').trim();
}

export function parseWorkflowRunError(raw: string): ParsedRunError {
  // Prefixes layer up ("Error: Error invoking remote method 'x': Error: …"),
  // so peel them until the message no longer starts with one.
  let message = raw.trim();
  for (;;) {
    const next = message.replace(IPC_WRAPPER_RE, '').replace(/^Error:\s*/, '');
    if (next === message) break;
    message = next;
  }
  const parsed: ParsedRunError = { headline: message, candidateFields: [], raw };

  const nodeMatch = NODE_WRAPPER_RE.exec(message);
  if (nodeMatch) {
    parsed.nodeId = nodeMatch[1];
    parsed.nodeType = nodeMatch[2];
    message = message.replace(NODE_WRAPPER_RE, '').trim();
  }

  const kindMatch = ERROR_PREFIX_RE.exec(message);
  if (kindMatch) {
    parsed.kind = kindMatch[1].replace(/ Error$/, '');
    message = message.slice(kindMatch[0].length).trim();
  }

  const missing = MISSING_FIELD_RE.exec(message);
  if (missing) parsed.missingField = missing[1];

  const candidates = CANDIDATE_COLUMNS_RE.exec(message);
  if (candidates) {
    parsed.candidateFields = [...candidates[1].matchAll(QUOTED_TOKEN_RE)].map((m) => m[1]);
    // Candidate lists are engine detail, not headline text.
    message = message.replace(candidates[0], '').trim();
  }

  const suggestion = DID_YOU_MEAN_RE.exec(message) ?? DID_YOU_MEAN_RE.exec(raw);
  if (suggestion) {
    parsed.suggestion = suggestion[1];
    message = message.replace(suggestion[0], '').trim();
  }

  const line = LINE_RE.exec(raw);
  if (line) parsed.line = Number(line[1]);

  parsed.headline = stripPositionBlock(message);
  return parsed;
}

/**
 * Closest matching field name for a did-you-mean hint: case-insensitive
 * equality first, then small Levenshtein distance (covers quote/case slips
 * and one-or-two-char typos without false positives on unrelated fields).
 */
export function closestFieldName(field: string, candidates: string[]): string | null {
  if (!field || candidates.length === 0) return null;
  const lower = field.toLowerCase();
  const exact = candidates.find((c) => c.toLowerCase() === lower);
  if (exact) return exact === field ? null : exact;
  let best: { name: string; distance: number } | null = null;
  for (const candidate of candidates) {
    const distance = levenshtein(lower, candidate.toLowerCase());
    if (distance > 0 && distance <= 2 && (!best || distance < best.distance)) {
      best = { name: candidate, distance };
    }
  }
  return best?.name ?? null;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length];
}
