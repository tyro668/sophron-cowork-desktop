import { promises as fs } from 'fs';
import { isHtmlReportPath } from '../../shared/report-path';

const VIEWER_START = '<!-- sophron-report-viewer:start -->';
const VIEWER_END = '<!-- sophron-report-viewer:end -->';
const VIEWER_BLOCK_PATTERN =
  /<!-- sophron-report-viewer:start -->[\s\S]*?<!-- sophron-report-viewer:end -->/;
const BACK_TO_TOP_LABEL = '\u56de\u5230\u9876\u90e8';

function buildReportViewerBlock(): string {
  return `${VIEWER_START}
<style data-sophron-report-viewer="true">
  #sophron-report-back-to-top {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 2147483647;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 36px;
    padding: 0 14px;
    border: 1px solid rgba(20, 184, 166, 0.36);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.92);
    color: #0f766e;
    box-shadow: 0 10px 24px rgba(15, 118, 110, 0.16);
    font: 600 14px/1.1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    cursor: pointer;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }

  #sophron-report-back-to-top:hover {
    border-color: #14b8a6;
    background: #ccfbf1;
    color: #0b5f59;
  }

  #sophron-report-back-to-top:focus-visible {
    outline: 3px solid rgba(20, 184, 166, 0.35);
    outline-offset: 2px;
  }

  @media (max-width: 640px) {
    #sophron-report-back-to-top {
      top: 10px;
      right: 10px;
      min-height: 34px;
      padding: 0 12px;
      font-size: 13px;
    }
  }
</style>
<button id="sophron-report-back-to-top" type="button" data-sophron-report-viewer="true" aria-label="${BACK_TO_TOP_LABEL}">${BACK_TO_TOP_LABEL}</button>
<script data-sophron-report-viewer="true">
(() => {
  const getDocumentBottom = () => Math.max(
    document.documentElement ? document.documentElement.scrollHeight : 0,
    document.body ? document.body.scrollHeight : 0
  );

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      window.scrollTo({ top: getDocumentBottom(), behavior: 'auto' });
    });
  };

  const wireBackToTop = () => {
    const button = document.getElementById('sophron-report-back-to-top');
    if (!button || button.dataset.sophronReportViewerBound === 'true') {
      return;
    }
    button.dataset.sophronReportViewerBound = 'true';
    button.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireBackToTop, { once: true });
  } else {
    wireBackToTop();
  }

  window.addEventListener('load', scrollToBottom, { once: true });
  setTimeout(scrollToBottom, 50);
  setTimeout(scrollToBottom, 300);
})();
</script>
${VIEWER_END}`;
}

export function injectReportViewerControls(html: string): string {
  const viewerBlock = buildReportViewerBlock();
  if (VIEWER_BLOCK_PATTERN.test(html)) {
    return html.replace(VIEWER_BLOCK_PATTERN, viewerBlock);
  }

  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${viewerBlock}\n</body>`);
  }

  return `${html}\n${viewerBlock}`;
}

export async function prepareGeneratedReportForOpen(
  filePath: string
): Promise<{ prepared: boolean; updated: boolean }> {
  if (!isHtmlReportPath(filePath)) {
    return { prepared: false, updated: false };
  }

  const html = await fs.readFile(filePath, 'utf8');
  const nextHtml = injectReportViewerControls(html);
  if (nextHtml === html) {
    return { prepared: true, updated: false };
  }

  await fs.writeFile(filePath, nextHtml, 'utf8');
  return { prepared: true, updated: true };
}
