/**
 * macOS platform adapter: cliclick resolution, Quartz input injection,
 * clipboard access, AppleScript/JXA execution, and Dock accessibility lookups.
 */
import { spawn } from 'child_process';
import { writeMCPLog } from '../mcp-logger.js';
import { PLATFORM, type DockItemInfo } from './types.js';
import * as path from 'path';
import {
  normalizeModifierKeys,
  executeCommandSafe,
  resolveBundledExecutable,
  executePython,
  executeAppleScript,
  executeJXAScript,
  pathExists,
} from './env.js';
import { getDisplayConfiguration, convertCliclickToCocoaCoordinates } from './display.js';
import { isDescriptionDockRelated, scoreDockItemAgainstDescription } from './app-aliases.js';

let cachedCliclickPath: string | null | undefined;

export async function resolveCliclickPath(): Promise<string | null> {
  if (cachedCliclickPath !== undefined) return cachedCliclickPath;
  if (PLATFORM !== 'darwin') {
    cachedCliclickPath = null;
    return null;
  }

  // 1) Explicit override (useful for debugging)
  const envOverride = process.env.SOPHRON_CLICLICK_PATH;
  if (envOverride && (await pathExists(envOverride))) {
    cachedCliclickPath = envOverride;
    return envOverride;
  }

  // 2) 内置随应用打包（推荐）
  // 打包布局：Resources/tools/darwin-{arch}/bin/cliclick
  // 旧版布局：Resources/tools/bin/cliclick
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const archBundled = await resolveBundledExecutable(
    path.join('tools', `darwin-${arch}`, 'bin', 'cliclick')
  );
  const legacyBundled = await resolveBundledExecutable(path.join('tools', 'bin', 'cliclick'));
  const bundled = archBundled || legacyBundled;
  if (bundled) {
    cachedCliclickPath = bundled;
    return bundled;
  }

  // 3) Common Homebrew locations (packaged apps may have limited PATH)
  const commonLocations = ['/opt/homebrew/bin/cliclick', '/usr/local/bin/cliclick'];
  for (const p of commonLocations) {
    if (await pathExists(p)) {
      cachedCliclickPath = p;
      return p;
    }
  }

  // 4) PATH lookup
  try {
    const { stdout } = await executeCommandSafe('/usr/bin/which', ['cliclick'], { timeout: 2000 });
    const whichPath = stdout.trim();
    if (whichPath) {
      cachedCliclickPath = whichPath;
      return whichPath;
    }
  } catch {
    // ignore
  }

  cachedCliclickPath = null;
  return null;
}

export function formatCliclickCoords(x: number, y: number): string {
  // If either coordinate is negative, we need the '=' prefix
  if (x < 0 || y < 0) {
    return `=${x},${y}`;
  }
  return `${x},${y}`;
}

export async function performMacMouseMoveViaQuartz(
  globalX: number,
  globalY: number,
  modifiers: string[]
): Promise<void> {
  const { cocoaX, cocoaY } = await convertCliclickToCocoaCoordinates(globalX, globalY);
  const modsJson = JSON.stringify(normalizeModifierKeys(modifiers));
  const script = `
import Quartz, json
mods = json.loads(${JSON.stringify(modsJson)})
flag_map = {
  "cmd": Quartz.kCGEventFlagMaskCommand,
  "ctrl": Quartz.kCGEventFlagMaskControl,
  "shift": Quartz.kCGEventFlagMaskShift,
  "alt": Quartz.kCGEventFlagMaskAlternate,
}
flags = 0
for m in mods:
  flags |= flag_map.get(m, 0)
event = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, (${cocoaX}, ${cocoaY}), Quartz.kCGMouseButtonLeft)
if flags:
  Quartz.CGEventSetFlags(event, flags)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
  `.trim();
  await executePython(script, 5000);
}

export async function performMacClickViaQuartz(
  globalX: number,
  globalY: number,
  clickType: 'single' | 'double' | 'right' | 'triple',
  modifiers: string[]
): Promise<void> {
  const { cocoaX, cocoaY } = await convertCliclickToCocoaCoordinates(globalX, globalY);
  const modsJson = JSON.stringify(normalizeModifierKeys(modifiers));
  const clickCount = clickType === 'double' ? 2 : clickType === 'triple' ? 3 : 1;
  const isRight = clickType === 'right';
  const script = `
import Quartz, json, time
mods = json.loads(${JSON.stringify(modsJson)})
flag_map = {
  "cmd": Quartz.kCGEventFlagMaskCommand,
  "ctrl": Quartz.kCGEventFlagMaskControl,
  "shift": Quartz.kCGEventFlagMaskShift,
  "alt": Quartz.kCGEventFlagMaskAlternate,
}
flags = 0
for m in mods:
  flags |= flag_map.get(m, 0)
button = Quartz.kCGMouseButtonRight if ${isRight ? 'True' : 'False'} else Quartz.kCGMouseButtonLeft
down_event = Quartz.kCGEventRightMouseDown if ${isRight ? 'True' : 'False'} else Quartz.kCGEventLeftMouseDown
up_event = Quartz.kCGEventRightMouseUp if ${isRight ? 'True' : 'False'} else Quartz.kCGEventLeftMouseUp
def post(evt_type, click_state):
  ev = Quartz.CGEventCreateMouseEvent(None, evt_type, (${cocoaX}, ${cocoaY}), button)
  Quartz.CGEventSetIntegerValueField(ev, Quartz.kCGMouseEventClickState, click_state)
  if flags:
    Quartz.CGEventSetFlags(ev, flags)
  Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
for i in range(${clickCount}):
  state = i + 1 if ${clickCount} > 1 else 1
  post(down_event, state)
  post(up_event, state)
  if ${clickCount} > 1:
    time.sleep(0.05)
  `.trim();
  await executePython(script, 8000);
}

export async function performMacDragViaQuartz(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  modifiers: string[]
): Promise<void> {
  const from = await convertCliclickToCocoaCoordinates(fromX, fromY);
  const to = await convertCliclickToCocoaCoordinates(toX, toY);
  const modsJson = JSON.stringify(normalizeModifierKeys(modifiers));
  const script = `
import Quartz, json, time
mods = json.loads(${JSON.stringify(modsJson)})
flag_map = {
  "cmd": Quartz.kCGEventFlagMaskCommand,
  "ctrl": Quartz.kCGEventFlagMaskControl,
  "shift": Quartz.kCGEventFlagMaskShift,
  "alt": Quartz.kCGEventFlagMaskAlternate,
}
flags = 0
for m in mods:
  flags |= flag_map.get(m, 0)
def post(evt_type, x, y):
  ev = Quartz.CGEventCreateMouseEvent(None, evt_type, (x, y), Quartz.kCGMouseButtonLeft)
  if flags:
    Quartz.CGEventSetFlags(ev, flags)
  Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
post(Quartz.kCGEventLeftMouseDown, ${from.cocoaX}, ${from.cocoaY})
post(Quartz.kCGEventLeftMouseDragged, ${to.cocoaX}, ${to.cocoaY})
post(Quartz.kCGEventLeftMouseUp, ${to.cocoaX}, ${to.cocoaY})
  `.trim();
  await executePython(script, 8000);
}

export async function macReadClipboardBytes(timeoutMs: number = 2000): Promise<Buffer | null> {
  if (PLATFORM !== 'darwin') return null;

  const pbpastePath = '/usr/bin/pbpaste';
  return await new Promise<Buffer | null>((resolve) => {
    const child = spawn(pbpastePath, [], { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];

    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32') {
          child.kill(); // On Windows, kill() sends TerminateProcess
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        // ignore
      }
      resolve(null);
    }, timeoutMs);

    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });

    child.stdout.on('data', (d) => {
      stdoutChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks));
      } else {
        resolve(null);
      }
    });
  });
}

export async function macWriteClipboardBytes(
  bytes: Buffer,
  timeoutMs: number = 5000
): Promise<void> {
  if (PLATFORM !== 'darwin') {
    throw new Error('pbcopy is only available on macOS.');
  }

  const pbcopyPath = '/usr/bin/pbcopy';
  await new Promise<void>((resolve, reject) => {
    const child = spawn(pbcopyPath, [], { stdio: ['pipe', 'ignore', 'pipe'] });
    const stderrChunks: Buffer[] = [];

    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32') {
          child.kill(); // On Windows, kill() sends TerminateProcess
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        // ignore
      }
      reject(new Error('pbcopy timed out'));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.stderr.on('data', (d) => {
      stderrChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d));
    });

    child.stdin.on('error', () => {
      // Ignore stdin errors here; we'll rely on exit code/stderr.
    });

    child.stdin.end(bytes);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        reject(new Error(stderr || `pbcopy exited with code ${code}`));
      }
    });
  });
}

/**
 * Execute a command safely using execFileAsync (no shell interpolation).
 * Prefer this over executeCommand when the executable and arguments are known.
 */

export async function getFrontmostMacApplicationName(): Promise<string | null> {
  if (PLATFORM !== 'darwin') return null;

  try {
    const { stdout } = await executeAppleScript(
      'tell application "System Events" to get name of first process whose frontmost is true',
      5000
    );
    const name = stdout.trim();
    return name || null;
  } catch (error) {
    writeMCPLog(
      `[GuiOperateServer] Error getting frontmost app: ${error}`,
      'getFrontmostMacApplicationName'
    );
    return null;
  }
}

export async function getMacDockItemsViaAccessibility(): Promise<DockItemInfo[]> {
  if (PLATFORM !== 'darwin') return [];

  const jxaScript = [
    'const se = Application("System Events");',
    'const dock = se.processes.byName("Dock");',
    'const items = dock.lists[0].uiElements();',
    'const out = [];',
    'for (let i = 0; i < items.length; i++) {',
    '  try {',
    '    const n = String(items[i].name());',
    '    const p = items[i].position();',
    '    const s = items[i].size();',
    '    if (!n || n === "missing value" || n === "null") continue;',
    '    out.push({name:n, x:Number(p[0]), y:Number(p[1]), width:Number(s[0]), height:Number(s[1])});',
    '  } catch (e) {}',
    '}',
    'JSON.stringify(out);',
  ].join(' ');

  const { stdout } = await executeJXAScript(jxaScript, 10000);

  let parsed: DockItemInfo[];
  try {
    parsed = JSON.parse(stdout.trim()) as DockItemInfo[];
  } catch {
    writeMCPLog('[GUI] Failed to parse dock items JSON', 'DockItems Error');
    parsed = [];
  }
  return parsed.filter(
    (item) =>
      item &&
      typeof item.name === 'string' &&
      typeof item.x === 'number' &&
      typeof item.y === 'number' &&
      typeof item.width === 'number' &&
      typeof item.height === 'number' &&
      item.width > 0 &&
      item.height > 0
  );
}

export async function tryLocateElementInDockByAccessibility(
  elementDescription: string,
  displayIndex?: number
): Promise<{
  x: number;
  y: number;
  confidence: number;
  displayIndex: number;
  reasoning?: string;
} | null> {
  if (!isDescriptionDockRelated(elementDescription)) {
    return null;
  }

  const dockItems = await getMacDockItemsViaAccessibility();
  if (dockItems.length === 0) {
    return null;
  }

  let bestItem: DockItemInfo | null = null;
  let bestScore = 0;

  for (const item of dockItems) {
    const score = scoreDockItemAgainstDescription(item.name, elementDescription);
    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  if (!bestItem || bestScore < 120) {
    writeMCPLog(
      `[dock-accessibility] No reliable Dock match for "${elementDescription}". Best score: ${bestScore}`,
      'Dock Locate'
    );
    return null;
  }

  const centerGlobalX = Math.round(bestItem.x + bestItem.width / 2);
  const centerGlobalY = Math.round(bestItem.y + bestItem.height / 2);
  const config = await getDisplayConfiguration();

  let targetDisplay = config.displays.find(
    (d) =>
      centerGlobalX >= d.originX &&
      centerGlobalX <= d.originX + d.width &&
      centerGlobalY >= d.originY &&
      centerGlobalY <= d.originY + d.height
  );

  if (!targetDisplay) {
    targetDisplay =
      displayIndex !== undefined
        ? config.displays.find((d) => d.index === displayIndex)
        : config.displays.find((d) => d.isMain);
  }

  if (!targetDisplay) {
    return null;
  }

  const localX = Math.round(centerGlobalX - targetDisplay.originX);
  const localY = Math.round(centerGlobalY - targetDisplay.originY);

  writeMCPLog(
    `[dock-accessibility] Matched "${bestItem.name}" for "${elementDescription}" at global (${centerGlobalX}, ${centerGlobalY}), local (${localX}, ${localY}), display ${targetDisplay.index}, score=${bestScore}`,
    'Dock Locate'
  );

  return {
    x: localX,
    y: localY,
    confidence: Math.min(99, bestScore),
    displayIndex: targetDisplay.index,
    reasoning: `Matched Dock item "${bestItem.name}" via macOS Accessibility.`,
  };
}

/**
 * Execute cliclick command with error handling (macOS only)
 */
export async function executeCliclick(
  command: string
): Promise<{ stdout: string; stderr: string }> {
  if (PLATFORM !== 'darwin') {
    throw new Error('cliclick is only available on macOS. Use Windows-specific functions instead.');
  }

  const cliclickPath = await resolveCliclickPath();
  if (!cliclickPath) {
    throw new Error(
      'cliclick is required for GUI automation on macOS but was not found.\n' +
        `- Recommended: bundle it inside the app at Resources/tools/darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}/bin/cliclick\n` +
        '- Or legacy path: Resources/tools/bin/cliclick\n' +
        '- Or install it on this machine: brew install cliclick\n' +
        `Searched: bundled Resources/tools/darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}/bin/cliclick, ` +
        'Resources/tools/bin/cliclick, /opt/homebrew/bin/cliclick, /usr/local/bin/cliclick, and PATH.'
    );
  }

  // Parse cliclick command string into arguments array
  // cliclick commands are space-separated tokens like "c:100,200" or "kd:cmd kp:c ku:cmd"
  const cliclickArgs = command.split(/\s+/).filter(Boolean);
  writeMCPLog(
    `[executeCliclick] Executing: ${cliclickPath} ${cliclickArgs.join(' ')}`,
    'Cliclick Command'
  );

  try {
    const result = await executeCommandSafe(cliclickPath, cliclickArgs);
    writeMCPLog(
      `[executeCliclick] Command completed. stdout: ${result.stdout}, stderr: ${result.stderr}`,
      'Cliclick Result'
    );

    // cliclick may exit 0 while warning that Accessibility permission is missing.
    // Treat this as a hard failure to avoid reporting false-positive click success.
    if (/Accessibility privileges not enabled/i.test(result.stderr || '')) {
      const hint =
        '\n\nmacOS 权限提示 / Permissions:\n' +
        '- System Settings → Privacy & Security → Accessibility：允许 sophron cowork / 九思助理\n' +
        '- 如果是终端运行：允许 Terminal/iTerm\n' +
        '- 授权后请重启 sophron cowork / 九思助理 再重试\n';
      throw new Error(
        `cliclick cannot control UI because Accessibility permission is not enabled.${hint}`
      );
    }

    return result;
  } catch (error: unknown) {
    const baseMessage = error instanceof Error ? error.message : String(error);
    const hint =
      '\n\nmacOS 权限提示 / Permissions:\n' +
      '- System Settings → Privacy & Security → Accessibility：允许 sophron cowork / 九思助理\n' +
      '- System Settings → Privacy & Security → Automation：允许 sophron cowork / 九思助理 控制 “System Events”\n';
    throw new Error(`${baseMessage}${hint}`);
  }
}
