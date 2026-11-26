import type Database from 'better-sqlite3';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_BYTE_LIMIT = 64 * 1024 * 1024;

export class SessionResultRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly sessionId: string
  ) {}

  write(ref: string, toolCallId: string, text: string, evidence: Record<string, unknown>): void {
    const metadata = JSON.stringify(evidence);
    const bytes = Buffer.byteLength(text) + Buffer.byteLength(metadata);
    this.db.transaction(() => {
      const now = Date.now();
      this.db.prepare('DELETE FROM session_tool_results WHERE expires_at <= ?').run(now);
      const used = this.db
        .prepare('SELECT COALESCE(SUM(bytes),0) FROM session_tool_results WHERE session_id=?')
        .pluck()
        .get(this.sessionId) as number;
      if (bytes + used > SESSION_BYTE_LIMIT)
        throw new Error('Session result storage limit reached');
      this.db
        .prepare(
          'INSERT INTO session_tool_results (result_ref,session_id,tool_call_id,bytes,expires_at,body,evidence_json) VALUES (?,?,?,?,?,?,?)'
        )
        .run(ref, this.sessionId, toolCallId, bytes, now + RETENTION_MS, text, metadata);
    })();
  }

  read(ref: string): { text: string; evidence: Record<string, unknown> } | undefined {
    const row = this.db
      .prepare(
        'SELECT body, evidence_json, expires_at FROM session_tool_results WHERE session_id=? AND result_ref=?'
      )
      .get(this.sessionId, ref) as
      { body: string; evidence_json: string; expires_at: number } | undefined;
    if (!row) return;
    if (row.expires_at <= Date.now()) {
      if (!this.db.pragma('query_only', { simple: true }))
        this.db
          .prepare('DELETE FROM session_tool_results WHERE session_id=? AND result_ref=?')
          .run(this.sessionId, ref);
      return;
    }
    return { text: row.body, evidence: JSON.parse(row.evidence_json) };
  }
}
