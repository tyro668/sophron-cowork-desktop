import type { StoredPersonalAnalysisConfig } from '../../../shared/personal-analysis-types';
import { configStore } from '../../config/config-store';
import { sendToRenderer } from '../../app/events';

/** Reject only the configuration that issued the request, never a newly saved key. */
export function markPersonalAnalysisKeyDisconnected(rejected: StoredPersonalAnalysisConfig): void {
  const current = configStore.get('personalAnalysis');
  if (
    current.apiOrigin !== rejected.apiOrigin ||
    current.apiKey !== rejected.apiKey ||
    current.updatedAt !== rejected.updatedAt ||
    current.connectionStatus === 'disconnected'
  )
    return;
  configStore.set('personalAnalysis', {
    ...current,
    connectionStatus: 'disconnected',
    updatedAt: Date.now(),
  });
  sendToRenderer({
    type: 'config.status',
    payload: {
      isConfigured: configStore.isConfigured(),
      config: configStore.getAll(),
    },
  });
}
