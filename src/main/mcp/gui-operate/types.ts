/**
 * Shared constants and types for the GUI operate MCP server modules.
 */
import * as os from 'os';
import * as path from 'path';

// Detect platform
export const PLATFORM = os.platform(); // 'darwin' for macOS, 'win32' for Windows

// Get sophron data directory for persistent storage
// Use platform-appropriate paths:
export const SOPHRON_DATA_DIR =
  PLATFORM === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'sophron')
    : path.join(os.homedir(), 'Library', 'Application Support', 'sophron');

// Directory for storing GUI operate files (screenshots, etc.)
export const GUI_OPERATE_DIR = path.join(SOPHRON_DATA_DIR, 'gui_operate');
export const SCREENSHOTS_DIR = path.join(GUI_OPERATE_DIR, 'screenshots');
export const SCREENSHOT_REUSE_WINDOW_MS = 5 * 60_000;
export const OPENAI_PLATFORM_BASE_URL = 'https://api.openai.com/v1';

export type ScreenshotCacheEntry = {
  displayIndex: number;
  regionKey: string;
  path: string;
  base64Image: string;
  capturedAt: number;
  displayInfo: { width: number; height: number; scaleFactor: number };
};

export interface ClickHistoryEntry {
  index: number;
  x: number; // Logical coordinates (runtime, scaled to current display)
  y: number;
  displayIndex: number;
  timestamp: number;
  operation: string; // 'click', 'double_click', 'right_click', etc.
  count: number; // Number of times this coordinate was clicked
  successCount: number; // Number of times this click led to successful operations
}

export interface DockItemInfo {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayInfo {
  index: number;
  name: string;
  isMain: boolean;
  width: number;
  height: number;
  originX: number; // Global coordinate origin X
  originY: number; // Global coordinate origin Y
  scaleFactor: number; // Retina scale factor
}

export interface DisplayConfiguration {
  displays: DisplayInfo[];
  totalWidth: number;
  totalHeight: number;
  mainDisplayIndex: number;
}
