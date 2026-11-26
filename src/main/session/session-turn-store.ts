import type Database from 'better-sqlite3';
import type { ContentBlock, PermissionRule } from '../../shared/contracts';
import type { PermissionPolicyId } from '../../shared/permission-policies';
import type { MessageRow } from '../db/database';
import { harnessMessage } from '../utils/harness-messages';
import type { SessionTurnOutcome } from './session-turn';
import { randomUUID } from 'node:crypto';

export interface TurnSettings {
  selectedSkillNames?: string[];
  permissionRules?: PermissionRule[];
  permissionPolicy?: PermissionPolicyId;
  modelConfigSetId?: string;
  suppressCompletionNotification?: boolean;
  denyPermissionRequests?: boolean;
}

export interface AcceptedTurn {
  turnId: string;
  sessionId: string;
  messageId: string;
  prompt: string;
  content: ContentBlock[];
  settings: TurnSettings;
  acceptedAt: number;
}

export class SessionTurnStore {
  constructor(private readonly db: Database.Database) {}

  accept(turn: AcceptedTurn, saveSession?: () => void): void {
    this.db.transaction(() => {
      saveSession?.();
      this.db
        .prepare(
          `INSERT INTO messages (id, session_id, turn_id, role, content, timestamp)
        VALUES (?, ?, ?, 'user', ?, ?)`
        )
        .run(
          turn.messageId,
          turn.sessionId,
          turn.turnId,
          JSON.stringify(turn.content),
          turn.acceptedAt
        );
      this.db
        .prepare(
          `INSERT INTO session_turns (turn_id, session_id, message_id, prompt, options_json, status)
        VALUES (?, ?, ?, ?, ?, 'queued')`
        )
        .run(
          turn.turnId,
          turn.sessionId,
          turn.messageId,
          turn.prompt,
          JSON.stringify(turn.settings)
        );
    })();
  }

  copyTurn(sourceTurnId: string, turnId: string, sessionId: string, messageId: string): void {
    this.db
      .prepare(
        `INSERT INTO session_turns (turn_id,session_id,message_id,prompt,options_json,status,error)
      SELECT ?,?,?,prompt,options_json,CASE WHEN status IN ('running','queued') THEN 'cancelled' ELSE status END,error
      FROM session_turns WHERE turn_id=?`
      )
      .run(turnId, sessionId, messageId, sourceTurnId);
  }

  claim(turnId: string): boolean {
    return (
      this.db
        .prepare("UPDATE session_turns SET status='running' WHERE turn_id=? AND status='queued'")
        .run(turnId).changes === 1
    );
  }

  finish(turnId: string, outcome: SessionTurnOutcome): void {
    this.db
      .prepare(
        `UPDATE session_turns SET status=?, error=? WHERE turn_id=? AND status IN ('running','queued')`
      )
      .run(outcome.status, outcome.status === 'failed' ? outcome.error : null, turnId);
  }

  cancelQueued(sessionId: string): void {
    this.db
      .prepare("UPDATE session_turns SET status='cancelled' WHERE session_id=? AND status='queued'")
      .run(sessionId);
  }

  historyBefore(sessionId: string, turnId: string): MessageRow[] {
    return this.db
      .prepare(
        `SELECT m.* FROM messages m LEFT JOIN session_turns t ON t.turn_id=m.turn_id
         WHERE m.session_id = ? AND (
           t.sequence IS NULL OR (
             t.sequence < (SELECT sequence FROM session_turns WHERE turn_id = ?)
             AND (t.status <> 'cancelled' OR EXISTS (
               SELECT 1 FROM messages receipt WHERE receipt.turn_id = t.turn_id AND receipt.role = 'assistant'
             ))
           )
         )
         ORDER BY COALESCE(t.sequence, 0), m.timestamp, m.rowid`
      )
      .all(sessionId, turnId) as MessageRow[];
  }

  turnMessages(turnId: string): MessageRow[] {
    return this.db
      .prepare('SELECT * FROM messages WHERE turn_id=? ORDER BY timestamp, rowid')
      .all(turnId) as MessageRow[];
  }

  updateContent(messageId: string, content: ContentBlock[]): void {
    this.db
      .prepare('UPDATE messages SET content=? WHERE id=?')
      .run(JSON.stringify(content), messageId);
  }

  recover(): AcceptedTurn[] {
    if (this.db.pragma('query_only', { simple: true })) return [];
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM session_tool_results WHERE expires_at <= ?').run(Date.now());
      const interrupted = this.db
        .prepare("SELECT session_id, turn_id FROM session_turns WHERE status='running'")
        .all() as { session_id: string; turn_id: string }[];
      for (const { session_id, turn_id } of interrupted) {
        const text = harnessMessage('interrupted');
        this.db
          .prepare("UPDATE session_turns SET status='interrupted', error=? WHERE turn_id=?")
          .run(text, turn_id);
        this.db
          .prepare(
            "INSERT INTO messages (id,session_id,turn_id,role,content,timestamp) VALUES (?,?,?,'assistant',?,?)"
          )
          .run(
            randomUUID(),
            session_id,
            turn_id,
            JSON.stringify([{ type: 'text', text }]),
            Date.now()
          );
        this.db
          .prepare(
            "UPDATE trace_steps SET status='error', is_error=1, ended_at=? WHERE session_id=? AND turn_id=? AND status='running'"
          )
          .run(Date.now(), session_id, turn_id);
      }
      this.db
        .prepare(
          "UPDATE sessions SET status='idle' WHERE status='running' AND NOT EXISTS (SELECT 1 FROM session_turns t WHERE t.session_id=sessions.id AND t.status IN ('queued','running'))"
        )
        .run();
      const rows = this.db
        .prepare(
          `SELECT t.*, m.content, m.timestamp FROM session_turns t JOIN messages m ON m.id=t.message_id
        WHERE t.status='queued' ORDER BY t.sequence`
        )
        .all() as Array<{
        session_id: string;
        turn_id: string;
        message_id: string;
        prompt: string;
        content: string;
        timestamp: number;
        options_json: string;
      }>;
      return rows.map((r) => ({
        sessionId: r.session_id,
        turnId: r.turn_id,
        messageId: r.message_id,
        prompt: r.prompt,
        acceptedAt: r.timestamp,
        content: JSON.parse(r.content) as ContentBlock[],
        settings: JSON.parse(r.options_json) as TurnSettings,
      }));
    })();
  }
}
