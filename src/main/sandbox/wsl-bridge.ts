/**
 * WSL Bridge - Communication bridge between Windows and WSL2
 *
 * Handles:
 * - WSL2 detection and initialization
 * - Node.js and claude-code installation in WSL
 * - JSON-RPC communication with WSL agent
 * - Path conversion between Windows and WSL
 */

import { spawn, execFile, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { log, logError } from '../utils/logger';
import type {
  WSLStatus,
  SandboxConfig,
  SandboxExecutor,
  ExecutionResult,
  DirectoryEntry,
  JSONRPCRequest,
  JSONRPCResponse,
  PathConverter,
} from './types';

// Import lazily to avoid circular dependency
let getSandboxBootstrap: (() => { getCachedWSLStatus(): WSLStatus | null }) | null = null;
async function loadBootstrap() {
  if (!getSandboxBootstrap) {
    const mod = await import('./sandbox-bootstrap');
    getSandboxBootstrap = mod.getSandboxBootstrap;
  }
  return getSandboxBootstrap();
}

const execFileAsync = promisify(execFile);

/**
 * Path conversion utilities for Windows <-> WSL
 */
export const pathConverter: PathConverter = {
  /**
   * Convert Windows path to WSL path
   * D:\DeskTop\project → /mnt/d/DeskTop/project
   */
  toWSL(windowsPath: string): string {
    if (!windowsPath) return windowsPath;

    // Handle UNC paths (\\server\share)
    if (/^(?:\\\\|\/\/)/.test(windowsPath)) {
      throw new Error('UNC paths are not supported in WSL sandbox mode');
    }

    // Convert drive letter path
    const match = windowsPath.match(/^([A-Za-z]):([\\/].*)$/);
    if (match) {
      const driveLetter = match[1].toLowerCase();
      const restPath = match[2].replace(/\\/g, '/');
      return `/mnt/${driveLetter}${restPath}`;
    }

    if (/^[A-Za-z]:/.test(windowsPath)) {
      throw new Error('WSL requires an absolute Windows drive path');
    }

    // Already a Unix path or relative path
    return windowsPath.replace(/\\/g, '/');
  },

  /**
   * Convert WSL path to Windows path
   * /mnt/d/DeskTop/project → D:\DeskTop\project
   */
  toWindows(wslPath: string): string {
    if (!wslPath) return wslPath;

    // Convert /mnt/X/... to X:\...
    const match = wslPath.match(/^\/mnt\/([a-z])(\/.*)?$/i);
    if (match) {
      const driveLetter = match[1].toUpperCase();
      const restPath = (match[2] || '').replace(/\//g, '\\');
      return `${driveLetter}:${restPath || '\\'}`;
    }

    // Not a /mnt path, return as-is
    return wslPath;
  },
};

/**
 * WSL Bridge - Manages communication with WSL2
 */
export class WSLBridge implements SandboxExecutor {
  /** Validate WSL distro name to prevent command injection */
  private static validateDistroName(distro: string): string {
    if (!/^[a-zA-Z0-9\-_.]+$/.test(distro)) {
      throw new Error(`Invalid WSL distro name: ${distro}`);
    }
    return distro;
  }

  private wslProcess: ChildProcess | null = null;
  private pendingRequests: Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timeout: NodeJS.Timeout;
    }
  > = new Map();
  private buffer: string = '';
  private config: SandboxConfig | null = null;
  private distro: string = 'Ubuntu';
  private isInitialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Decode UTF-16LE buffer to string (Windows WSL output)
   */
  private static decodeWSLOutput(buffer: Buffer | string): string {
    if (typeof buffer === 'string') {
      // Already a string, but may have null chars from UTF-16
      return buffer.replace(/\0/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    }

    // Try UTF-16LE first (Windows default for WSL commands)
    try {
      const decoded = buffer
        .toString('utf16le')
        .replace(/\0/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
      // Check if decoding looks valid (contains only printable ASCII and common chars)
      if (decoded && /^[\x20-\x7E\n\-_.]+$/.test(decoded)) {
        return decoded;
      }
    } catch {
      /* ignore */
    }

    // Fallback to UTF-8
    return buffer
      .toString('utf-8')
      .replace(/\0/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();
  }

  /**
   * Check if WSL2 is available on this system
   */
  static async checkWSLStatus(): Promise<WSLStatus> {
    try {
      // First, try a simple WSL command to check if it works at all
      try {
        await execFileAsync('wsl', ['--status'], { timeout: 5000 });
      } catch (statusError) {
        log('[WSL] WSL --status failed, WSL may not be properly configured');
        // Continue anyway, as --status might not be available on older versions
      }

      // Get list of distros - use encoding: 'buffer' to handle UTF-16
      const { stdout } = await execFileAsync('wsl', ['--list', '--quiet'], {
        encoding: 'buffer' as BufferEncoding,
        timeout: 10000,
      });

      // Decode the output properly (Windows uses UTF-16LE for WSL output)
      const rawBuffer = stdout as unknown as Buffer;
      const decodedOutput = WSLBridge.decodeWSLOutput(rawBuffer);

      // Parse available distros - filter out empty lines and garbage
      const distros = decodedOutput
        .split(/\r?\n/)
        .map((d) => d.trim())
        .filter((d) => d && d.length > 0 && /^[a-zA-Z0-9\-_.]+$/.test(d));

      log('[WSL] Raw output (hex):', rawBuffer.slice(0, 100).toString('hex'));
      log('[WSL] Decoded output:', JSON.stringify(decodedOutput));
      log('[WSL] Parsed distros:', distros);

      if (distros.length === 0) {
        return { available: false };
      }

      // Only user WSL 2 distributions are suitable. Docker's internal distros
      // are managed appliances, and a stopped/broken Ubuntu must not mask a
      // working Debian installation. The trailing version is locale-independent.
      const listing = await execFileAsync('wsl', ['--list', '--verbose'], {
        encoding: 'buffer' as BufferEncoding,
        timeout: 10000,
      });
      const rows = WSLBridge.decodeWSLOutput(listing.stdout as unknown as Buffer)
        .split('\n')
        .map((row) => row.replace(/^\s*\*?\s*/, ''));
      const candidates = distros
        .filter(
          (name) =>
            !/^(docker-desktop|rancher-desktop)(?:-|$)/i.test(name) &&
            rows.some(
              (row) =>
                row.startsWith(name) && /\s/.test(row[name.length] || '') && /\s2\s*$/.test(row)
            )
        )
        .sort((a, b) => Number(/ubuntu/i.test(b)) - Number(/ubuntu/i.test(a)));
      let selectedDistro: string | undefined;
      for (const candidate of candidates) {
        if (await WSLBridge.testDistro(candidate)) {
          selectedDistro = candidate;
          break;
        }
      }
      if (!selectedDistro) return { available: false };
      log('[WSL] Selected WSL 2 distro:', selectedDistro);

      // Check if Node.js is available in the distro
      // Use -e to execute a simple command
      let nodeAvailable = false;
      let nodeVersion = '';
      try {
        // Use simpler command format without bash -c
        const nodeResult = await execFileAsync(
          'wsl',
          ['-d', selectedDistro, '-e', 'node', '--version'],
          { timeout: 10000, encoding: 'utf-8' }
        );
        const output = nodeResult.stdout.trim();
        if (output.startsWith('v')) {
          nodeAvailable = true;
          nodeVersion = output;
          log('[WSL] Node.js found:', nodeVersion);
        }
      } catch (error) {
        // Try alternative: check with nvm
        try {
          const nvmResult = await execFileAsync(
            'wsl',
            [
              '-d',
              selectedDistro,
              '-e',
              'bash',
              '-c',
              'source ~/.nvm/nvm.sh 2>/dev/null && node --version',
            ],
            { timeout: 10000, encoding: 'utf-8' }
          );
          const output = nvmResult.stdout.trim();
          if (output.startsWith('v')) {
            nodeAvailable = true;
            nodeVersion = output + ' (nvm)';
            log('[WSL] Node.js found via nvm:', nodeVersion);
          }
        } catch {
          log('[WSL] Node.js not found');
          nodeAvailable = false;
        }
      }

      // Check if claude-code is available
      let claudeCodeAvailable = false;
      if (nodeAvailable) {
        try {
          const claudeResult = await execFileAsync(
            'wsl',
            [
              '-d',
              selectedDistro,
              '-e',
              'bash',
              '-c',
              'source ~/.nvm/nvm.sh 2>/dev/null; which claude && claude --version',
            ],
            { timeout: 10000, encoding: 'utf-8' }
          );
          const output = claudeResult.stdout.trim();
          if (output) {
            claudeCodeAvailable = true;
            log('[WSL] claude-code found:', output);
          }
        } catch (error) {
          log('[WSL] claude-code not found');
          claudeCodeAvailable = false;
        }
      }

      // Check if Python and pip are available
      let pythonAvailable = false;
      let pipAvailable = false;
      let pythonVersion = '';
      try {
        const pythonResult = await execFileAsync(
          'wsl',
          ['-d', selectedDistro, '-e', 'python3', '--version'],
          { timeout: 10000, encoding: 'utf-8' }
        );
        const output = pythonResult.stdout.trim();
        if (output.startsWith('Python')) {
          pythonAvailable = true;
          pythonVersion = output;
          log('[WSL] Python found:', pythonVersion);

          // Also check if pip is available
          try {
            await execFileAsync(
              'wsl',
              ['-d', selectedDistro, '-e', 'python3', '-m', 'pip', '--version'],
              { timeout: 10000, encoding: 'utf-8' }
            );
            pipAvailable = true;
            log('[WSL] pip is available');
          } catch {
            log('[WSL] pip is NOT available (python3-pip not installed)');
            pipAvailable = false;
          }
        }
      } catch (error) {
        log('[WSL] Python not found');
        pythonAvailable = false;
      }

      const status: WSLStatus = {
        available: true,
        distro: selectedDistro,
        nodeAvailable,
        pythonAvailable,
        pipAvailable,
        claudeCodeAvailable,
        version: nodeVersion,
        pythonVersion,
      };

      log('[WSL] Status check complete:', JSON.stringify(status));
      return status;
    } catch (error) {
      log('[WSL] WSL not available:', (error as Error).message);
      return { available: false };
    }
  }

  /**
   * Test if WSL distro is working (can execute simple command)
   */
  static async testDistro(distro: string): Promise<boolean> {
    try {
      WSLBridge.validateDistroName(distro);
      const { stdout } = await execFileAsync('wsl', ['-d', distro, '-e', 'echo', 'OK'], {
        timeout: 10000,
        encoding: 'utf-8',
      });
      return stdout.trim() === 'OK';
    } catch (error) {
      const errMsg = (error as Error).message || '';
      if (errMsg.includes('E_UNEXPECTED') || errMsg.includes('4294967295')) {
        log('[WSL] Distro test failed - WSL service error. Try: wsl --shutdown');
      }
      return false;
    }
  }

  /**
   * Install Node.js in WSL
   */
  static async installNodeInWSL(distro: string): Promise<boolean> {
    WSLBridge.validateDistroName(distro);
    log('[WSL] Installing Node.js in WSL...');

    // First, test if WSL distro is working at all
    const distroWorks = await WSLBridge.testDistro(distro);
    if (!distroWorks) {
      logError('[WSL] Cannot execute commands in WSL. WSL service may need restart.');
      logError('[WSL] Try running: wsl --shutdown  (in PowerShell as Admin)');
      return false;
    }

    try {
      // Check if we can run sudo without password
      await execFileAsync('wsl', ['-d', distro, '-e', 'sudo', '-n', 'true'], { timeout: 5000 });
      log('[WSL] Passwordless sudo available, trying apt installation...');

      // Update package list and install Node.js via NodeSource
      const commands = [
        'sudo DEBIAN_FRONTEND=noninteractive apt-get update -y',
        'curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -',
        'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs',
      ];

      for (const cmd of commands) {
        log(`[WSL] Running: ${cmd}`);
        await execFileAsync('wsl', ['-d', distro, '-e', 'bash', '-c', cmd], {
          timeout: 300000,
          encoding: 'utf-8',
        });
      }

      // Verify installation
      const { stdout } = await execFileAsync('wsl', ['-d', distro, '-e', 'node', '--version'], {
        timeout: 5000,
        encoding: 'utf-8',
      });
      log('[WSL] Node.js installed via apt:', stdout.trim());
      return true;
    } catch (error) {
      logError('[WSL] Failed to install Node.js:', error);
      return false;
    }
  }

  /**
   * Install Python in WSL
   */
  static async installPythonInWSL(distro: string): Promise<boolean> {
    WSLBridge.validateDistroName(distro);
    log('[WSL] Installing Python in WSL...');

    try {
      // Try apt installation (Python is usually pre-installed or easily installable)
      // First check if we can run sudo
      try {
        await execFileAsync('wsl', ['-d', distro, '-e', 'sudo', '-n', 'true'], { timeout: 5000 });
      } catch {
        log('[WSL] Passwordless sudo not available for Python install');
        // Python might already be installed, just not python3
        // Try to use python3.x directly
      }

      // Install python3 and pip
      log('[WSL] Installing python3 and pip via apt...');
      await execFileAsync(
        'wsl',
        [
          '-d',
          distro,
          '-e',
          'bash',
          '-c',
          'sudo DEBIAN_FRONTEND=noninteractive apt-get update -y && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-pip python3-venv',
        ],
        { timeout: 180000, encoding: 'utf-8' }
      );

      // Create python symlink (many tools expect 'python' command)
      log('[WSL] Creating python symlink...');
      try {
        await execFileAsync(
          'wsl',
          [
            '-d',
            distro,
            '-e',
            'bash',
            '-c',
            'sudo ln -sf /usr/bin/python3 /usr/bin/python 2>/dev/null || true',
          ],
          { timeout: 10000, encoding: 'utf-8' }
        );
        log('[WSL] Created python -> python3 symlink');
      } catch {
        log('[WSL] Could not create python symlink (non-critical)');
      }

      // Verify installation
      const verifyResult = await execFileAsync(
        'wsl',
        ['-d', distro, '-e', 'python3', '--version'],
        { timeout: 10000, encoding: 'utf-8' }
      );

      const version = verifyResult.stdout.trim();
      if (version.startsWith('Python')) {
        log('[WSL] Python installed:', version);

        // Install commonly needed packages for skills (PDF, PPTX processing)
        await WSLBridge.installSkillDependencies(distro);

        return true;
      } else {
        log('[WSL] Python installation verification failed:', version);
        return false;
      }
    } catch (error) {
      logError('[WSL] Failed to install Python:', error);
      return false;
    }
  }

  /**
   * Install Python packages commonly needed by skills (PDF, PPTX, etc.)
   */
  static async installSkillDependencies(distro: string): Promise<void> {
    WSLBridge.validateDistroName(distro);
    log('[WSL] Installing skill dependencies (markitdown, pypdf, etc.)...');

    // These packages are required by the built-in PDF and PPTX skills
    const packages = [
      'markitdown[pptx]', // PDF/PPTX text extraction
      'pypdf', // PDF manipulation
      'pdfplumber', // PDF table extraction
      'reportlab', // PDF creation
      'defusedxml', // Secure XML parsing for OOXML
      'python-pptx', // PPTX manipulation
    ];

    try {
      // Install packages with pip (user install to avoid permission issues)
      const packagesStr = packages.map((p) => `"${p}"`).join(' ');
      await execFileAsync(
        'wsl',
        [
          '-d',
          distro,
          '-e',
          'bash',
          '-c',
          `set -o pipefail; python3 -m pip install --user ${packagesStr} 2>&1 | tail -5`,
        ],
        { timeout: 300000, encoding: 'utf-8' } // 5 min timeout for package install
      );
      log('[WSL] Skill dependencies installed successfully');
    } catch (error) {
      // Non-critical - Claude can install packages on demand
      log(
        '[WSL] Failed to pre-install skill dependencies (will install on demand):',
        (error as Error).message
      );
    }
  }

  /**
   * Install pip in WSL (when Python exists but pip doesn't)
   */
  static async installPipInWSL(distro: string): Promise<boolean> {
    WSLBridge.validateDistroName(distro);
    log('[WSL] Installing pip in WSL...');

    try {
      // Method 1: Try apt-get (requires sudo)
      try {
        await execFileAsync('wsl', ['-d', distro, '-e', 'sudo', '-n', 'true'], { timeout: 5000 });
        log('[WSL] Passwordless sudo available, installing python3-pip via apt...');
        await execFileAsync(
          'wsl',
          [
            '-d',
            distro,
            '-e',
            'bash',
            '-c',
            'sudo DEBIAN_FRONTEND=noninteractive apt-get update -y && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y python3-pip',
          ],
          { timeout: 180000, encoding: 'utf-8' }
        );
      } catch {
        log('[WSL] Passwordless sudo not available, trying get-pip.py...');
        // Method 2: Use get-pip.py (no sudo required for user install)
        await execFileAsync(
          'wsl',
          [
            '-d',
            distro,
            '-e',
            'bash',
            '-c',
            'curl -sSL https://bootstrap.pypa.io/get-pip.py | python3 - --user',
          ],
          { timeout: 120000, encoding: 'utf-8' }
        );
      }

      // Verify installation
      const verifyResult = await execFileAsync(
        'wsl',
        ['-d', distro, '-e', 'python3', '-m', 'pip', '--version'],
        { timeout: 10000, encoding: 'utf-8' }
      );

      const version = verifyResult.stdout.trim();
      if (version.includes('pip')) {
        log('[WSL] pip installed:', version);
        return true;
      } else {
        log('[WSL] pip installation verification failed:', version);
        return false;
      }
    } catch (error) {
      logError('[WSL] Failed to install pip:', error);
      return false;
    }
  }

  /**
   * Install claude-code in WSL
   */
  static async installClaudeCodeInWSL(distro: string): Promise<boolean> {
    WSLBridge.validateDistroName(distro);
    log('[WSL] Installing claude-code in WSL...');

    try {
      // Install with nvm environment (most common setup)
      log('[WSL] Installing claude-code via npm...');
      await execFileAsync(
        'wsl',
        [
          '-d',
          distro,
          '-e',
          'bash',
          '-c',
          'source ~/.nvm/nvm.sh 2>/dev/null; npm install -g @anthropic-ai/claude-code',
        ],
        { timeout: 180000, encoding: 'utf-8' }
      );

      // Verify installation
      const verifyResult = await execFileAsync(
        'wsl',
        ['-d', distro, '-e', 'bash', '-c', 'source ~/.nvm/nvm.sh 2>/dev/null; claude --version'],
        { timeout: 10000, encoding: 'utf-8' }
      );

      const version = verifyResult.stdout.trim();
      log('[WSL] claude-code installed:', version);
      return true;
    } catch (error) {
      logError('[WSL] Failed to install claude-code:', error);

      // Try with sudo as fallback (for system-installed node)
      try {
        log('[WSL] Trying claude-code install with sudo...');
        await execFileAsync(
          'wsl',
          ['-d', distro, '-e', 'sudo', 'npm', 'install', '-g', '@anthropic-ai/claude-code'],
          { timeout: 180000, encoding: 'utf-8' }
        );
        return true;
      } catch (sudoError) {
        logError('[WSL] Failed to install claude-code with sudo:', sudoError);
        return false;
      }
    }
  }

  /**
   * Get the path to the WSL agent script
   */
  private getAgentScriptPath(): string {
    const isPackaged = app.isPackaged;

    if (isPackaged) {
      // Production: in resources folder
      return path.join(process.resourcesPath || '', 'wsl-agent', 'index.js');
    } else {
      // Development: __dirname = dist-electron/main, need to go up 2 levels to project root
      return path.join(__dirname, '..', '..', 'dist-wsl-agent', 'index.js');
    }
  }

  /**
   * Initialize the WSL bridge
   */
  async initialize(config: SandboxConfig): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._initialize(config).catch((error) => {
      this.disconnectAgent(error instanceof Error ? error : new Error(String(error)));
      throw error;
    });
    return this.initPromise;
  }

  private async _initialize(config: SandboxConfig): Promise<void> {
    this.config = config;

    // Try to use cached status from bootstrap first (much faster)
    let status: WSLStatus;
    try {
      const bootstrap = await loadBootstrap();
      const cachedStatus = bootstrap.getCachedWSLStatus();
      if (cachedStatus && cachedStatus.available) {
        log('[WSL] Using cached status from bootstrap');
        status = cachedStatus;
      } else {
        log('[WSL] No cached status, checking WSL...');
        status = await WSLBridge.checkWSLStatus();
      }
    } catch {
      log('[WSL] Bootstrap not available, checking WSL...');
      status = await WSLBridge.checkWSLStatus();
    }

    if (!status.available) {
      throw new Error('WSL2 is not available on this system');
    }

    this.distro = status.distro || 'Ubuntu';
    log('[WSL] Using distro:', this.distro);

    // Dependencies should already be installed by bootstrap
    // Only install if bootstrap didn't run or failed
    if (!status.nodeAvailable) {
      log('[WSL] Node.js not found, installing...');
      const installed = await WSLBridge.installNodeInWSL(this.distro);
      if (!installed) {
        throw new Error('Failed to install Node.js in WSL');
      }
    }

    if (!status.pythonAvailable) {
      log('[WSL] Python not found, installing...');
      const installed = await WSLBridge.installPythonInWSL(this.distro);
      if (!installed) {
        log('[WSL] Failed to install Python in WSL (non-critical, continuing...)');
      }
    } else if (!status.pipAvailable) {
      log('[WSL] pip not found, installing...');
      const pipInstalled = await WSLBridge.installPipInWSL(this.distro);
      if (!pipInstalled) {
        log('[WSL] Failed to install pip in WSL (non-critical, continuing...)');
      }
    }

    if (!status.claudeCodeAvailable) {
      log('[WSL] claude-code not found in WSL (optional, Windows claude-code will be used)');
    }

    // Start the WSL agent process
    await this.startAgent();

    // Configure workspace
    const wslWorkspacePath = pathConverter.toWSL(config.workspacePath);
    await this.sendRequest('setWorkspace', {
      path: wslWorkspacePath,
      windowsPath: config.workspacePath,
    });

    this.isInitialized = true;
    log('[WSL] Bridge initialized successfully');
  }

  /**
   * Start the WSL agent process
   */
  private async startAgent(): Promise<void> {
    const agentPath = this.getAgentScriptPath();

    // Validate that agentPath contains an expected path segment
    const normalizedAgentPath = agentPath.replace(/\\/g, '/');
    if (
      !normalizedAgentPath.includes('/wsl-agent/') &&
      !normalizedAgentPath.includes('/dist-wsl-agent/')
    ) {
      throw new Error(`Agent path does not contain expected path segment: ${agentPath}`);
    }

    // Check if agent script exists
    if (!fs.existsSync(agentPath)) {
      // Copy agent to WSL-accessible location
      log('[WSL] Agent script not found at:', agentPath);
      throw new Error(`WSL agent script not found: ${agentPath}`);
    }

    // Convert agent path to WSL path
    const wslAgentPath = pathConverter.toWSL(agentPath);
    log('[WSL] Starting agent from:', wslAgentPath);

    // Pass the script path as an argument, not shell source. Valid Windows
    // installation folders can contain spaces, parentheses and apostrophes.
    const nodeCommand = 'source ~/.nvm/nvm.sh 2>/dev/null; exec node "$1"';
    const child = spawn(
      'wsl',
      ['-d', this.distro, '--', 'bash', '-c', nodeCommand, 'sophron-wsl-agent', wslAgentPath],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }
    );
    this.wslProcess = child;
    this.buffer = '';
    child.stdin?.on('error', (error) => {
      if (this.wslProcess === child) this.disconnectAgent(error);
    });

    // Handle stdout (JSON-RPC responses)
    const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB limit
    child.stdout?.on('data', (data: Buffer) => {
      if (this.wslProcess !== child) return;
      try {
        this.buffer += data.toString();
        if (this.buffer.length > MAX_BUFFER_SIZE) {
          logError('[WSL] Buffer size exceeded limit, disconnecting agent');
          this.buffer = '';
          this.wslProcess?.kill();
          return;
        }
        this.processBuffer();
      } catch (error) {
        logError('[WSL] Error processing stdout data:', error);
      }
    });

    // Handle stderr (logging)
    this.wslProcess.stderr?.on('data', (data: Buffer) => {
      log('[WSL Agent]', data.toString().trim());
    });

    // Reject startup immediately on spawn/exit errors; do not leave a polling
    // loop alive after a timeout or poison all subsequent initialize calls.
    child.on('exit', (code, signal) => {
      log('[WSL] Agent process exited:', { code, signal });
      if (this.wslProcess === child) this.disconnectAgent(new Error('WSL agent process exited'));
    });
    child.on('error', (error) => {
      logError('[WSL] Agent process error:', error);
      if (this.wslProcess === child) this.disconnectAgent(error);
    });
    // stdin buffers the ping until the agent is ready to read it.
    try {
      await this.sendRequest('ping', {}, 30000);
    } catch (error) {
      this.disconnectAgent(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }

    log('[WSL] Agent is ready');
  }

  private disconnectAgent(error: Error): void {
    const child = this.wslProcess;
    this.wslProcess = null;
    this.isInitialized = false;
    this.initPromise = null;
    this.buffer = '';
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
    child?.kill();
  }

  /**
   * Process incoming data buffer for complete JSON messages
   */
  private processBuffer(): void {
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response = JSON.parse(line) as JSONRPCResponse;
        const pending = this.pendingRequests.get(response.id);

        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(response.id);

          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (error) {
        logError('[WSL] Failed to parse response:', line, error);
      }
    }
  }

  /**
   * Send a JSON-RPC request to the WSL agent
   */
  private async sendRequest<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number = 60000
  ): Promise<T> {
    const child = this.wslProcess;
    if (!child?.stdin) {
      throw new Error('WSL agent not running');
    }

    const id = uuidv4();
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      child.stdin!.write(JSON.stringify(request) + '\n', (error) => {
        if (error && this.wslProcess === child) this.disconnectAgent(error);
      });
    });
  }

  /**
   * Execute a command in WSL
   */
  async executeCommand(
    command: string,
    cwd?: string,
    env?: Record<string, string>
  ): Promise<ExecutionResult> {
    if (!this.isInitialized) {
      throw new Error('WSL bridge not initialized');
    }

    // Convert cwd to WSL path if provided
    const wslCwd = cwd ? pathConverter.toWSL(cwd) : undefined;

    const result = await this.sendRequest<{
      code: number;
      stdout: string;
      stderr: string;
    }>(
      'executeCommand',
      {
        command,
        cwd: wslCwd,
        env,
      },
      this.config?.timeout || 60000
    );

    return {
      success: result.code === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
    };
  }

  /**
   * Read a file from WSL
   */
  async readFile(filePath: string): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('WSL bridge not initialized');
    }

    const wslPath = pathConverter.toWSL(filePath);
    const result = await this.sendRequest<{ content: string }>('readFile', {
      path: wslPath,
    });

    return result.content;
  }

  /**
   * Write a file in WSL
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('WSL bridge not initialized');
    }

    const wslPath = pathConverter.toWSL(filePath);
    await this.sendRequest('writeFile', {
      path: wslPath,
      content,
    });
  }

  /**
   * List directory contents
   */
  async listDirectory(dirPath: string): Promise<DirectoryEntry[]> {
    if (!this.isInitialized) {
      throw new Error('WSL bridge not initialized');
    }

    const wslPath = pathConverter.toWSL(dirPath);
    const result = await this.sendRequest<{ entries: DirectoryEntry[] }>('listDirectory', {
      path: wslPath,
    });

    return result.entries;
  }

  /**
   * Check if a file exists
   */
  async fileExists(filePath: string): Promise<boolean> {
    if (!this.isInitialized) {
      throw new Error('WSL bridge not initialized');
    }

    const wslPath = pathConverter.toWSL(filePath);
    const result = await this.sendRequest<{ exists: boolean }>('fileExists', {
      path: wslPath,
    });

    return result.exists;
  }

  /**
   * Delete a file
   */
  async deleteFile(filePath: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('WSL bridge not initialized');
    }

    const wslPath = pathConverter.toWSL(filePath);
    await this.sendRequest('deleteFile', { path: wslPath });
  }

  /**
   * Create a directory
   */
  async createDirectory(dirPath: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('WSL bridge not initialized');
    }

    const wslPath = pathConverter.toWSL(dirPath);
    await this.sendRequest('createDirectory', { path: wslPath });
  }

  /**
   * Copy a file
   */
  async copyFile(src: string, dest: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('WSL bridge not initialized');
    }

    const wslSrc = pathConverter.toWSL(src);
    const wslDest = pathConverter.toWSL(dest);
    await this.sendRequest('copyFile', { src: wslSrc, dest: wslDest });
  }

  /**
   * Run claude-code in WSL
   */
  async runClaudeCode(
    prompt: string,
    options: {
      cwd?: string;
      model?: string;
      maxTurns?: number;
      systemPrompt?: string;
      env?: Record<string, string>;
    } = {}
  ): Promise<AsyncIterable<unknown>> {
    if (!this.isInitialized) {
      throw new Error('WSL bridge not initialized');
    }

    const wslCwd = options.cwd ? pathConverter.toWSL(options.cwd) : undefined;

    // Streaming request support can be added here using uuidv4() for request tracking

    // This returns an async iterable that yields claude-code messages
    // Implementation would involve streaming responses from the agent
    // For now, we use a simple request/response pattern

    const result = await this.sendRequest<{ messages: unknown[] }>(
      'runClaudeCode',
      {
        prompt,
        cwd: wslCwd,
        model: options.model,
        maxTurns: options.maxTurns,
        systemPrompt: options.systemPrompt,
        env: options.env,
      },
      300000
    ); // 5 minute timeout for claude-code

    // Convert to async iterable
    return (async function* () {
      for (const msg of result.messages) {
        yield msg;
      }
    })();
  }

  /**
   * Shutdown the WSL bridge
   */
  async shutdown(): Promise<void> {
    if (this.wslProcess) {
      try {
        await this.sendRequest('shutdown', {}, 5000);
      } catch {
        // The agent may exit before acknowledging shutdown.
      }
    }
    this.disconnectAgent(new Error('WSL bridge shut down'));
    log('[WSL] Bridge shutdown complete');
  }

  /**
   * Get path converter for external use
   */
  getPathConverter(): PathConverter {
    return pathConverter;
  }

  /**
   * Check if bridge is initialized
   */
  get initialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Get current distro
   */
  get currentDistro(): string {
    return this.distro;
  }
}
