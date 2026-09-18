/**
 * Renderer-local view types only. All cross-process contracts live in
 * `../../shared/contracts` and are re-exported here for backwards
 * compatibility. Prefer importing from '../../shared/contracts' in new code.
 */
export * from '../../shared/contracts';

import type { AppTheme, AppAccentTheme } from '../../shared/contracts';
import type { PermissionPolicyId } from '../../shared/permission-policies';

// Settings types
export interface Settings {
  theme: AppTheme;
  accentTheme: AppAccentTheme;
  apiKey?: string;
  defaultTools: string[];
  permissionPolicy: PermissionPolicyId;
  globalSkillsPath: string;
  memoryStrategy: 'auto' | 'manual' | 'rolling';
  maxContextTokens: number;
}
