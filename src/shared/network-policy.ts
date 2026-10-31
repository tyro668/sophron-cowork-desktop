/**
 * Generated code must not talk to this computer's own services (the app's local servers, other
 * local daemons) or cloud metadata endpoints. Sandboxed scripts share the host network, so this
 * is a static check of the package files; intranet (10.x / 192.168.x) data sources stay allowed.
 */
const LOCAL_HOST_REF =
  /\b(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|169\.254(?:\.\d{1,3}){2}|metadata\.google\.internal|100\.100\.100\.200)\b|\[(?:::1|0:0:0:0:0:0:0:1)\]|::ffff:127\./i;

export interface LocalHostRef {
  path: string;
  line: number;
  text: string;
}

export function findLocalHostRefs(files: Array<{ path: string; content: string }>): LocalHostRef[] {
  const refs: LocalHostRef[] = [];
  for (const file of files) {
    if (file.path.startsWith('.sophron/') || file.path === '.gitignore') continue;
    file.content.split(/\r?\n/).forEach((line, index) => {
      const match = LOCAL_HOST_REF.exec(line);
      if (match) refs.push({ path: file.path, line: index + 1, text: match[0] });
    });
  }
  return refs;
}

export function describeLocalHostRefs(refs: LocalHostRef[]): string {
  const first = refs
    .slice(0, 3)
    .map((ref) => `${ref.path}:${ref.line}（${ref.text}）`)
    .join('、');
  return `代码访问了本机或云元数据地址：${first}。脚本不能访问本机服务，请改用公开的数据源`;
}
