/**
 * One-time / quick-fix rewrite of removed `case … when … end` conditionals into the only
 * supported form `if … then … elseif … else … end` (simple case → `[x] = v` chains).
 * Works on jflow text and on operator-config expressions (same expression syntax).
 */
import { applyJflowFix } from './window-rewrite';
import { parseJflow, parseJflowExpr, parseJflowSteps } from './parse';
import type { JflowDiagnostic } from './ast';

const CASE_WORD = /\bcase\b/i;

/** Lower-case SQL-style upper-case keywords outside strings and [fields]. */
function lowerConditionalKeywords(text: string): string {
  return text.replace(
    /'(?:[^']|'')*'|\[(?:[^\]]|\]\])*\]|\b(CASE|WHEN|THEN|ELSE|END|AND|OR|NOT|IN|IS|NULL)\b/gi,
    (m, kw) => (kw ? m.toLowerCase() : m)
  );
}

function applyCaseFixes(text: string, diagnostics: JflowDiagnostic[]): string | null {
  const fixes = diagnostics
    .filter((d) => d.code === 'E_CASE_REMOVED' && d.fix)
    .map((d) => d.fix!)
    .sort((a, b) => b.span.start - a.span.start);
  if (fixes.length === 0) return null;
  let out = text;
  for (const fix of fixes) out = applyJflowFix(out, fix);
  return out;
}

/** Rewrite an expression; null when it has no case (or cannot be parsed even after rewriting). */
export function rewriteCaseExpression(text: string): string | null {
  if (!CASE_WORD.test(text)) return null;
  for (const candidate of [text, lowerConditionalKeywords(text)]) {
    const r = parseJflowExpr(candidate);
    const fixed = applyCaseFixes(candidate, r.diagnostics);
    if (fixed !== null && parseJflowExpr(fixed).ast) return fixed;
  }
  return null;
}

/** Rewrite every case in a jflow document (or step list); null when nothing changed. */
export function rewriteCaseInJflow(text: string): string | null {
  if (!CASE_WORD.test(text)) return null;
  let current = text;
  // Parse errors stop at the first problem, so iterate until no E_CASE_REMOVED remains.
  for (let i = 0; i < 50; i++) {
    const file = parseJflow(current);
    const fixed =
      applyCaseFixes(current, file.diagnostics) ??
      applyCaseFixes(current, parseJflowSteps(current).diagnostics);
    if (fixed === null) break;
    current = fixed;
  }
  return current === text ? null : current;
}
