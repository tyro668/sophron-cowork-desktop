import { PostgreSQL } from '@codemirror/lang-sql';
import type { Tree } from '@lezer/common';
import { normalizeSqlQuery } from '@/shared/sql-query';

export type SqlValidationResult = 'ok' | 'invalid' | 'syntax';

/**
 * The lezer SQL tokenizer only accepts ASCII letters in bare identifiers, so a
 * valid DuckDB query like `SELECT 省, SUM(金额) FROM input` used to light up as
 * syntax errors. Replace every non-ASCII letter / digit / mark with `x`
 * (same UTF-16 length, so positions map 1:1) before parsing. Non-ASCII
 * punctuation such as a full-width comma is left alone and still reported.
 */
export function sanitizeSqlIdentifiers(text: string): string {
  return text.replace(/\P{ASCII}/gu, (ch) =>
    /[\p{L}\p{N}\p{M}]/u.test(ch) ? 'x'.repeat(ch.length) : ch
  );
}

export function parseSqlForLint(text: string): Tree {
  return PostgreSQL.language.parser.parse(sanitizeSqlIdentifiers(text));
}

export function findSqlSyntaxErrors(text: string): Array<{ from: number; to: number }> {
  const errors: Array<{ from: number; to: number }> = [];
  parseSqlForLint(text)
    .cursor()
    .iterate((node) => {
      if (node.type.isError) {
        errors.push({
          from: node.from,
          to: Math.min(text.length, Math.max(node.to, node.from + 1)),
        });
      }
    });
  return errors;
}

export function validateSqlText(text: string): SqlValidationResult {
  try {
    normalizeSqlQuery(text);
  } catch {
    return 'invalid';
  }
  return findSqlSyntaxErrors(text).length > 0 ? 'syntax' : 'ok';
}
