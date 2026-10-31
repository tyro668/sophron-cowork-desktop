import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { describeLocalHostRefs, findLocalHostRefs } from '../../shared/network-policy';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '.sophron', '__pycache__']);
const MAX_FILES = 400;
const MAX_BYTES = 256 * 1024;

/** Text files of a workspace (bounded), for the static network policy. */
function workspaceFiles(root: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || files.length >= MAX_FILES) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (files.length >= MAX_FILES) return;
      const full = path.join(dir, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full, depth + 1);
      } else if (stat.isFile() && stat.size <= MAX_BYTES) {
        try {
          const content = readFileSync(full, 'utf8');
          if (!content.includes('\u0000'))
            files.push({ path: path.relative(root, full).split(path.sep).join('/'), content });
        } catch {
          // unreadable: skip
        }
      }
    }
  };
  walk(root, 0);
  return files;
}

/** Reason to refuse running code in `root` when its files address this computer's services. */
export function localHostRefusal(root: string): string | undefined {
  const refs = findLocalHostRefs(workspaceFiles(root));
  return refs.length > 0 ? `${describeLocalHostRefs(refs)}（命令已拦截）` : undefined;
}
