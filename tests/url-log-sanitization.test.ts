import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sanitizeUrlForLog } from '../src/main/utils/sanitize-url';
import { sanitizeDiagnosticBaseUrl } from '../src/main/features/logs/service';
import { summarizeConfigUpdate } from '../src/main/features/config/log-summary';

const SECRET = 'sk-url-secret-9f8e7d6c';

describe('sanitizeUrlForLog', () => {
  it('drops query parameters and fragments that may carry credentials', () => {
    const out = sanitizeUrlForLog(`https://api.example.com/v1?api_key=${SECRET}&x=1#frag`);
    expect(out).toBe('https://api.example.com/v1');
    expect(out).not.toContain(SECRET);
  });

  it('drops userinfo credentials', () => {
    const out = sanitizeUrlForLog(`https://user:${SECRET}@api.example.com/v1/chat`);
    expect(out).toBe('https://api.example.com/v1/chat');
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain('user:');
  });

  it('keeps origin and pathname for diagnostics', () => {
    expect(sanitizeUrlForLog('http://localhost:11434/api/generate')).toBe(
      'http://localhost:11434/api/generate'
    );
  });

  it('sanitizes malformed URLs without throwing', () => {
    const out = sanitizeUrlForLog(`https://user:${SECRET}@broken url?key=${SECRET}`);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain('user:');
    // Scheme-relative credential is masked but the host hint survives.
    expect(out).toContain('***@');
  });

  it('masks credentials in scheme-less malformed input conservatively', () => {
    const out = sanitizeUrlForLog(`not a url with token ${SECRET}?q=1`);
    expect(out).not.toContain('q=1');
    expect(out).toContain(SECRET); // plain text without URL shape can't be attributed to a URL
  });
});

describe('sanitizeDiagnosticBaseUrl', () => {
  it('returns null for empty input and strips credentials otherwise', () => {
    expect(sanitizeDiagnosticBaseUrl(undefined)).toBeNull();
    expect(sanitizeDiagnosticBaseUrl('')).toBeNull();
    expect(sanitizeDiagnosticBaseUrl(`https://u:${SECRET}@h.example.com/v1?k=1`)).toBe(
      'https://h.example.com/v1'
    );
  });
});

describe('summarizeConfigUpdate url fields', () => {
  it('strips credentials from baseUrl', () => {
    const summary = summarizeConfigUpdate({
      baseUrl: `https://user:${SECRET}@api.example.com/v1?token=${SECRET}`,
    });
    expect(JSON.stringify(summary)).not.toContain(SECRET);
    expect(summary.baseUrl).toBe('https://api.example.com/v1');
  });

  it('strips credentials from memoryRuntime and personalAnalysis origins', () => {
    const summary = summarizeConfigUpdate({
      memoryRuntime: {
        llm: {
          inheritFromActive: false,
          provider: 'openai',
          baseUrl: `https://x:${SECRET}@h/v1`,
          model: 'm',
          timeoutMs: 1000,
        },
        embedding: {
          inheritFromActive: false,
          provider: 'openai',
          baseUrl: `https://h/v2?k=${SECRET}`,
          model: 'e',
          timeoutMs: 1000,
        },
        useEmbedding: true,
        maxNavSteps: 2,
        ingestionConcurrency: 4,
      },
      personalAnalysis: { apiOrigin: `https://pa.example.com?key=${SECRET}`, apiKey: 'x' },
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).toContain('"baseUrl":"https://h/v1"');
    expect(serialized).toContain('"baseUrl":"https://h/v2"');
    expect(serialized).toContain('"apiOrigin":"https://pa.example.com"');
  });
});

describe('mcp-manager URL logging', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/main/mcp/mcp-manager.ts'), 'utf8');

  it('never interpolates a raw config.url into log or error strings', () => {
    // Every place a URL reaches a log line or thrown error must go through
    // the sanitizer — raw `${config.url}` in a template literal leaks
    // query/userinfo credentials into exportable logs.
    const rawInterpolations = source.match(/\$\{config\.url\}/g) ?? [];
    expect(rawInterpolations).toEqual([]);
    expect(source).toContain('sanitizeUrlForLog(config.url)');
  });
});
