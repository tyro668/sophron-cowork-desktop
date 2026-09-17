/**
 * Project-owned naming boundary.
 *
 * Self-owned identifiers must not use "Claude" naming. Third-party surface is
 * explicitly allowed and must keep working:
 * - Claude model IDs (claude-sonnet-*, anthropic/claude-*, ...)
 * - Anthropic protocol/API terminology and CLAUDE_* env vars
 * - the external `claude`/`claude-code` CLI and `claude plugin` commands
 * - `~/.claude` compatibility paths (incl. the in-sandbox ~/.claude/skills
 *   the CLI reads) and `.claude-plugin` manifest dirs
 * - historical persisted names (`claude_session_id` inside the immutable
 *   baseline migration + its rename) and compat reads (claudeCodePath)
 * - third-party source/license naming (claude-marketplace,
 *   claude-plugins-official, claude.com catalog, `claudeCodeAvailable`,
 *   getExternalClaudeSkillsDir — names that describe the external tool)
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['src', 'tests', 'scripts', 'docs', 'design'];
const ROOT_FILES = ['.gitignore', 'AGENTS.md', 'package.json', 'electron-builder.yml'];
const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.md']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-electron', '.git', 'assets']);

// Patterns that must never appear in project-owned code/config/docs.
// Anything matching a third-party pattern above is fine; these catch the
// specific self-owned names that were renamed away.
const BANNED: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /ClaudeAgentRunner/, label: 'ClaudeAgentRunner -> AgentRunner' },
  { pattern: /probeWithClaudeSdk/, label: 'probeWithClaudeSdk -> probeWithPiAi' },
  {
    pattern: /generateTitleWithClaudeSdk/,
    label: 'generateTitleWithClaudeSdk -> generateTitleWithPiAi',
  },
  { pattern: /claude-sdk-one-shot/, label: 'claude-sdk-one-shot -> pi-ai-one-shot' },
  { pattern: /main\/claude\//, label: 'src/main/claude -> src/main/agent' },
  { pattern: /tests\/claude\//, label: 'src/tests/claude -> src/tests/agent' },
  { pattern: /\[Claude[A-Za-z]*\]/, label: 'log prefixes must not be [Claude*]' },
  {
    pattern: /\bClaude[A-Z][A-Za-z]*\b/,
    label: 'no new Claude* PascalCase identifiers (third-party types are allowlisted)',
  },
  { pattern: /from:\s*\.claude\//, label: 'packaging sources must not live under .claude/' },
  { pattern: /relPath:\s*'\.claude\//, label: 'build checks must not reference .claude/' },
  { pattern: /getAppClaudeDir|userClaudeDir/, label: 'app storage is not Claude-named' },
  {
    pattern: /getPath\('userData'\),\s*'claude'/,
    label: "use getAppStorageDir() instead of userData/'claude'",
  },
  {
    pattern: /['"]claude-sandbox['"]/,
    label: 'Lima instance name goes through lima-instance-name resolver',
  },
];

// Files allowed to mention the banned patterns for compatibility reasons:
// the historical migration strings and the legacy-name constants.
const ALLOWED_OCCURRENCES: Array<{ file: string; pattern: RegExp }> = [
  { file: 'src/main/sandbox/lima-instance-name.ts', pattern: /['"]claude-sandbox['"]/ },
  // software-dev-server-example spawns the external claude-code CLI; its log
  // prefix names the third-party tool it wraps.
  { file: 'src/main/mcp/software-dev-server-example.ts', pattern: /\[Claude[A-Za-z]*\]/ },
  { file: 'src/main/mcp/software-dev-server-example.ts', pattern: /\bClaude[A-Z][A-Za-z]*\b/ },
  // plugin-runtime-service types mirror the external `claude plugin` CLI's
  // JSON output shapes — the Claude* names are accurate third-party naming.
  { file: 'src/main/skills/plugin-runtime-service.ts', pattern: /\bClaude[A-Z][A-Za-z]*\b/ },
];

function* iterFiles(dir: string): Generator<string> {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* iterFiles(path.join(dir, entry.name));
    } else if (SCAN_EXT.has(path.extname(entry.name))) {
      yield path.join(dir, entry.name);
    }
  }
}

describe('project-owned naming boundary', () => {
  it('renamed directories no longer exist and new ones do', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/main/claude'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'src/tests/claude'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, '.claude/skills'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'src/main/agent/agent-runner.ts'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'assets/skills'))).toBe(true);
  });

  it('no source file reintroduces project-owned Claude identifiers', () => {
    const violations: string[] = [];
    const files = [...SCAN_DIRS.flatMap((dir) => [...iterFiles(dir)]), ...ROOT_FILES];
    for (const file of files) {
      if (file.endsWith('naming-boundary.test.ts')) continue;
      if (!fs.existsSync(path.join(ROOT, file))) continue;
      const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
      for (const { pattern, label } of BANNED) {
        if (!pattern.test(content)) continue;
        const allowed = ALLOWED_OCCURRENCES.some(
          (a) => a.file === file && a.pattern.source === pattern.source
        );
        if (!allowed) violations.push(`${file}: ${label}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('electron-builder packages built-in skills from assets/skills', () => {
    const yml = fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8');
    expect(yml).not.toMatch(/from:\s*\.claude\//);
    expect(yml.match(/from:\s*assets\/skills/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('package.json has no project-owned claude keywords', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      keywords?: string[];
    };
    expect(pkg.keywords?.filter((k) => /claude/i.test(k)) ?? []).toEqual([]);
  });

  it('user-facing locale copy stays model-neutral outside third-party names', () => {
    for (const locale of ['zh', 'en']) {
      const localeData = JSON.parse(
        fs.readFileSync(path.join(ROOT, `src/shared/i18n/locales/${locale}.json`), 'utf8')
      ) as Record<string, Record<string, unknown>>;
      const offenders: string[] = [];
      const walk = (obj: Record<string, unknown>, prefix: string) => {
        for (const [key, value] of Object.entries(obj)) {
          const fullKey = prefix ? `${prefix}.${key}` : key;
          if (typeof value === 'string' && /claude/i.test(value)) {
            // Third-party source names stay accurate (e.g. Claude marketplace).
            if (fullKey.endsWith('claudeMarketplaceSource')) continue;
            offenders.push(`${locale}:${fullKey} = ${value}`);
          } else if (value && typeof value === 'object') {
            walk(value as Record<string, unknown>, fullKey);
          }
        }
      };
      walk(localeData, '');
      expect(offenders).toEqual([]);
    }
  });
});
