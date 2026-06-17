import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ContentBlock, Message } from '../../renderer/types';
import memorySearchLexicon from './memory-search-lexicon.json';
import type {
  AppliedCoreMemoryAction,
  CoreMemoryActionInput,
  CoreMemoryCategory,
  CoreMemoryEntry,
  MemoryTranscriptTurn,
} from './memory-types';

type SearchTokenKind = 'en' | 'zh' | 'code' | 'number';

export interface SearchToken {
  text: string;
  kind: SearchTokenKind;
  weight: number;
}

interface EnglishNormalizationRule {
  suffix: string;
  replacement: string;
  minLength: number;
  trimDoubleConsonant?: boolean;
}

interface MemorySearchLexicon {
  stopWords: {
    en: string[];
    zh: string[];
  };
  domainTerms: {
    en: string[];
    zh: string[];
  };
  weights: {
    default: number;
    en: number;
    zh: number;
    code: number;
    number: number;
    domain: number;
    phraseBonus: number;
    lengthBoostMax: number;
  };
  englishNormalization: {
    overrides: Record<string, string>;
    suffixRules: EnglishNormalizationRule[];
  };
}

type SegmenterSegment = {
  segment: string;
  isWordLike?: boolean;
};

type WordSegmenter = {
  segment(input: string): Iterable<SegmenterSegment>;
};

type SegmenterConstructor = new (
  locale?: string | string[],
  options?: { granularity?: 'grapheme' | 'word' | 'sentence' }
) => WordSegmenter;

const SEARCH_LEXICON = memorySearchLexicon as MemorySearchLexicon;
const EN_STOP_WORDS = new Set(SEARCH_LEXICON.stopWords.en.map((word) => word.toLowerCase()));
const ZH_STOP_WORDS = new Set(SEARCH_LEXICON.stopWords.zh);
const EN_DOMAIN_TERMS = new Set(SEARCH_LEXICON.domainTerms.en.map((word) => word.toLowerCase()));
const ZH_DOMAIN_TERMS = new Set(SEARCH_LEXICON.domainTerms.zh);
const SEGMENTERS = new Map<string, WordSegmenter | null>();
const CORE_CATEGORIES = new Set<CoreMemoryCategory>([
  'identity',
  'preferences',
  'skills',
  'interests',
]);

export function normalizeWorkspaceKey(cwd?: string | null): string | null {
  if (!cwd) {
    return null;
  }
  try {
    return path.resolve(cwd);
  } catch {
    return cwd;
  }
}

export function hashWorkspaceKey(workspaceKey: string): string {
  return crypto.createHash('sha1').update(workspaceKey).digest('hex').slice(0, 16);
}

export function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

export function loadJsonFile<T>(filePath: string, defaultValue: T): T {
  if (!fs.existsSync(filePath)) {
    return defaultValue;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) {
      return defaultValue;
    }
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

export function saveJsonFile(filePath: string, data: unknown): void {
  ensureParentDir(filePath);
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

export function safeRemoveFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function isoNow(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 19);
}

export function extractJson(rawText: string): unknown {
  const text = rawText.trim();
  if (!text) {
    return null;
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const match = candidate.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }
}

export function extractTextFromContent(content: ContentBlock[]): string {
  return content
    .map((block) => {
      switch (block.type) {
        case 'text':
          return block.text;
        case 'thinking':
          return block.thinking;
        case 'tool_result':
          return block.content;
        case 'tool_use':
          return `${block.name} ${JSON.stringify(block.input)}`;
        case 'file_attachment':
          return `[file] ${block.filename}`;
        case 'cloud_table_attachment':
          return block.tables
            .map((table) => `[cloud table] ${table.tableName}`)
            .filter(Boolean)
            .join('\n');
        case 'image':
          return '[image]';
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function messagesToTranscript(messages: Message[]): MemoryTranscriptTurn[] {
  return messages
    .map((message): MemoryTranscriptTurn | null => {
      const content = extractTextFromContent(message.content);
      if (!content) {
        return null;
      }
      return {
        role: message.role,
        content,
        messageId: message.id,
        timestamp: message.timestamp,
      };
    })
    .filter((item): item is MemoryTranscriptTurn => Boolean(item));
}

export function compactTranscript(turns: MemoryTranscriptTurn[]): string {
  return turns.map((turn) => `${turn.role}: ${turn.content.trim()}`).join('\n');
}

export function summarizeText(text: string, maxLength = 220): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function tokenizeSearchQuery(query: string): string[] {
  return Array.from(new Set(simpleTokenize(query))).slice(0, 16);
}

export function simpleTokenize(text: string): string[] {
  return tokenizeSearchText(text).map((token) => token.text);
}

export function tokenizeSearchText(text: string): SearchToken[] {
  const normalized = text.normalize('NFKC');
  const tokens: SearchToken[] = [];

  for (const match of normalized.matchAll(/[A-Za-z][A-Za-z0-9_.-]{1,}|[0-9]+(?:\.[0-9]+)?/g)) {
    appendUnique(tokens, tokenizeCodeLikeToken(match[0]));
  }

  for (const match of normalized.matchAll(/[\u4e00-\u9fff]+/g)) {
    appendUnique(tokens, tokenizeChineseRun(match[0]));
  }

  return tokens;
}

export function lexicalScore(query: string, text: string): number {
  const queryTerms = buildWeightedTermMap(tokenizeSearchText(query));
  const itemTerms = buildWeightedTermMap(tokenizeSearchText(text));
  if (!queryTerms.size || !itemTerms.size) {
    return 0;
  }
  let overlap = 0;
  let queryNorm = 0;
  let itemNorm = 0;
  for (const value of queryTerms.values()) {
    queryNorm += value * value;
  }
  for (const value of itemTerms.values()) {
    itemNorm += value * value;
  }
  for (const [term, queryWeight] of queryTerms.entries()) {
    overlap += Math.min(queryWeight, itemTerms.get(term) || 0);
  }
  const baseScore = overlap / Math.sqrt(queryNorm * Math.max(itemNorm, 1));
  const phraseBonus = hasPhraseMatch(query, text) ? SEARCH_LEXICON.weights.phraseBonus : 0;
  return Math.min(1, baseScore + phraseBonus);
}

function tokenizeCodeLikeToken(rawToken: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  const rawParts = rawToken.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const compact = rawToken.replace(/[^A-Za-z0-9]+/g, '');
  const sourceParts = compact && compact !== rawParts.join('') ? [...rawParts, compact] : rawParts;

  for (const part of sourceParts) {
    if (/^\d+(?:\.\d+)?$/.test(part)) {
      appendSearchToken(tokens, part, 'number');
      continue;
    }
    const normalized = normalizeEnglishToken(part);
    appendSearchToken(tokens, normalized, part === rawToken ? 'en' : 'code');
    for (const splitPart of splitIdentifierParts(part)) {
      appendSearchToken(tokens, normalizeEnglishToken(splitPart), 'code');
    }
  }

  return tokens;
}

function tokenizeChineseRun(run: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  for (const term of ZH_DOMAIN_TERMS) {
    if (run.includes(term)) {
      appendSearchToken(tokens, term, 'zh');
    }
  }

  const segmentedTokens = tokenizeChineseWithSegmenter(run);
  if (segmentedTokens.length > 0) {
    appendUnique(tokens, segmentedTokens);
    return tokens;
  }

  appendUnique(tokens, tokenizeChineseNgrams(run));
  return tokens;
}

function tokenizeChineseWithSegmenter(run: string): SearchToken[] {
  const segmenter = getWordSegmenter('zh');
  if (!segmenter) {
    return [];
  }

  const tokens: SearchToken[] = [];
  for (const part of segmenter.segment(run)) {
    if (part.isWordLike === false) {
      continue;
    }
    appendSearchToken(tokens, part.segment, 'zh');
  }
  return tokens;
}

function tokenizeChineseNgrams(run: string): SearchToken[] {
  const chars = Array.from(run);
  const tokens: SearchToken[] = [];
  for (const size of [2, 3, 4]) {
    if (chars.length < size) {
      continue;
    }
    for (let index = 0; index <= chars.length - size; index += 1) {
      appendSearchToken(tokens, chars.slice(index, index + size).join(''), 'zh');
    }
  }
  return tokens;
}

function appendUnique(target: SearchToken[], source: SearchToken[]): void {
  const seen = new Set<string>();
  for (const token of source) {
    if (seen.has(token.text)) {
      continue;
    }
    seen.add(token.text);
    target.push(token);
  }
}

function appendSearchToken(target: SearchToken[], text: string, kind: SearchTokenKind): void {
  const normalized = normalizeTokenText(text, kind);
  if (!normalized || isStopToken(normalized, kind)) {
    return;
  }
  target.push({
    text: normalized,
    kind,
    weight: getTokenWeight(normalized, kind),
  });
}

function normalizeTokenText(text: string, kind: SearchTokenKind): string {
  const normalized = text.normalize('NFKC').trim();
  if (!normalized) {
    return '';
  }
  if (kind === 'zh') {
    return Array.from(normalized).length >= 2 ? normalized : '';
  }
  if (kind === 'number') {
    return normalized;
  }
  const lower = normalized.toLowerCase();
  return lower.length >= 2 ? lower : '';
}

function normalizeEnglishToken(token: string): string {
  const lower = token.normalize('NFKC').toLowerCase();
  const override = SEARCH_LEXICON.englishNormalization.overrides[lower];
  if (override) {
    return override;
  }
  for (const rule of SEARCH_LEXICON.englishNormalization.suffixRules) {
    if (lower.length < rule.minLength || !lower.endsWith(rule.suffix)) {
      continue;
    }
    let stem = `${lower.slice(0, -rule.suffix.length)}${rule.replacement}`;
    if (rule.trimDoubleConsonant && hasTrailingDoubleConsonant(stem)) {
      stem = stem.slice(0, -1);
    }
    return stem;
  }
  return lower;
}

function splitIdentifierParts(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+|\s+/)
    .filter((part) => part.length > 0 && part !== value);
}

function hasTrailingDoubleConsonant(value: string): boolean {
  if (value.length < 2) {
    return false;
  }
  const last = value[value.length - 1];
  const previous = value[value.length - 2];
  return last === previous && /[bcdfghjklmnpqrstvwxyz]/.test(last);
}

function isStopToken(token: string, kind: SearchTokenKind): boolean {
  if (kind === 'zh') {
    return ZH_STOP_WORDS.has(token);
  }
  if (kind === 'number') {
    return false;
  }
  return EN_STOP_WORDS.has(token);
}

function getTokenWeight(token: string, kind: SearchTokenKind): number {
  const weights = SEARCH_LEXICON.weights;
  const base = weights[kind] ?? weights.default;
  const domainBoost =
    EN_DOMAIN_TERMS.has(token) || ZH_DOMAIN_TERMS.has(token) ? weights.domain : 1;
  const lengthBoost =
    kind === 'number'
      ? 0
      : Math.min(Math.max(Array.from(token).length - 2, 0) * 0.04, weights.lengthBoostMax);
  return base * domainBoost + lengthBoost;
}

function buildWeightedTermMap(tokens: SearchToken[]): Map<string, number> {
  const terms = new Map<string, number>();
  for (const token of tokens) {
    terms.set(token.text, (terms.get(token.text) || 0) + token.weight);
  }
  return terms;
}

function hasPhraseMatch(query: string, text: string): boolean {
  const normalizedQuery = normalizePhrase(query);
  if (normalizedQuery.length < 4) {
    return false;
  }
  return normalizePhrase(text).includes(normalizedQuery);
}

function normalizePhrase(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function getWordSegmenter(locale: string): WordSegmenter | null {
  if (SEGMENTERS.has(locale)) {
    return SEGMENTERS.get(locale) ?? null;
  }
  const Segmenter = (Intl as typeof Intl & { Segmenter?: SegmenterConstructor }).Segmenter;
  const segmenter = Segmenter ? new Segmenter(locale, { granularity: 'word' }) : null;
  SEGMENTERS.set(locale, segmenter);
  return segmenter;
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA.length || vecA.length !== vecB.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (!normA || !normB) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function extractKeywords(text: string, limit = 8): string[] {
  const scores = new Map<string, number>();
  for (const token of tokenizeSearchText(text)) {
    scores.set(token.text, (scores.get(token.text) || 0) + token.weight);
  }
  return [...scores.entries()]
    .sort(
      (a, b) =>
        b[1] - a[1] ||
        Array.from(b[0]).length - Array.from(a[0]).length ||
        a[0].localeCompare(b[0])
    )
    .slice(0, limit)
    .map(([token]) => token);
}

export function stripTrailingSlashes(value?: string): string | undefined {
  return value?.trim().replace(/\/+$/, '') || undefined;
}

export function resolveCoreCombinedKey(
  category: CoreMemoryCategory | undefined,
  key: string
): string {
  const trimmedKey = key.trim();
  if (!trimmedKey) {
    return '';
  }
  if (category && CORE_CATEGORIES.has(category)) {
    return `${category}.${trimmedKey}`;
  }
  return trimmedKey;
}

export function parseCoreCombinedKey(
  combinedKey: string
): Pick<CoreMemoryEntry, 'combinedKey' | 'category' | 'key'> & { value: string } {
  const trimmed = combinedKey.trim();
  const separator = trimmed.indexOf('.');
  if (separator > 0) {
    const category = trimmed.slice(0, separator) as CoreMemoryCategory;
    if (CORE_CATEGORIES.has(category)) {
      return {
        combinedKey: trimmed,
        category,
        key: trimmed.slice(separator + 1),
        value: '',
      };
    }
  }
  return {
    combinedKey: trimmed,
    key: trimmed,
    value: '',
  };
}

export function applyCoreMemoryActions(
  existingMemory: Record<string, string>,
  actions: CoreMemoryActionInput[]
): {
  nextMemory: Record<string, string>;
  applied: AppliedCoreMemoryAction[];
} {
  const nextMemory = { ...existingMemory };
  const applied: AppliedCoreMemoryAction[] = [];

  for (const action of actions) {
    const op = action.op;
    const combinedKey = resolveCoreCombinedKey(action.category, action.key);
    if (!combinedKey) {
      continue;
    }

    if (op === 'delete') {
      delete nextMemory[combinedKey];
      applied.push({
        op,
        category: action.category,
        key: action.key,
        combinedKey,
      });
      continue;
    }

    const value = typeof action.value === 'string' ? action.value.trim() : '';
    if (!value) {
      continue;
    }

    nextMemory[combinedKey] = value;
    applied.push({
      op,
      category: action.category,
      key: action.key,
      value,
      combinedKey,
    });
  }

  return { nextMemory, applied };
}

export function coreMemoryToPromptBlock(memory: Record<string, string>): string {
  const entries = Object.entries(memory);
  if (!entries.length) {
    return 'None';
  }
  return entries.map(([key, value]) => `- ${key}: ${value}`).join('\n');
}

export function clampInt(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

export function getFileTimestampMs(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

export function getFileSizeBytes(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

export function isSubPath(filePath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(filePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
