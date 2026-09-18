import { describe, expect, it } from 'vitest';
import { buildLiveToolOutputSnapshot } from '../src/main/agent/live-tool-output';

describe('buildLiveToolOutputSnapshot', () => {
  it('treats a tool update as a cumulative text snapshot', () => {
    expect(
      buildLiveToolOutputSnapshot({
        content: [{ type: 'text', text: 'first line\nsecond line' }],
      })
    ).toEqual({ text: 'first line\nsecond line', truncated: false });
  });

  it('keeps a bounded tail and removes terminal controls', () => {
    const lines = Array.from({ length: 220 }, (_, index) => `line ${index}`);
    const snapshot = buildLiveToolOutputSnapshot({
      content: [{ type: 'text', text: `\x1b[32m${lines.join('\n')}\x1b[0m` }],
    });

    expect(snapshot?.truncated).toBe(true);
    expect(snapshot?.text).toContain('line 219');
    expect(snapshot?.text).not.toContain('line 0\n');
    expect(snapshot?.text).not.toContain('\x1b');
  });

  it('redacts recognizable credentials before sending output to the renderer', () => {
    const snapshot = buildLiveToolOutputSnapshot({
      content: [{ type: 'text', text: 'Authorization: Bearer abc.def\napi_key=secret-value' }],
    });

    expect(snapshot?.text).toContain('[REDACTED]');
    expect(snapshot?.text).not.toContain('abc.def');
    expect(snapshot?.text).not.toContain('secret-value');
  });

  it('does not serialize non-text or image payloads into live output', () => {
    expect(
      buildLiveToolOutputSnapshot({
        content: [{ type: 'image', data: 'base64-secret', mimeType: 'image/png' }],
      })
    ).toBeNull();
  });
});
