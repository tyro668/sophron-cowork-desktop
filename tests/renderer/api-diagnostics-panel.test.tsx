// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import ApiDiagnosticsPanel from '../../src/renderer/components/ApiDiagnosticsPanel';
import i18n from './i18n-test';

it('shows the model reply in a localized diagnosis when the arithmetic check fails', () => {
  const reply = 'Unexpected: 5';
  const panel = render(
    <ApiDiagnosticsPanel
      isRunning={false}
      onRunDiagnostics={() => {}}
      result={{
        overallOk: false,
        totalLatencyMs: 10,
        verificationLevel: 'deep',
        failedAt: 'model',
        steps: [{ name: 'model', status: 'fail', error: `probe_response_mismatch:${reply}` }],
      }}
    />
  );
  try {
    expect(
      panel.getByText(i18n.t('api.guidance.errorHints.probeMismatchGeneric', { reply }))
    ).toBeTruthy();
    expect(panel.container.textContent).toContain(reply);
    expect(panel.container.textContent).not.toContain('probe_response_mismatch');
  } finally {
    panel.unmount();
  }
});
