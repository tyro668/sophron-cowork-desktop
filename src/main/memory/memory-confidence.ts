import type { MemoryConfidenceSignals, MemoryConfidenceSourceType } from './memory-types';

const CONFIDENCE_CALCULATION_VERSION = 1;

const SOURCE_BASE: Record<MemoryConfidenceSourceType, number> = {
  explicit_user_statement: 0.9,
  conversation_summary: 0.68,
  llm_inference: 0.55,
  manual_edit: 0.95,
};

export function normalizeConfidence(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return clamp01(value);
}

export function normalizeConfidenceSourceType(value: unknown): MemoryConfidenceSourceType | null {
  if (
    value === 'explicit_user_statement' ||
    value === 'conversation_summary' ||
    value === 'llm_inference' ||
    value === 'manual_edit'
  ) {
    return value;
  }
  return null;
}

export function normalizeConfidenceSignals(value: unknown): MemoryConfidenceSignals | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const source = value as Record<string, unknown>;
  const sourceType = normalizeConfidenceSourceType(source.sourceType ?? source.source_type);
  const extractionConfidence = normalizeConfidence(
    source.extractionConfidence ?? source.extraction_confidence
  );
  if (!sourceType || extractionConfidence === null) {
    return null;
  }
  return {
    sourceType,
    extractionConfidence,
    evidenceCount: normalizeCount(source.evidenceCount ?? source.evidence_count),
    corroborationCount: normalizeCount(source.corroborationCount ?? source.corroboration_count),
    contradictionCount: normalizeCount(source.contradictionCount ?? source.contradiction_count),
    userVerified:
      typeof source.userVerified === 'boolean'
        ? source.userVerified
        : typeof source.user_verified === 'boolean'
          ? source.user_verified
          : false,
    lastVerifiedAt:
      typeof source.lastVerifiedAt === 'string'
        ? source.lastVerifiedAt
        : typeof source.last_verified_at === 'string'
          ? source.last_verified_at
          : undefined,
    calculationVersion:
      normalizeCount(source.calculationVersion ?? source.calculation_version) ||
      CONFIDENCE_CALCULATION_VERSION,
    reason:
      typeof source.reason === 'string' && source.reason.trim()
        ? source.reason.trim()
        : undefined,
  };
}

export function confidenceSignalsToFileRecord(
  signals: MemoryConfidenceSignals
): Record<string, unknown> {
  return {
    source_type: signals.sourceType,
    extraction_confidence: signals.extractionConfidence,
    evidence_count: signals.evidenceCount,
    corroboration_count: signals.corroborationCount,
    contradiction_count: signals.contradictionCount,
    user_verified: signals.userVerified,
    last_verified_at: signals.lastVerifiedAt ?? '',
    calculation_version: signals.calculationVersion,
    reason: signals.reason ?? '',
  };
}

export function buildConfidenceSignals(input: {
  sourceType: MemoryConfidenceSourceType;
  extractionConfidence: number;
  evidenceCount?: number;
  corroborationCount?: number;
  contradictionCount?: number;
  userVerified?: boolean;
  lastVerifiedAt?: string;
  reason?: string;
}): MemoryConfidenceSignals {
  const extractionConfidence = normalizeConfidence(input.extractionConfidence);
  if (extractionConfidence === null) {
    throw new Error('memory.invalidConfidenceSignals');
  }
  return {
    sourceType: input.sourceType,
    extractionConfidence,
    evidenceCount: input.evidenceCount ?? 0,
    corroborationCount: input.corroborationCount ?? 0,
    contradictionCount: input.contradictionCount ?? 0,
    userVerified: input.userVerified ?? false,
    lastVerifiedAt: input.lastVerifiedAt,
    calculationVersion: CONFIDENCE_CALCULATION_VERSION,
    reason: input.reason,
  };
}

export function calculateMemoryConfidence(signals: MemoryConfidenceSignals): number {
  const sourceBase = SOURCE_BASE[signals.sourceType];
  const evidenceScore = Math.min(1, signals.evidenceCount / 3);
  const corroborationScore = Math.min(1, signals.corroborationCount / 3);
  const contradictionPenalty = Math.min(1, signals.contradictionCount / 2);
  const userVerifiedBoost = signals.userVerified ? 0.2 : 0;
  return clamp01(
    sourceBase * 0.45 +
      clamp01(signals.extractionConfidence) * 0.25 +
      evidenceScore * 0.15 +
      corroborationScore * 0.1 -
      contradictionPenalty * 0.2 +
      userVerifiedBoost
  );
}

export function mergeConfidenceSignals(
  existing: MemoryConfidenceSignals | undefined,
  incoming: MemoryConfidenceSignals
): MemoryConfidenceSignals {
  if (!existing) {
    return incoming;
  }
  return {
    ...incoming,
    evidenceCount: Math.max(existing.evidenceCount, incoming.evidenceCount),
    corroborationCount: Math.max(existing.corroborationCount + 1, incoming.corroborationCount),
    contradictionCount: Math.max(existing.contradictionCount, incoming.contradictionCount),
    userVerified: existing.userVerified || incoming.userVerified,
    lastVerifiedAt: incoming.lastVerifiedAt ?? existing.lastVerifiedAt,
  };
}

function normalizeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
