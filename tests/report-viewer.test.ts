import { describe, expect, it } from 'vitest';
import { injectReportViewerControls } from '../src/main/utils/report-viewer';
import { isHtmlReportPath } from '../src/shared/report-path';

describe('generated report viewer controls', () => {
  it('detects html report paths only', () => {
    expect(isHtmlReportPath('/tmp/report.html')).toBe(true);
    expect(isHtmlReportPath('/tmp/report.HTM?cache=1')).toBe(true);
    expect(isHtmlReportPath('/tmp/report.pdf')).toBe(false);
  });

  it('injects back-to-top controls and bottom auto-scroll before body close', () => {
    const html = '<!doctype html><html><body><main>report</main></body></html>';
    const result = injectReportViewerControls(html);

    expect(result).toContain('id="metis-report-back-to-top"');
    expect(result).toContain('\u56de\u5230\u9876\u90e8');
    expect(result).toContain("window.scrollTo({ top: getDocumentBottom(), behavior: 'auto' });");
    expect(result).toContain("window.scrollTo({ top: 0, behavior: 'smooth' });");
    expect(result.indexOf('metis-report-viewer:start')).toBeLessThan(result.indexOf('</body>'));
  });

  it('replaces an existing injected block instead of duplicating it', () => {
    const html = '<html><body><main>report</main></body></html>';
    const once = injectReportViewerControls(html);
    const twice = injectReportViewerControls(once);

    expect(twice.match(/metis-report-viewer:start/g)).toHaveLength(1);
    expect(twice).toBe(once);
  });
});
