import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import extract from 'extract-zip';
import type { PluginCatalogItem, PluginComponentCounts } from '../../shared/contracts';
import { isPathWithinRoot } from '../tools/path-containment';

interface SkillHubListResponse {
  code?: number;
  message?: string;
  data?: {
    skills?: SkillHubSkillListItem[];
    total?: number;
  };
}

interface SkillHubSkillListItem {
  slug?: string;
  name?: string;
  description?: string;
  description_zh?: string;
  version?: string;
  ownerName?: string;
  homepage?: string;
  source?: string;
  labels?: Record<string, string | boolean | null | undefined> | null;
  namespace?: {
    canonicalName?: string;
    handle?: string;
    publicSlug?: string;
  } | null;
}

export interface DownloadedSkillHubSkill {
  rootPath: string;
  cleanup: () => void;
}

const SKILLHUB_API_BASE_URL = 'https://api.skillhub.cn';
const SKILLHUB_SITE_BASE_URL = 'https://skillhub.cn';
const SKILLHUB_CATALOG_PAGE_SIZE = 50;
const DEFAULT_USER_AGENT = 'sophron-skillhub/1.0';

const SKILL_ONLY_COUNTS: PluginComponentCounts = {
  skills: 1,
  commands: 0,
  agents: 0,
  hooks: 0,
  mcp: 0,
};

export class SkillHubService {
  private readonly fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch = fetch) {
    this.fetchFn = fetchFn;
  }

  async listCatalogSkills(
    options: { page?: number; pageSize?: number } = {}
  ): Promise<PluginCatalogItem[]> {
    const page = Math.max(1, Math.floor(options.page ?? 1));
    const pageSize = Math.min(
      100,
      Math.max(1, Math.floor(options.pageSize ?? SKILLHUB_CATALOG_PAGE_SIZE))
    );
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortBy: 'score',
      order: 'desc',
    });
    const payload = await this.fetchJson<SkillHubListResponse>(
      `${SKILLHUB_API_BASE_URL}/api/skills?${params.toString()}`
    );

    if (payload.code !== 0) {
      throw new Error(payload.message || 'SkillHub catalog returned an error');
    }

    return (payload.data?.skills || [])
      .map((skill) => this.toCatalogItem(skill))
      .filter((skill): skill is PluginCatalogItem => skill !== null);
  }

  async downloadSkill(slug: string): Promise<DownloadedSkillHubSkill> {
    const normalizedSlug = this.normalizeSlug(slug);
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-skillhub-'));
    const zipPath = path.join(tempRoot, `${normalizedSlug}.zip`);
    const extractRoot = path.join(tempRoot, 'content');

    try {
      fs.mkdirSync(extractRoot, { recursive: true });
      const response = await this.fetchFn(
        `${SKILLHUB_API_BASE_URL}/api/v1/download?slug=${encodeURIComponent(normalizedSlug)}`,
        {
          headers: {
            'User-Agent': DEFAULT_USER_AGENT,
          },
        }
      );
      if (!response.ok) {
        const message = await this.extractErrorMessage(response);
        throw new Error(
          `SkillHub download failed (${response.status})${message ? `: ${message}` : ''}`
        );
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0) {
        throw new Error('SkillHub download returned an empty archive');
      }
      fs.writeFileSync(zipPath, bytes);
      await extract(zipPath, { dir: extractRoot });

      const rootPath = this.findSkillRoot(extractRoot);
      if (!rootPath) {
        throw new Error('Downloaded SkillHub archive does not contain SKILL.md');
      }

      return {
        rootPath,
        cleanup: () => {
          fs.rmSync(tempRoot, { recursive: true, force: true });
        },
      };
    } catch (error) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      throw error;
    }
  }

  private toCatalogItem(skill: SkillHubSkillListItem): PluginCatalogItem | null {
    const slug = skill.slug?.trim();
    if (!slug) {
      return null;
    }

    const name = (skill.name || slug).trim();
    const requiresApiKey =
      skill.labels?.requires_api_key === true || skill.labels?.requires_api_key === 'true';
    // Slugs are not unique across publishers — the canonical @handle/slug
    // identity disambiguates them for install and installed-detection.
    const canonicalSlug = skill.namespace?.canonicalName?.trim() || slug;

    return {
      name,
      description: skill.description_zh || skill.description,
      version: skill.version,
      authorName: skill.ownerName,
      installable: true,
      hasManifest: false,
      componentCounts: { ...SKILL_ONLY_COUNTS },
      skillCount: 1,
      hasSkills: true,
      pluginId: `skillhub:${canonicalSlug}`,
      skillHubSlug: canonicalSlug,
      installCommand: `skillhub install ${canonicalSlug}`,
      detailUrl:
        skill.homepage?.trim() ||
        `${SKILLHUB_SITE_BASE_URL}/skills/${encodeURIComponent(canonicalSlug)}`,
      catalogSource: 'skillhub',
      requiresApiKey,
    };
  }

  private normalizeSlug(slug: string): string {
    const normalized = slug.trim().replace(/^skillhub:/i, '');
    // Accepts both `slug` and the canonical `@handle/slug` form.
    if (!/^(@[a-z0-9][a-z0-9._-]{0,63}\/)?[a-z0-9][a-z0-9._-]{0,127}$/i.test(normalized)) {
      throw new Error(`Invalid SkillHub slug: ${slug}`);
    }
    return normalized;
  }

  private findSkillRoot(rootPath: string): string | null {
    const candidates: string[] = [];
    const visit = (currentPath: string, depth: number) => {
      if (depth > 3) {
        return;
      }
      if (!isPathWithinRoot(currentPath, rootPath)) {
        return;
      }
      const skillPath = path.join(currentPath, 'SKILL.md');
      if (fs.existsSync(skillPath) && fs.statSync(skillPath).isFile()) {
        candidates.push(currentPath);
        return;
      }
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          visit(path.join(currentPath, entry.name), depth + 1);
        }
      }
    };

    visit(rootPath, 0);
    return candidates.sort((a, b) => a.length - b.length)[0] ?? null;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await this.fetchFn(url, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
      },
    });
    if (!response.ok) {
      const message = await this.extractErrorMessage(response);
      throw new Error(
        `Request failed (${response.status}) for ${url}${message ? `: ${message}` : ''}`
      );
    }
    return response.json() as Promise<T>;
  }

  private async extractErrorMessage(response: Response): Promise<string> {
    try {
      const text = await response.text();
      return text.trim().slice(0, 200);
    } catch {
      return '';
    }
  }
}
