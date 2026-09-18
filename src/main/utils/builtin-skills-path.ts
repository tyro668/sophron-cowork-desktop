import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve the bundled built-in skills directory (assets/skills).
 *
 * `moduleDir` must be the caller's `__dirname` — its depth relative to the
 * project root differs between layouts, so candidates cover both:
 * - vite bundle: dist-electron/main/*.js → root is 2 levels up
 * - plain ts/vitest: src/main/<dir>/*.ts → root is 3 levels up
 */
export function resolveBuiltinSkillsPath(options: {
  appPath: string;
  resourcesPath?: string;
  moduleDir: string;
}): string {
  const { appPath, resourcesPath, moduleDir } = options;

  const possiblePaths = [
    // Production: extraResources extracts assets/skills → resources/skills
    // (real directory, no asar issues — preferred production path)
    ...(resourcesPath ? [path.join(resourcesPath, 'skills')] : []),
    // Development (bundled): vite outputs to dist-electron/main → repo root is 2 up
    path.join(moduleDir, '..', '..', 'assets', 'skills'),
    // Development (unbundled/tests): src/main/<dir> → repo root is 3 up
    path.join(moduleDir, '..', '..', '..', 'assets', 'skills'),
    // Development via app path (repo root), or inside the packaged asar
    path.join(appPath, 'assets', 'skills'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return '';
}
