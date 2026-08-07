import { randomUUID } from 'crypto';
import type {
  AnalyzeTaskRequirementResult,
  GenerateTaskFromRequirementResult,
} from './data-command-types';

const DEFAULT_RECEIPT_TTL_MS = 30 * 60 * 1000;

export interface RequirementAnalysisReceipt {
  id: string;
  sessionId: string;
  sourceUserMessageId?: string;
  inputTableId: string;
  inputTableName: string;
  inputSchemaHash: string;
  processRequirement: string;
  analysis: AnalyzeTaskRequirementResult;
  capabilityProfileVersion: string;
  createdAt: number;
  expiresAt: number;
  generatedResult?: GenerateTaskFromRequirementResult;
}

export interface RequirementAnalysisReceiptStoreOptions {
  now?: () => number;
  ttlMs?: number;
}

/**
 * Conversation-scoped, short-lived analysis receipts used to enforce the
 * analyze -> user confirmation -> generate boundary without exposing model or
 * capability internals in tool arguments.
 */
export class RequirementAnalysisReceiptStore {
  private readonly receipts = new Map<string, RequirementAnalysisReceipt>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: RequirementAnalysisReceiptStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? DEFAULT_RECEIPT_TTL_MS;
  }

  create(
    input: Omit<RequirementAnalysisReceipt, 'id' | 'createdAt' | 'expiresAt' | 'generatedResult'>
  ): RequirementAnalysisReceipt {
    this.deleteExpired();
    const createdAt = this.now();
    const receipt: RequirementAnalysisReceipt = {
      ...input,
      id: randomUUID(),
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    };
    this.receipts.set(receipt.id, receipt);
    return receipt;
  }

  get(id: string): RequirementAnalysisReceipt | null {
    const receipt = this.receipts.get(id);
    if (!receipt) return null;
    if (receipt.expiresAt <= this.now()) {
      this.receipts.delete(id);
      return null;
    }
    return receipt;
  }

  saveGeneratedResult(
    id: string,
    result: GenerateTaskFromRequirementResult
  ): RequirementAnalysisReceipt | null {
    const receipt = this.get(id);
    if (!receipt) return null;
    const updated = { ...receipt, generatedResult: result };
    this.receipts.set(id, updated);
    return updated;
  }

  deleteExpired(): void {
    const now = this.now();
    for (const [id, receipt] of this.receipts) {
      if (receipt.expiresAt <= now) this.receipts.delete(id);
    }
  }

  deleteForSession(sessionId: string): void {
    for (const [id, receipt] of this.receipts) {
      if (receipt.sessionId === sessionId) this.receipts.delete(id);
    }
  }
}
