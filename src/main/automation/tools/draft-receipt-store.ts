import { randomUUID } from 'crypto';
import type { Automation } from '../../../shared/automation/types';
import type { PreparedAutomationDraft, PreparedAutomationScheduleUpdateDraft } from './contract';

const DEFAULT_RECEIPT_TTL_MS = 30 * 60 * 1000;

export interface AutomationDraftReceipt extends PreparedAutomationDraft {
  id: string;
  sessionId: string;
  sourceUserMessageId?: string;
  createdAt: number;
  expiresAt: number;
  createdAutomationId?: string;
}

export interface AutomationScheduleUpdateDraftReceipt extends PreparedAutomationScheduleUpdateDraft {
  id: string;
  sessionId: string;
  sourceUserMessageId?: string;
  createdAt: number;
  expiresAt: number;
  updatedAutomation?: Automation;
}

export interface AutomationDraftReceiptStoreOptions {
  now?: () => number;
  ttlMs?: number;
}

export class AutomationDraftReceiptStore {
  private readonly receipts = new Map<string, AutomationDraftReceipt>();
  private readonly scheduleUpdateReceipts = new Map<string, AutomationScheduleUpdateDraftReceipt>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: AutomationDraftReceiptStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? DEFAULT_RECEIPT_TTL_MS;
  }

  create(
    input: PreparedAutomationDraft & { sessionId: string; sourceUserMessageId?: string }
  ): AutomationDraftReceipt {
    this.deleteExpired();
    const createdAt = this.now();
    const receipt: AutomationDraftReceipt = {
      ...input,
      id: randomUUID(),
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    };
    this.receipts.set(receipt.id, receipt);
    return receipt;
  }

  get(id: string): AutomationDraftReceipt | null {
    const receipt = this.receipts.get(id);
    if (!receipt) return null;
    if (receipt.expiresAt <= this.now()) {
      this.receipts.delete(id);
      return null;
    }
    return receipt;
  }

  markCreated(id: string, automationId: string): AutomationDraftReceipt | null {
    const receipt = this.get(id);
    if (!receipt) return null;
    const updated = { ...receipt, createdAutomationId: automationId };
    this.receipts.set(id, updated);
    return updated;
  }

  createScheduleUpdate(
    input: PreparedAutomationScheduleUpdateDraft & {
      sessionId: string;
      sourceUserMessageId?: string;
    }
  ): AutomationScheduleUpdateDraftReceipt {
    this.deleteExpired();
    const createdAt = this.now();
    const receipt: AutomationScheduleUpdateDraftReceipt = {
      ...input,
      id: randomUUID(),
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    };
    this.scheduleUpdateReceipts.set(receipt.id, receipt);
    return receipt;
  }

  getScheduleUpdate(id: string): AutomationScheduleUpdateDraftReceipt | null {
    const receipt = this.scheduleUpdateReceipts.get(id);
    if (!receipt) return null;
    if (receipt.expiresAt <= this.now()) {
      this.scheduleUpdateReceipts.delete(id);
      return null;
    }
    return receipt;
  }

  markScheduleUpdated(
    id: string,
    automation: Automation
  ): AutomationScheduleUpdateDraftReceipt | null {
    const receipt = this.getScheduleUpdate(id);
    if (!receipt) return null;
    const updated = { ...receipt, updatedAutomation: automation };
    this.scheduleUpdateReceipts.set(id, updated);
    return updated;
  }

  /** Uncommitted drafts keep the automation domain active for follow-up turns. */
  hasPendingForSession(sessionId: string): boolean {
    this.deleteExpired();
    for (const receipt of this.receipts.values()) {
      if (receipt.sessionId === sessionId && !receipt.createdAutomationId) return true;
    }
    for (const receipt of this.scheduleUpdateReceipts.values()) {
      if (receipt.sessionId === sessionId && !receipt.updatedAutomation) return true;
    }
    return false;
  }

  deleteExpired(): void {
    const now = this.now();
    for (const [id, receipt] of this.receipts) {
      if (receipt.expiresAt <= now) this.receipts.delete(id);
    }
    for (const [id, receipt] of this.scheduleUpdateReceipts) {
      if (receipt.expiresAt <= now) this.scheduleUpdateReceipts.delete(id);
    }
  }

  deleteForSession(sessionId: string): void {
    for (const [id, receipt] of this.receipts) {
      if (receipt.sessionId === sessionId) this.receipts.delete(id);
    }
    for (const [id, receipt] of this.scheduleUpdateReceipts) {
      if (receipt.sessionId === sessionId) this.scheduleUpdateReceipts.delete(id);
    }
  }
}
