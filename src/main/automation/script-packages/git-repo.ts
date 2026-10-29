import fs from 'fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import git from 'isomorphic-git';
import type { ScriptPackageFile } from '../../../shared/automation/script-package';

/** Neutral local author for script-package commits (never the user's identity). */
export const PACKAGE_GIT_AUTHOR = { name: 'Sophron', email: 'local@sophron' };
const BRANCH = 'main';
/** Moving tag on the version automations run. */
export const PUBLISHED_TAG = 'published';
const MAX_FILE_BYTES = 256 * 1024;

/** Runtime dirs, run outputs and logs never enter a version. */
export const PACKAGE_GITIGNORE = [
  '# Managed by Sophron: runtime files are not part of a version',
  '.sophron/',
  '.venv/',
  'node_modules/',
  '__pycache__/',
  '*.pyc',
  '*.log',
  'output/',
  '',
].join('\n');

/** Folders kept when the app rewrites a working tree or run directory. */
const KEEP_ON_REWRITE = new Set(['.git', '.sophron', '.venv', 'node_modules', '__pycache__']);

export interface TreeDiff {
  added: string[];
  modified: string[];
  removed: string[];
}

/** Git-backed history of one script package folder (isomorphic-git, no system git). */
export class PackageRepo {
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
    const missing = PACKAGE_GITIGNORE.split('\n').filter(
      (line) => line && !line.startsWith('#') && !current.split(/\r?\n/).includes(line)
    );
    if (!current) await writeFile(ignorePath, PACKAGE_GITIGNORE, 'utf8');
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
      author: PACKAGE_GIT_AUTHOR,
      committer: PACKAGE_GIT_AUTHOR,
      ...(parent ? { parent } : {}),
    });
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
  async readFiles(oid: string): Promise<ScriptPackageFile[]> {
    const files: ScriptPackageFile[] = [];
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
