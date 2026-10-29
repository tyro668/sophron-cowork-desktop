import fs from 'fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import git from 'isomorphic-git';
/**
 * Shared git version layer for user code the app generates and runs: script packages
 * (自动化 · 执行脚本) and raw-table 自定义 normalizers. One folder = one isomorphic-git repo
 * (no system git): every version is a commit on `main`, each published version gets a
 * `vN` tag and the moving `published` tag marks what runs. Version metadata (status, 来源,
 * notes) lives in the app database and references the commit.
 */

export interface VersionFile {
  path: string;
  content: string;
}

/** Neutral local author for version commits (never the user's identity). */
export const VERSION_GIT_AUTHOR = { name: 'Sophron', email: 'local@sophron' };
const BRANCH = 'main';
/** Moving tag on the version automations run. */
export const PUBLISHED_TAG = 'published';
const MAX_FILE_BYTES = 256 * 1024;

export const versionTag = (version: number) => `v${version}`;

/** Runtime dirs, run outputs and logs never enter a version. */
export const VERSION_GITIGNORE = [
  '# Managed by Sophron: runtime files are not part of a version',
  '.sophron/',
  '.venv/',
  '.normalizer-env/',
  'node_modules/',
  '__pycache__/',
  '*.pyc',
  '*.log',
  'output/',
  '',
].join('\n');

/** Folders kept when the app rewrites a working tree or run directory. */
const KEEP_ON_REWRITE = new Set([
  '.git',
  '.sophron',
  '.venv',
  '.normalizer-env',
  'node_modules',
  '__pycache__',
]);

export interface TreeDiff {
  added: string[];
  modified: string[];
  removed: string[];
}

/** Git-backed history of one versioned code folder (isomorphic-git, no system git). */
export class VersionRepo {
  constructor(readonly dir: string) {}

  get exists(): boolean {
    return fs.existsSync(path.join(this.dir, '.git'));
  }

  /** Initialise the repo and the managed .gitignore (idempotent). */
  async ensure(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    if (!this.exists) await git.init({ fs, dir: this.dir, defaultBranch: BRANCH });
    const ignorePath = path.join(this.dir, '.gitignore');
    const current = fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, 'utf8') : '';
    const missing = VERSION_GITIGNORE.split('\n').filter(
      (line) => line && !line.startsWith('#') && !current.split(/\r?\n/).includes(line)
    );
    if (!current) await writeFile(ignorePath, VERSION_GITIGNORE, 'utf8');
    else if (missing.length > 0)
      await writeFile(ignorePath, `${current.replace(/\s*$/, '\n')}${missing.join('\n')}\n`);
  }

  async head(): Promise<string | null> {
    try {
      return await git.resolveRef({ fs, dir: this.dir, ref: `refs/heads/${BRANCH}` });
    } catch {
      return null;
    }
  }

  /**
   * Paths whose working-tree content differs from HEAD (ignored files excluded).
   * statusMatrix lists the candidate files; each one is re-hashed because statusMatrix's
   * stat cache misses same-size edits made within the same second.
   */
  async changedPaths(): Promise<string[]> {
    const matrix = await git.statusMatrix({ fs, dir: this.dir });
    const head = await this.head();
    const headIndex = head ? await this.treeIndex(head) : new Map<string, string>();
    const changed: string[] = [];
    for (const [file, , workdir] of matrix) {
      if (workdir === 0) {
        if (headIndex.has(file)) changed.push(file);
        continue;
      }
      const content = await readFile(path.join(this.dir, ...file.split('/')));
      const { oid } = await git.hashBlob({ object: content });
      if (headIndex.get(file) !== oid) changed.push(file);
    }
    return changed;
  }

  /**
   * Stage the whole working tree and commit it. `replace` swaps out that commit when it
   * is the branch tip (same parent), so an overwritten draft does not grow the history.
   * Returns null when nothing changed and no commit was needed.
   */
  async commitAll(message: string, options: { replace?: string } = {}): Promise<string | null> {
    const head = await this.head();
    const changed = await this.changedPaths();
    if (changed.length === 0 && head) return null;
    const matrix = await git.statusMatrix({ fs, dir: this.dir });
    for (const [file, headStatus, workdir, stage] of matrix) {
      if (workdir === 0) {
        if (headStatus !== 0 || stage !== 0)
          await git.remove({ fs, dir: this.dir, filepath: file });
      } else {
        // Always re-add: the index stat cache can hide same-second edits.
        await git.add({ fs, dir: this.dir, filepath: file });
      }
    }
    let parent: string[] | undefined;
    if (options.replace && head === options.replace) {
      const { commit } = await git.readCommit({ fs, dir: this.dir, oid: head });
      parent = commit.parent;
    }
    return git.commit({
      fs,
      dir: this.dir,
      message,
      author: VERSION_GIT_AUTHOR,
      committer: VERSION_GIT_AUTHOR,
      ...(parent ? { parent } : {}),
    });
  }

  /** Replace the working tree with exactly these files (runtime folders are kept). */
  async writeFiles(files: VersionFile[]): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const keep = new Set<string>(['.gitignore']);
    const targets: Array<[string, string]> = [];
    for (const file of files) {
      const rel = file.path.replace(/\\/g, '/').replace(/^\/+/, '');
      if (!rel || rel === '.gitignore') continue;
      if (rel.split('/').some((part) => part === '..' || KEEP_ON_REWRITE.has(part))) {
        throw new Error(`Invalid file path: ${file.path}`);
      }
      keep.add(rel);
      targets.push([rel, file.content]);
    }
    await removeUnlisted(this.dir, '', keep);
    for (const [rel, content] of targets) {
      const target = path.join(this.dir, ...rel.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
    }
  }

  /** Publish: tag the commit `vN` and move the `published` tag to it (rollback = older N). */
  async publishTag(version: number, oid: string): Promise<void> {
    await this.tag(versionTag(version), oid);
    await this.tag(PUBLISHED_TAG, oid);
  }

  async tag(name: string, oid: string): Promise<void> {
    await git.tag({ fs, dir: this.dir, ref: name, object: oid, force: true });
  }

  async resolveTag(name: string): Promise<string | null> {
    try {
      return await git.resolveRef({ fs, dir: this.dir, ref: `refs/tags/${name}` });
    } catch {
      return null;
    }
  }

  async deleteTag(name: string): Promise<void> {
    await git.deleteTag({ fs, dir: this.dir, ref: name }).catch(() => undefined);
  }

  async listTags(): Promise<string[]> {
    return git.listTags({ fs, dir: this.dir });
  }

  /** Blob oids by path for a commit's tree. */
  async treeIndex(oid: string): Promise<Map<string, string>> {
    const index = new Map<string, string>();
    await git.walk({
      fs,
      dir: this.dir,
      trees: [git.TREE({ ref: oid })],
      map: async (filepath, [entry]) => {
        if (!entry || filepath === '.') return;
        if ((await entry.type()) === 'blob') index.set(filepath, await entry.oid());
        return true;
      },
    });
    return index;
  }

  /** Text files of a commit (binary and very large files are listed with empty content). */
  async readFiles(oid: string): Promise<VersionFile[]> {
    const files: VersionFile[] = [];
    for (const [filepath, blobOid] of await this.treeIndex(oid)) {
      const { blob } = await git.readBlob({ fs, dir: this.dir, oid: blobOid });
      const binary = blob.length > MAX_FILE_BYTES || blob.includes(0);
      files.push({ path: filepath, content: binary ? '' : Buffer.from(blob).toString('utf8') });
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  async diff(fromOid: string | null, toOid: string): Promise<TreeDiff> {
    const from = fromOid ? await this.treeIndex(fromOid) : new Map<string, string>();
    const to = await this.treeIndex(toOid);
    const result: TreeDiff = { added: [], modified: [], removed: [] };
    for (const [file, oid] of to) {
      if (!from.has(file)) result.added.push(file);
      else if (from.get(file) !== oid) result.modified.push(file);
    }
    for (const file of from.keys()) if (!to.has(file)) result.removed.push(file);
    return result;
  }

  /**
   * Write a commit's tree into `target` (the working tree or a run directory), deleting
   * files that are not in it. Runtime folders (.venv, node_modules, .sophron) are kept so
   * installed deps survive a checkout.
   */
  async checkoutTree(oid: string, target = this.dir): Promise<void> {
    await mkdir(target, { recursive: true });
    const index = await this.treeIndex(oid);
    await removeUnlisted(target, '', new Set(index.keys()));
    for (const [filepath, blobOid] of index) {
      const { blob } = await git.readBlob({ fs, dir: this.dir, oid: blobOid });
      const file = path.join(target, ...filepath.split('/'));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, Buffer.from(blob));
    }
  }
}

async function removeUnlisted(root: string, rel: string, keep: Set<string>): Promise<void> {
  const dir = path.join(root, rel);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!rel && KEEP_ON_REWRITE.has(entry.name)) continue;
    if (KEEP_ON_REWRITE.has(entry.name) && entry.isDirectory()) continue;
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await removeUnlisted(root, child, keep);
      if ((await readdir(path.join(root, child))).length === 0)
        await rm(path.join(root, child), { recursive: true, force: true });
    } else if (!keep.has(child)) {
      await rm(path.join(root, child), { force: true });
    }
  }
}

/** Minimal version record shape for the shared draft rules. */
export interface DraftCandidate<S extends string = string> {
  version: number;
  status: 'draft' | 'published' | 'archived';
  source: S;
  commit: string;
}

/**
 * The draft a new save of `source` overwrites: the newest version, when it is an
 * unpublished draft of the same source newer than the published one. Rule generation
 * (`alwaysNew`) always creates a new version.
 */
export function findReusableDraft<R extends DraftCandidate>(
  records: R[],
  source: R['source'],
  options: { alwaysNew?: boolean } = {}
): R | undefined {
  if (options.alwaysNew) return undefined;
  const sorted = [...records].sort((a, b) => a.version - b.version);
  const latest = sorted.at(-1);
  const published = sorted.filter((record) => record.status === 'published').at(-1);
  if (!latest || latest.status !== 'draft' || latest.source !== source) return undefined;
  return latest.version > (published?.version ?? 0) ? latest : undefined;
}
