import type { ApiTestInput, ApiTestResult } from '../../shared/contracts';
import type { AppConfig } from './config-store';
import { probeWithPiAi } from '../agent/pi-ai-one-shot';

export async function runConfigApiTest(
  payload: ApiTestInput,
  config: AppConfig
): Promise<ApiTestResult> {
  return probeWithPiAi(payload, config);
}
