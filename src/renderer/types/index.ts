/**
 * Renderer-local view types only. All cross-process contracts live in
 * `../../shared/contracts` and are re-exported here for backwards
 * compatibility. Prefer importing from '../../shared/contracts' in new code.
 */
export * from '../../shared/contracts';

import type { AppTheme } from '../../shared/contracts';
import type { PermissionPolicyId, PermissionRule } from '../../shared/permission-policies';

// Settings types
export interface Settings {
  theme: AppTheme;
  apiKey?: string;
  defaultTools: string[];
  permissionPolicy: PermissionPolicyId;
  permissionRules: PermissionRule[];
  globalSkillsPath: string;
  memoryStrategy: 'auto' | 'manual' | 'rolling';
  maxContextTokens: number;
}
