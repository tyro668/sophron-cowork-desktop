/**
 * Defense in depth for agent shell commands (the sandbox is the real boundary): refuse
 * commands that reach for credentials, app data, local / private network services or the
 * environment, escalate privileges or touch the system.
 */
const RULES: Array<[RegExp, string]> = [
  [/\b(sudo|doas|pkexec)\b|\bsu\s+(-|root\b)/, '不允许提权'],
  [
    /(\.ssh|\.gnupg|\.aws|\.azure|\.kube|\.docker|\.secrets|\.netrc|\.npmrc|\.pypirc|keychain|Keychains)\b/i,
    '不允许访问凭据文件',
  ],
  [
    /(\.config\/sophron|Application Support\/sophron|AppData[\\/]+Roaming[\\/]+sophron|cowork\.db)/i,
    '不允许访问应用数据',
  ],
  [
    /\b(localhost|0\.0\.0\.0|metadata\.google\.internal)\b|(^|[^\d.])(127|10)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b169\.254\.\d{1,3}\.\d{1,3}\b|\b192\.168\.\d{1,3}\.\d{1,3}\b|\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b|\[::1?\]/i,
    '不允许访问本机或内网地址',
  ],
  [/\brm\s+(-[a-zA-Z]*\s+)*(\/|~|\$HOME|\/\*)(\s|$)/, '不允许删除系统或主目录'],
  [/\b(mkfs|fdisk|shutdown|reboot|halt|crontab|launchctl|systemctl|chown)\b/, '不允许的系统命令'],
  [/\b(nc|ncat|netcat|socat|telnet)\b/, '不允许使用原始网络连接工具'],
  [
    /(^|[;&|`(]\s*)(env|printenv|set|export\s+-p|declare\s+-x)\s*($|[;&|)])|\/proc\/[^/\s]+\/environ/,
    '不允许读取全部环境变量',
  ],
];

/** Why `command` is refused, or undefined when it may run. */
export function checkAgentCommand(command: string): string | undefined {
  for (const [pattern, reason] of RULES) {
    if (pattern.test(command)) return `${reason}（命令已拦截）`;
  }
  return undefined;
}
