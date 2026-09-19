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

  pendingKindsForSession(sessionId: string): Array<'create' | 'update'> {
    this.deleteExpired();
    const kinds: Array<'create' | 'update'> = [];
    if (
      [...this.receipts.values()].some(
        (receipt) => receipt.sessionId === sessionId && !receipt.createdAutomationId
      )
    )
      kinds.push('create');
    if (
      [...this.scheduleUpdateReceipts.values()].some(
        (receipt) => receipt.sessionId === sessionId && !receipt.updatedAutomation
      )
    )
      kinds.push('update');
    return kinds;
  }

  hasPendingForSession(sessionId: string): boolean {
    return this.pendingKindsForSession(sessionId).length > 0;
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
