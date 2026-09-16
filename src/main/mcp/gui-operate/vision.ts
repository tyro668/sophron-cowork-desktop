/**
 * Vision grounding for the GUI operate server: model API calls (with timeout
 * and runtime summary), screenshot annotation with click history, screenshot
 * analysis, point marking, and verify/extract helpers.
 */
import * as path from 'path';
import * as fs from 'fs/promises';
import { writeMCPLog } from '../mcp-logger.js';
import * as os from 'os';
import {
  PLATFORM,
  OPENAI_PLATFORM_BASE_URL,
  SCREENSHOTS_DIR,
  type ClickHistoryEntry,
} from './types.js';
import { executePython, executeCommandSafe } from './env.js';
import {
  buildGuiExtractionPrompt,
  buildGuiGroundingBoxPrompt,
  buildGuiOperationVerificationPrompt,
} from '../../prompts/gui-vision';
import {
  takeScreenshot,
  getReusableScreenshot,
  updateScreenshotCache,
  toRegionKey,
} from './actions.js';
import {
  ensureAppContextRestored,
  getClickHistoryForDisplay,
  clickHistory,
  currentAppName,
  lastClickEntry,
  saveLatestClickToHistory,
} from './click-history.js';
import { getDisplayConfiguration } from './display.js';
import { getFrontmostMacApplicationName } from './macos.js';
import {
  inferExpectedAppAliasesFromText,
  isLikelyAppLaunchVerification,
  appNameMatchesAliases,
} from './app-aliases.js';

export async function callVisionAPI(
  base64Image: string,
  prompt: string,
  maxTokens: number = 2048,
  functionName?: string
): Promise<string> {
  const MAX_RETRIES = 3;
  const TIMEOUT_MS = 90000; // 45 seconds

  const logPrefix = functionName ? `[callVisionAPI:${functionName}]` : '[callVisionAPI]';
  let compatibilityFallbackUsed = false;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      writeMCPLog(
        `${logPrefix} Attempt ${attempt}/${MAX_RETRIES} - Starting API call`,
        'API Request'
      );

      const result = await callVisionAPIWithTimeout(
        base64Image,
        prompt,
        maxTokens,
        functionName,
        TIMEOUT_MS
      );

      writeMCPLog(`${logPrefix} Attempt ${attempt}/${MAX_RETRIES} - Success`, 'API Request');
      return result;
    } catch (error: unknown) {
      const isLastAttempt = attempt === MAX_RETRIES;
      const errorMessage = String(error instanceof Error ? error.message : error || '');

      // Deterministic request-shape errors should fail fast instead of wasting retries.
      if (isVisionRequestShapeError(errorMessage)) {
        if (!compatibilityFallbackUsed) {
          compatibilityFallbackUsed = true;
          writeMCPLog(
            `${logPrefix} Attempt ${attempt}/${MAX_RETRIES} - Request-shape error detected, running one compatibility fallback: ${errorMessage}`,
            'API Request Error'
          );
          try {
            const compatResult = await callVisionAPIWithTimeout(
              base64Image,
              prompt,
              maxTokens,
              functionName,
              TIMEOUT_MS,
              true,
              errorMessage
            );
            writeMCPLog(`${logPrefix} Compatibility fallback succeeded`, 'API Request');
            return compatResult;
          } catch (compatError: unknown) {
            const compatMessage = String(
              compatError instanceof Error ? compatError.message : compatError || ''
            );
            writeMCPLog(
              `${logPrefix} Compatibility fallback failed: ${compatMessage}`,
              'API Request Error'
            );
            throw new Error(compatMessage || errorMessage);
          }
        }
        writeMCPLog(
          `${logPrefix} Attempt ${attempt}/${MAX_RETRIES} - Deterministic error, stop retry: ${errorMessage}`,
          'API Request Error'
        );
        throw new Error(errorMessage);
      }

      if (errorMessage.includes('timeout')) {
        writeMCPLog(
          `${logPrefix} Attempt ${attempt}/${MAX_RETRIES} - Timeout after ${TIMEOUT_MS}ms`,
          'API Request Error'
        );
      } else {
        writeMCPLog(
          `${logPrefix} Attempt ${attempt}/${MAX_RETRIES} - Error: ${errorMessage}`,
          'API Request Error'
        );
      }

      if (isLastAttempt) {
        writeMCPLog(`${logPrefix} All ${MAX_RETRIES} attempts failed`, 'API Request Failed');
        throw new Error(`Vision API failed after ${MAX_RETRIES} attempts: ${errorMessage}`);
      }

      // Wait before retry (exponential backoff: 1s, 2s, 4s)
      const waitTime = Math.pow(2, attempt - 1) * 1000;
      writeMCPLog(`${logPrefix} Waiting ${waitTime}ms before retry...`, 'API Request Retry');
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  throw new Error('Vision API failed: Maximum retries exceeded');
}

export function isVisionRequestShapeError(errorMessage: string): boolean {
  if (!errorMessage) {
    return false;
  }
  return (
    errorMessage.includes('Unsupported parameter') ||
    errorMessage.includes('Instructions are required') ||
    errorMessage.includes('Stream must be set to true')
  );
}

export function getBaseUrlHost(baseUrl: string | undefined): string {
  if (!baseUrl) {
    return '(unset)';
  }
  try {
    return new URL(baseUrl).host || '(unknown)';
  } catch {
    return '(invalid-url)';
  }
}

export function buildOpenAIChatCompletionsUrl(baseUrl: string | undefined): string {
  const rawBaseUrl = (baseUrl || OPENAI_PLATFORM_BASE_URL).trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(rawBaseUrl);
    const hostname = parsed.hostname.toLowerCase();
    let pathname = parsed.pathname.replace(/\/+$/, '');

    pathname = pathname
      .replace(/\/chat\/completions$/i, '')
      .replace(/\/completions$/i, '')
      .replace(/\/responses$/i, '')
      .replace(/\/+$/, '');

    if (hostname.includes('openrouter.ai')) {
      if (!pathname || pathname === '/') {
        pathname = '/api/v1';
      } else if (/^\/api$/i.test(pathname)) {
        pathname = '/api/v1';
      }
    } else if (hostname === 'api.openai.com') {
      if (!pathname || pathname === '/') {
        pathname = '/v1';
      }
    } else if (
      (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') &&
      parsed.port === '11434' &&
      (!pathname || pathname === '/')
    ) {
      pathname = '/v1';
    }

    parsed.pathname = `${pathname || ''}/chat/completions`.replace(/\/{2,}/g, '/');
    return parsed.toString();
  } catch {
    return rawBaseUrl.endsWith('/v1')
      ? `${rawBaseUrl}/chat/completions`
      : `${rawBaseUrl}/v1/chat/completions`;
  }
}

export function buildVisionRuntimeSummary(
  functionName: string | undefined,
  anthropicApiKey: string | undefined,
  openAIApiKey: string | undefined,
  baseUrl: string | undefined,
  model: string,
  isOpenAICompatible: boolean,
  compatibilityMode: boolean
): Record<string, unknown> {
  return {
    functionName: functionName || '(unknown)',
    hasAnthropicApiKey: Boolean(anthropicApiKey),
    hasOpenAIApiKey: Boolean(openAIApiKey),
    hasAnyApiKey: Boolean(anthropicApiKey || openAIApiKey),
    baseUrlHost: getBaseUrlHost(baseUrl),
    model,
    isOpenAICompatible,
    compatibilityMode,
  };
}

export function pickVisionApiKey(
  selectedRoute: 'openai-chat-completions' | 'anthropic-messages',
  anthropicApiKey: string | undefined,
  openAIApiKey: string | undefined,
  isOpenRouter: boolean
): string | undefined {
  if (selectedRoute === 'anthropic-messages') {
    return anthropicApiKey;
  }
  // OpenRouter historically reuses Anthropic-style key env vars.
  if (isOpenRouter) {
    return anthropicApiKey || openAIApiKey;
  }
  return openAIApiKey;
}

/**
 * Call vision API with timeout
 */
export async function callVisionAPIWithTimeout(
  base64Image: string,
  prompt: string,
  maxTokens: number,
  functionName: string | undefined,
  timeoutMs: number,
  compatibilityMode: boolean = false,
  previousErrorMessage?: string
): Promise<string> {
  // Get API configuration from environment (supports Anthropic/OpenRouter/OpenAI-compatible)
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  const openAIApiKey = process.env.OPENAI_API_KEY;
  const openAIBaseUrl = process.env.OPENAI_BASE_URL?.trim();
  const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL?.trim();
  const openAIModel = process.env.OPENAI_MODEL?.trim();
  const anthropicModel =
    process.env.CLAUDE_MODEL?.trim() || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL?.trim();
  // NOTE: OPENAI_API_KEY may be auto-hydrated for MCP subprocess compatibility.
  // Route inference must rely on semantic OpenAI hints (base/model), not key presence.
  const hasOpenAIConfig = Boolean(openAIBaseUrl || openAIModel);
  const baseUrl = openAIBaseUrl || anthropicBaseUrl;
  const model = openAIModel || anthropicModel || 'claude-sonnet-4-6';

  // Check if using OpenRouter
  const isOpenRouter =
    !!baseUrl && (baseUrl.includes('openrouter.ai') || baseUrl.includes('openrouter'));

  // Check if model/config is OpenAI-compatible (Gemini, GPT, etc.)
  const isOpenAICompatible =
    hasOpenAIConfig ||
    model.includes('gemini') ||
    model.includes('gpt-') ||
    model.includes('openai/') ||
    isOpenRouter ||
    (baseUrl ? baseUrl.includes('api.openai.com') : false);

  const runtimeSummary = buildVisionRuntimeSummary(
    functionName,
    anthropicApiKey,
    openAIApiKey,
    baseUrl,
    model,
    isOpenAICompatible,
    compatibilityMode
  );
  writeMCPLog(JSON.stringify(runtimeSummary), 'Vision Runtime');

  const selectedRoute = isOpenAICompatible ? 'openai-chat-completions' : 'anthropic-messages';
  writeMCPLog(
    `[Vision Routing] function=${functionName || '(unknown)'} route=${selectedRoute} host=${getBaseUrlHost(baseUrl)} model=${model}${previousErrorMessage ? ` previousError=${previousErrorMessage}` : ''}`,
    'Vision Routing'
  );

  const selectedApiKey = pickVisionApiKey(
    selectedRoute,
    anthropicApiKey,
    openAIApiKey,
    isOpenRouter
  );
  if (!selectedApiKey) {
    if (selectedRoute === 'anthropic-messages') {
      throw new Error(
        'Anthropic API key not configured. Please set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN.'
      );
    }
    throw new Error('OpenAI API key not configured for vision route. Please set OPENAI_API_KEY.');
  }

  if (isOpenAICompatible) {
    // Use OpenAI-compatible API format (for Gemini, GPT, etc. via OpenRouter)
    const openAIUrl = buildOpenAIChatCompletionsUrl(baseUrl);

    // Use Node.js built-in https module for better compatibility
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const https = require('https');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const http = require('http');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const url = require('url');

    const urlObj = new url.URL(openAIUrl);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const requestBodyObj: Record<string, unknown> = {
      model: model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64Image}`,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
      max_tokens: maxTokens,
    };

    const requestBody = JSON.stringify(requestBodyObj);

    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${selectedApiKey}`,
      'Content-Length': Buffer.byteLength(requestBody),
    };

    if (isOpenRouter) {
      headers['X-Title'] = 'sophron cowork';
    }

    return new Promise<string>((resolve, reject) => {
      // eslint-disable-next-line prefer-const
      let timeoutId: ReturnType<typeof setTimeout>;
      let isResolved = false;

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: headers,
        timeout: timeoutMs,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const req = httpModule.request(options, (res: any) => {
        let data = '';

        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });

        res.on('end', () => {
          if (isResolved) return;
          clearTimeout(timeoutId);

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              writeMCPLog(
                `[callVisionAPIWithTimeout] Response received, length: ${data.length}`,
                'API Response'
              );
              const jsonData = JSON.parse(data);
              const responseContent = jsonData.choices[0]?.message?.content || '';

              // Log the response
              const logLabel = functionName
                ? `Vision API Response [${functionName}]`
                : 'Vision API Response';
              writeMCPLog(responseContent, logLabel);

              isResolved = true;
              resolve(responseContent);
            } catch (e: unknown) {
              isResolved = true;
              reject(
                new Error(
                  `Failed to parse API response: ${e instanceof Error ? e.message : String(e)}`
                )
              );
            }
          } else {
            isResolved = true;
            reject(
              new Error(`API request failed: ${res.statusCode} ${res.statusMessage} - ${data}`)
            );
          }
        });
      });

      // Set timeout
      timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          req.destroy();
          reject(new Error(`API request timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      req.on('error', (error: Error) => {
        if (isResolved) return;
        clearTimeout(timeoutId);
        isResolved = true;
        reject(new Error(`API request error: ${error.message}`));
      });

      req.on('timeout', () => {
        if (isResolved) return;
        clearTimeout(timeoutId);
        isResolved = true;
        req.destroy();
        reject(new Error(`API request timeout after ${timeoutMs}ms`));
      });

      req.write(requestBody);
      req.end();
    });
  } else {
    // Use Anthropic API format
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropicRouteBaseUrl = anthropicBaseUrl || baseUrl;
    const anthropicRouteModel = anthropicModel || model;
    const anthropic = new Anthropic({
      apiKey: selectedApiKey,
      baseURL: anthropicRouteBaseUrl,
      timeout: timeoutMs,
    });

    // Wrap the API call with timeout promise
    const apiCallPromise = anthropic.messages.create({
      model: anthropicRouteModel,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`API request timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const message = await Promise.race([apiCallPromise, timeoutPromise]);

      const responseContent = message.content[0].type === 'text' ? message.content[0].text : '';

      // Log the response
      const logLabel = functionName
        ? `Vision API Response [${functionName}]`
        : 'Vision API Response';
      writeMCPLog(responseContent, logLabel);
      writeMCPLog(
        `[callVisionAPIWithTimeout] Response received, length: ${responseContent.length}`,
        'API Response'
      );

      return responseContent;
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('timeout')) {
        throw new Error(`API request timeout after ${timeoutMs}ms`);
      }
      throw error;
    }
  }
}

/**
 * Annotate screenshot with click history markers
 * Returns path to annotated image and click history info
 */

export async function annotateScreenshotWithClickHistory(
  screenshotPath: string,
  displayIndex: number
): Promise<{ annotatedPath: string; clickHistoryInfo: string }> {
  // If server restarted, restore last app context so click history markers are available.
  if (!currentAppName && clickHistory.length === 0) {
    await ensureAppContextRestored();
  }

  // Debug: Log the full click history array
  writeMCPLog(
    `[annotateScreenshot] Total clicks in history: ${clickHistory.length}`,
    'Click History Debug'
  );
  writeMCPLog(
    `[annotateScreenshot] Full click history: ${JSON.stringify(clickHistory)}`,
    'Click History Debug'
  );
  writeMCPLog(
    `[annotateScreenshot] Requested displayIndex: ${displayIndex}`,
    'Click History Debug'
  );

  const clickHistoryForDisplay = getClickHistoryForDisplay(displayIndex);

  writeMCPLog(
    `[annotateScreenshot] Filtered clicks for display ${displayIndex}: ${clickHistoryForDisplay.length}`,
    'Click History Debug'
  );

  if (clickHistoryForDisplay.length === 0) {
    // No click history, return original path
    return {
      annotatedPath: screenshotPath,
      clickHistoryInfo: 'No previous clicks recorded.',
    };
  }

  // Create annotated image path
  const timestamp = Date.now();
  const basename = path.basename(screenshotPath, '.png');
  const annotatedPath = path.join(
    path.dirname(screenshotPath),
    `${basename}_annotated_${timestamp}.png`
  );

  // Get image dimensions to calculate normalized coordinates
  const imageDims = await getImageDimensions(screenshotPath);

  // Get display configuration to handle Retina scaling
  const config = await getDisplayConfiguration();
  const targetDisplay = config.displays.find((d) => d.index === displayIndex);
  const rawScaleFactor = targetDisplay?.scaleFactor || 1;
  // On Windows, click coordinates are already in physical pixels (DPI-aware pipeline),
  // so no scaling is needed. On macOS, coordinates are logical and need scaleFactor.
  const scaleFactor = PLATFORM === 'win32' ? 1 : rawScaleFactor;

  writeMCPLog(
    `[annotateScreenshot] Image dimensions: ${imageDims.width}x${imageDims.height}, rawScaleFactor: ${rawScaleFactor}, effective: ${scaleFactor}`,
    'Image Info'
  );

  // Find the most recent click (highest timestamp) to display as #0
  const mostRecentClick = clickHistoryForDisplay.reduce(
    (latest, current) => (current.timestamp > latest.timestamp ? current : latest),
    clickHistoryForDisplay[0]
  );

  writeMCPLog(
    `[annotateScreenshot] Most recent click: (${mostRecentClick.x}, ${mostRecentClick.y}) at timestamp ${mostRecentClick.timestamp}`,
    'Click Sorting'
  );

  // Sort remaining clicks by weighted score (successCount * 2 + count), then by timestamp (descending) for same score
  // Exclude the most recent click from this sorting
  const remainingClicks = clickHistoryForDisplay.filter((click) => click !== mostRecentClick);
  const sortedClicks = remainingClicks.sort((a, b) => {
    const scoreA = (a.successCount || 0) * 2 + a.count;
    const scoreB = (b.successCount || 0) * 2 + b.count;

    if (scoreB !== scoreA) {
      return scoreB - scoreA; // Higher weighted score first
    }
    return b.timestamp - a.timestamp; // Newer timestamp first (for same score)
  });

  writeMCPLog(
    `[annotateScreenshot] Sorted ${sortedClicks.length} remaining clicks by weighted score (successCount*2 + count) and recency`,
    'Click Sorting'
  );

  // Filter out overlapping clicks - keep only clicks that are far enough apart
  // Maximum 9 markers to avoid cluttering the screenshot (including the #0 marker)
  const MIN_DISTANCE_PIXELS = 200; // Minimum distance between annotations (in pixels)
  // const MAX_MARKERS = 10; // Maximum number of markers to display (including #0)
  const MAX_MARKERS = 5;
  const filteredClicks: ClickHistoryEntry[] = [];

  // Always add the most recent click as #0
  filteredClicks.push(mostRecentClick);

  // Filter remaining clicks
  for (const entry of sortedClicks) {
    // Stop if we've reached the maximum number of markers
    if (filteredClicks.length >= MAX_MARKERS) {
      writeMCPLog(
        `[annotateScreenshot] Reached maximum of ${MAX_MARKERS} markers, stopping`,
        'Click Filtering'
      );
      break;
    }

    // Convert logical coordinates to pixel coordinates
    const pixelX = entry.x * scaleFactor;
    const pixelY = entry.y * scaleFactor;

    // Check if this click is too close to any already-selected click
    let tooClose = false;
    for (const selected of filteredClicks) {
      const selectedPixelX = selected.x * scaleFactor;
      const selectedPixelY = selected.y * scaleFactor;

      const distance = Math.sqrt(
        Math.pow(pixelX - selectedPixelX, 2) + Math.pow(pixelY - selectedPixelY, 2)
      );

      if (distance < MIN_DISTANCE_PIXELS) {
        tooClose = true;
        writeMCPLog(
          `[annotateScreenshot] Skipping click at (${entry.x}, ${entry.y}) - too close to (${selected.x}, ${selected.y}), distance: ${Math.round(distance)}px`,
          'Click Filtering'
        );
        break;
      }
    }

    if (!tooClose) {
      filteredClicks.push(entry);
    }
  }

  writeMCPLog(
    `[annotateScreenshot] Filtered clicks: ${clickHistoryForDisplay.length} -> ${filteredClicks.length} (removed overlapping, max ${MAX_MARKERS})`,
    'Click Filtering'
  );

  // Renumber the filtered clicks with consecutive indices starting from 0
  // The first click (most recent) gets #0, then #1, #2, #3...
  const uniqueClicks = filteredClicks.map((entry, index) => ({
    ...entry,
    displayIndex_original: entry.displayIndex, // Keep original display index
    displayNumber: index, // New consecutive number for display (0, 1, 2, 3...)
  }));

  writeMCPLog(
    `[annotateScreenshot] Renumbered ${uniqueClicks.length} clicks with consecutive indices 0-${uniqueClicks.length - 1} (most recent click is #0)`,
    'Click Renumbering'
  );

  // Build click history info text with normalized coordinates
  const historyLines = uniqueClicks.map((entry) => {
    // Convert logical coordinates to pixel coordinates for the screenshot
    const pixelX = entry.x * scaleFactor;
    const pixelY = entry.y * scaleFactor;

    // Calculate normalized coordinates (0-1000)
    const normX = Math.round((pixelX / imageDims.width) * 1000);
    const normY = Math.round((pixelY / imageDims.height) * 1000);

    return `  #${entry.displayNumber}: [${normY}, ${normX}] (logical: ${entry.x}, ${entry.y}) - ${entry.operation}`;
  });
  const clickHistoryInfo = `Previous clicks on this display (normalized to 0-1000, sorted by frequency):\n${historyLines.join('\n')}`;

  // Create Python script to annotate image
  // Pass image dimensions and scale factor to Python
  const pythonScript = `
import sys
import json
from PIL import Image, ImageDraw, ImageFont

try:
    # Load image
    img = Image.open(json.loads(${JSON.stringify(JSON.stringify(screenshotPath.replace(/\\/g, '/')))}))
    img_width, img_height = img.size
    scale_factor = ${scaleFactor}
    
    # Create a semi-transparent overlay for drawing
    overlay = Image.new('RGBA', img.size, (255, 255, 255, 0))
    draw = ImageDraw.Draw(overlay)
    
    # Try to use a nice font, fallback to default
    # Platform-specific font paths
    import platform
    font = None
    small_font = None
    
    if platform.system() == 'Windows':
        # Windows fonts
        font_paths = [
            'C:/Windows/Fonts/arial.ttf',
            'C:/Windows/Fonts/segoeui.ttf',
            'C:/Windows/Fonts/tahoma.ttf',
        ]
    else:
        # macOS fonts
        font_paths = [
            '/System/Library/Fonts/Helvetica.ttc',
            '/System/Library/Fonts/SFNSDisplay.ttf',
            '/Library/Fonts/Arial.ttf',
        ]
    
    for font_path in font_paths:
        try:
            font = ImageFont.truetype(font_path, 32)
            small_font = ImageFont.truetype(font_path, 20)
            break
        except:
            continue
    
    if font is None:
        font = ImageFont.load_default()
        small_font = ImageFont.load_default()
    
    # Draw markers for each click
    clicks = ${JSON.stringify(uniqueClicks)}
    
    for click in clicks:
        # Logical coordinates from click history
        logical_x, logical_y = click['x'], click['y']
        display_number = click['displayNumber']  # Use the renumbered consecutive index
        
        # Convert logical coordinates to pixel coordinates for drawing
        pixel_x = int(logical_x * scale_factor)
        pixel_y = int(logical_y * scale_factor)
        
        # Calculate normalized coordinates (0-1000) for display
        norm_x = round((pixel_x / img_width) * 1000)
        norm_y = round((pixel_y / img_height) * 1000)
        
        # Draw circle with semi-transparent fill and bright outline
        radius = 20
        # Semi-transparent yellow fill
        draw.ellipse(
            [(pixel_x - radius, pixel_y - radius), (pixel_x + radius, pixel_y + radius)],
            fill=(255, 255, 0, 60),  # Yellow with 60/255 opacity
            outline=(255, 200, 0, 255),  # Bright orange outline, fully opaque
            width=3
        )
        
        # Draw crosshair (the exact click position) - bright and visible
        cross_size = 12
        draw.line(
            [(pixel_x - cross_size, pixel_y), (pixel_x + cross_size, pixel_y)], 
            fill=(255, 0, 0, 255),  # Bright red, fully opaque
            width=2
        )
        draw.line(
            [(pixel_x, pixel_y - cross_size), (pixel_x, pixel_y + cross_size)], 
            fill=(255, 0, 0, 255),  # Bright red, fully opaque
            width=2
        )
        
        # Draw center dot for extra visibility
        dot_radius = 3
        draw.ellipse(
            [(pixel_x - dot_radius, pixel_y - dot_radius), (pixel_x + dot_radius, pixel_y + dot_radius)],
            fill=(255, 0, 0, 255)  # Bright red dot
        )
        
        # Draw number label with NORMALIZED coordinates (0-1000)
        label = f"#{display_number}"
        coord_label = f"[{norm_y},{norm_x}]"
        
        # Get text bounding boxes
        bbox_num = draw.textbbox((0, 0), label, font=font)
        bbox_coord = draw.textbbox((0, 0), coord_label, font=small_font)
        
        num_width = bbox_num[2] - bbox_num[0]
        num_height = bbox_num[3] - bbox_num[1]
        coord_width = bbox_coord[2] - bbox_coord[0]
        coord_height = bbox_coord[3] - bbox_coord[1]
        
        # Use the wider of the two labels for background width
        max_width = max(num_width, coord_width)
        total_height = num_height + coord_height + 4  # 4px spacing between lines
        
        # Position label above and to the right of the marker
        label_x = pixel_x + radius + 8
        label_y = pixel_y - radius - total_height - 8
        
        # Ensure label stays within image bounds
        if label_x + max_width + 10 > img_width:
            label_x = pixel_x - radius - max_width - 18
        if label_y < 0:
            label_y = pixel_y + radius + 8
        
        # Draw semi-transparent background rectangle with border
        padding = 4
        # Background with transparency
        draw.rectangle(
            [
                (label_x - padding, label_y - padding),
                (label_x + max_width + padding, label_y + total_height + padding)
            ],
            fill=(0, 0, 0, 180),  # Black with 180/255 opacity
            outline=(255, 200, 0, 255),  # Orange border
            width=2
        )
        
        # Draw number text in bright yellow
        draw.text((label_x, label_y), label, fill=(255, 255, 0, 255), font=font)
        
        # Draw normalized coordinate text below the number in white
        coord_y = label_y + num_height + 2
        draw.text((label_x, coord_y), coord_label, fill=(255, 255, 255, 255), font=small_font)
    
    # Convert back to RGB and composite with original image
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    img = Image.alpha_composite(img, overlay)
    img = img.convert('RGB')
    
    # Save annotated image
    img.save('${annotatedPath.replace(/\\/g, '/').replace(/'/g, "\\'")}')
    print('SUCCESS')
    
except Exception as e:
    print(f'ERROR: {str(e)}', file=sys.stderr)
    sys.exit(1)
`.trim();

  try {
    const result = await executePython(pythonScript, 20000);

    if (result.stdout.includes('SUCCESS')) {
      writeMCPLog(
        `[annotateScreenshot] Successfully annotated screenshot with ${clickHistoryForDisplay.length} click markers`,
        'Screenshot Annotation'
      );
      writeMCPLog(
        `[annotateScreenshot] Annotated image saved to: ${annotatedPath}`,
        'Screenshot Annotation'
      );
      return { annotatedPath, clickHistoryInfo };
    } else {
      writeMCPLog(
        `[annotateScreenshot] Python script did not return SUCCESS: ${result.stdout}`,
        'Screenshot Annotation Error'
      );
      throw new Error('Failed to annotate screenshot');
    }
  } catch (error: unknown) {
    writeMCPLog(
      `[annotateScreenshot] Error annotating screenshot: ${error instanceof Error ? error.message : String(error)}`,
      'Screenshot Annotation Error'
    );
    // Fallback: return original path if annotation fails
    return {
      annotatedPath: screenshotPath,
      clickHistoryInfo,
    };
  }
}

/**
 * Analyze screenshot with vision model to locate element
 */
export async function analyzeScreenshotWithVision(
  screenshotPath: string,
  elementDescription: string,
  displayIndex?: number
): Promise<{
  x: number;
  y: number;
  confidence: number;
  displayIndex: number;
  boundingBox?: { left: number; top: number; right: number; bottom: number };
}> {
  try {
    // Get display configuration for coordinate system info
    const config = await getDisplayConfiguration();
    const targetDisplay =
      displayIndex !== undefined
        ? config.displays.find((d) => d.index === displayIndex)
        : config.displays.find((d) => d.isMain);

    if (!targetDisplay) {
      throw new Error(`Display index ${displayIndex} not found`);
    }

    // Annotate screenshot with click history
    const { annotatedPath, clickHistoryInfo } = await annotateScreenshotWithClickHistory(
      screenshotPath,
      targetDisplay.index
    );

    // const annotatedPath = screenshotPath;

    writeMCPLog(
      `[analyzeScreenshotWithVision] Using screenshot: ${annotatedPath}`,
      'Screenshot Selection'
    );
    writeMCPLog(
      `[analyzeScreenshotWithVision] Click history: ${clickHistoryInfo}`,
      'Click History'
    );

    // Read annotated screenshot as base64
    const imageBuffer = await fs.readFile(annotatedPath);
    const base64Image = imageBuffer.toString('base64');

    // Get image dimensions
    const imageDims = await getImageDimensions(annotatedPath);

    const prompt = buildGuiGroundingBoxPrompt(elementDescription);

    writeMCPLog(`[analyzeScreenshotWithVision] Prompt: ${prompt}`);

    const responseText = await callVisionAPI(
      base64Image,
      prompt,
      20000,
      'analyzeScreenshotWithVision'
    );
    writeMCPLog(
      `[analyzeScreenshotWithVision] Raw Response Length: ${responseText.length}`,
      'Response'
    );
    writeMCPLog(
      `[analyzeScreenshotWithVision] Raw Response (first 500 chars): ${responseText.substring(0, 500)}`,
      'Response Preview'
    );

    // Parse the response
    let jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      writeMCPLog(
        `[analyzeScreenshotWithVision] No JSON found with simple regex, trying code block pattern`,
        'Parse Attempt'
      );
      const codeBlockMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        jsonMatch = [codeBlockMatch[1]];
        writeMCPLog(
          `[analyzeScreenshotWithVision] Found JSON in code block, length: ${jsonMatch[0].length}`,
          'Parse Success'
        );
      }
    } else {
      writeMCPLog(
        `[analyzeScreenshotWithVision] Found JSON with simple regex, length: ${jsonMatch[0].length}`,
        'Parse Success'
      );
    }

    if (!jsonMatch) {
      writeMCPLog(
        `[analyzeScreenshotWithVision] Failed to find JSON in response. Full response: ${responseText}`,
        'Parse Error'
      );
      throw new Error('Failed to parse vision model response: No JSON found in response');
    }

    let result;
    try {
      writeMCPLog(
        `[analyzeScreenshotWithVision] Attempting to parse JSON (first 200 chars): ${jsonMatch[0].substring(0, 200)}`,
        'JSON Parse'
      );
      result = JSON.parse(jsonMatch[0]);
      writeMCPLog(`[analyzeScreenshotWithVision] JSON parsed successfully`, 'JSON Parse Success');
    } catch (parseError: unknown) {
      writeMCPLog(
        `[analyzeScreenshotWithVision] JSON parse failed: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        'JSON Parse Error'
      );
      writeMCPLog(
        `[analyzeScreenshotWithVision] JSON string that failed to parse: ${jsonMatch[0]}`,
        'JSON Parse Error'
      );
      throw new Error(
        `Failed to parse JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}. JSON string: ${jsonMatch[0].substring(0, 500)}`
      );
    }

    // Validate that box_2d exists and is an array
    if (!result.box_2d || !Array.isArray(result.box_2d) || result.box_2d.length !== 4) {
      writeMCPLog(
        `[analyzeScreenshotWithVision] Invalid box_2d in response: ${JSON.stringify(result)}`,
        'Parse Error'
      );
      throw new Error(
        'Vision response missing or invalid box_2d field. Expected format: [ymin, xmin, ymax, xmax]'
      );
    }

    // Extract normalized coordinates (0-1000 range)
    // Format: [ymin, xmin, ymax, xmax]
    const [ymin_norm, xmin_norm, ymax_norm, xmax_norm] = result.box_2d;

    writeMCPLog(
      `[analyzeScreenshotWithVision] Normalized box (0-1000): [ymin=${ymin_norm}, xmin=${xmin_norm}, ymax=${ymax_norm}, xmax=${xmax_norm}]`,
      'Normalized Coordinates'
    );

    // Convert normalized coordinates (0-1000) to pixel coordinates
    // Image dimensions: imageDims.width x imageDims.height
    const xmin_pixel = Math.round((xmin_norm / 1000) * imageDims.width);
    const ymin_pixel = Math.round((ymin_norm / 1000) * imageDims.height);
    const xmax_pixel = Math.round((xmax_norm / 1000) * imageDims.width);
    const ymax_pixel = Math.round((ymax_norm / 1000) * imageDims.height);

    writeMCPLog(
      `[analyzeScreenshotWithVision] Pixel coordinates: xmin=${xmin_pixel}, ymin=${ymin_pixel}, xmax=${xmax_pixel}, ymax=${ymax_pixel}`,
      'Pixel Coordinates'
    );
    writeMCPLog(
      `[analyzeScreenshotWithVision] Image dimensions: ${imageDims.width}x${imageDims.height}`,
      'Image Info'
    );

    // Calculate center point from bounding box (in pixel space)
    const pixelCenterX = Math.round((xmin_pixel + xmax_pixel) / 2);
    const pixelCenterY = Math.round((ymin_pixel + ymax_pixel) / 2);

    writeMCPLog(
      `[analyzeScreenshotWithVision] Calculated center from bounding box (pixels): x=${pixelCenterX}, y=${pixelCenterY}`,
      'Center Calculation'
    );

    // Convert from pixel coordinates to logical coordinates
    // On macOS Retina displays (scaleFactor=2), screenshots are 2x the logical resolution,
    // and cliclick uses logical coordinates, so we must divide by scaleFactor.
    // On Windows, the entire pipeline (display config, screenshot, SetCursorPos) works in
    // physical pixels (DPI-aware), so no division is needed (effectiveScaleFactor = 1).
    const rawScaleFactor = targetDisplay.scaleFactor || 1;
    const effectiveScaleFactor = PLATFORM === 'win32' ? 1 : rawScaleFactor;
    writeMCPLog(
      `[analyzeScreenshotWithVision] Display scaleFactor: ${rawScaleFactor}, effective (platform=${PLATFORM}): ${effectiveScaleFactor}`,
      'Coordinate Conversion'
    );

    const logicalX = pixelCenterX / effectiveScaleFactor;
    const logicalY = pixelCenterY / effectiveScaleFactor;

    writeMCPLog(
      `[analyzeScreenshotWithVision] Logical coordinates for cliclick: x=${logicalX}, y=${logicalY}`,
      'Coordinate Conversion'
    );

    return {
      x: Math.round(logicalX),
      y: Math.round(logicalY),
      confidence: result.confidence || 0,
      displayIndex: targetDisplay.index,
      boundingBox: {
        left: xmin_pixel,
        top: ymin_pixel,
        right: xmax_pixel,
        bottom: ymax_pixel,
      },
    };
  } catch (error: unknown) {
    throw new Error(
      `Vision analysis failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Mark a point on an image with a visual indicator
 * Creates a copy of the image with a red circle and crosshair at the specified coordinates
 * Optionally draws a bounding box if provided
 * Uses Python PIL/Pillow for cross-platform compatibility
 */
export async function markPointOnImage(
  imagePath: string,
  x: number,
  y: number,
  outputPath?: string,
  boundingBox?: { left: number; top: number; right: number; bottom: number }
): Promise<string> {
  const markedPath = outputPath || imagePath.replace(/\.png$/, '_marked.png');

  try {
    // Build bounding box parameters for Python script
    const bboxParams = boundingBox
      ? `bbox = {"left": ${boundingBox.left}, "top": ${boundingBox.top}, "right": ${boundingBox.right}, "bottom": ${boundingBox.bottom}}`
      : `bbox = None`;

    const pythonScript = `
try:
    from PIL import Image, ImageDraw

    # Load image
    img = Image.open("${imagePath.replace(/\\/g, '\\\\')}")
    draw = ImageDraw.Draw(img)

    # Bounding box (if provided)
    ${bboxParams}

    # Draw bounding box if provided
    if bbox:
        draw.rectangle([bbox["left"], bbox["top"], bbox["right"], bbox["bottom"]], outline='green', width=2)

    # Draw center point markers
    x, y = ${x}, ${y}
    radius = 20
    draw.ellipse([x - radius, y - radius, x + radius, y + radius], outline='red', width=3)

    # Draw crosshair
    draw.line([x - 30, y, x + 30, y], fill='red', width=2)
    draw.line([x, y - 30, x, y + 30], fill='red', width=2)

    # Draw center point
    draw.ellipse([x - 2, y - 2, x + 2, y + 2], fill='red')

    # Save marked image
    img.save("${markedPath.replace(/\\/g, '\\\\')}")
    print(f"Success: Marked image saved to ${markedPath.replace(/\\/g, '\\\\')}")
except ImportError:
    print("Error: PIL/Pillow not installed. Install with: pip install Pillow")
    exit(1)
except Exception as e:
    print(f"Error: {e}")
    exit(1)
    `.trim();

    const result = await executePython(pythonScript, 5000);

    if (result.stdout.includes('Success')) {
      const markInfo = boundingBox
        ? `point (${x}, ${y}) with bounding box [${boundingBox.left}, ${boundingBox.top}, ${boundingBox.right}, ${boundingBox.bottom}]`
        : `point (${x}, ${y})`;
      writeMCPLog(
        `[markPointOnImage] Marked ${markInfo} on image, saved to: ${markedPath}`,
        'Image Marking'
      );
      return markedPath;
    } else {
      throw new Error(result.stdout || result.stderr || 'Unknown error');
    }
  } catch (error: unknown) {
    writeMCPLog(
      `[markPointOnImage] Could not mark image: ${error instanceof Error ? error.message : String(error)}`,
      'Image Marking Warning'
    );
    writeMCPLog(
      `[markPointOnImage] To enable image marking, install Pillow: pip3 install Pillow`,
      'Image Marking Warning'
    );
    return imagePath; // Return original path if marking fails
  }
}

/**
 * Get image dimensions
 */
export async function getImageDimensions(
  imagePath: string
): Promise<{ width: number; height: number }> {
  try {
    // Use sips on macOS to get image dimensions
    const platform = os.platform();

    if (platform === 'darwin') {
      // Use absolute path because packaged apps may have a limited PATH.
      const { stdout } = await executeCommandSafe('/usr/bin/sips', [
        '-g',
        'pixelWidth',
        '-g',
        'pixelHeight',
        imagePath,
      ]);
      const widthMatch = stdout.match(/pixelWidth:\s*(\d+)/);
      const heightMatch = stdout.match(/pixelHeight:\s*(\d+)/);

      if (widthMatch && heightMatch) {
        return {
          width: parseInt(widthMatch[1]),
          height: parseInt(heightMatch[1]),
        };
      }
    }

    // Fallback: read PNG dimensions from file header
    const buffer = await fs.readFile(imagePath);
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      // PNG file
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }

    throw new Error('Could not determine image dimensions');
  } catch (error: unknown) {
    void error; // intentionally empty - fall through to display dimensions fallback
    const config = await getDisplayConfiguration();
    const mainDisplay = config.displays.find((d) => d.isMain) || config.displays[0];
    return { width: mainDisplay.width, height: mainDisplay.height };
  }
}

/**
 * Plan GUI actions based on natural language task description
 * Returns a step-by-step plan for executing the task
 */

export async function verifyGUIState(question: string, displayIndex?: number): Promise<string> {
  // Supported on both macOS and Windows
  if (PLATFORM !== 'darwin' && PLATFORM !== 'win32') {
    throw new Error(`GUI verification is not supported on platform: ${PLATFORM}`);
  }

  const normalizedDisplayIndex = displayIndex ?? 0;
  const regionKey = toRegionKey(undefined);
  const reusable = getReusableScreenshot(normalizedDisplayIndex, regionKey);

  let screenshotPath: string;
  let base64Image: string;

  if (reusable) {
    screenshotPath = reusable.path;
    base64Image = reusable.base64Image;
    writeMCPLog(
      `[verifyGUIState] Reusing recent screenshot captured ${Date.now() - reusable.capturedAt}ms ago: ${reusable.path}`,
      'Screenshot Reuse'
    );
  } else {
    screenshotPath = path.join(SCREENSHOTS_DIR, `gui_verify_${Date.now()}.png`);
    await takeScreenshot(screenshotPath, displayIndex);
    const imageBuffer = await fs.readFile(screenshotPath);
    base64Image = imageBuffer.toString('base64');

    const config = await getDisplayConfiguration();
    const display =
      config.displays.find((d) => d.index === normalizedDisplayIndex) || config.displays[0];
    updateScreenshotCache({
      displayIndex: normalizedDisplayIndex,
      regionKey,
      path: screenshotPath,
      base64Image,
      capturedAt: Date.now(),
      displayInfo: {
        width: display.width,
        height: display.height,
        scaleFactor: display.scaleFactor,
      },
    });
  }

  const prompt = buildGuiOperationVerificationPrompt(question);

  let answer = await callVisionAPI(base64Image, prompt, 20000, 'verifyGUIState');
  writeMCPLog(`[verifyGUIState] Response Length: ${answer.length}`, 'Response');
  writeMCPLog(
    `[verifyGUIState] Response (first 500 chars): ${answer.substring(0, 500)}`,
    'Response Preview'
  );

  // Parse the operation success judgment
  let operationSuccess = false;
  const successMatch = answer.match(
    /\*\*Operation Success Judgment:\*\*[\s\S]*?Status:\s*(SUCCESS|FAILURE)/i
  );
  if (successMatch) {
    operationSuccess = successMatch[1].toUpperCase() === 'SUCCESS';
    writeMCPLog(
      `[verifyGUIState] Parsed operation success: ${operationSuccess}`,
      'Success Parsing'
    );

    // If operation was successful and we have a recent click, increment its successCount
    if (operationSuccess && lastClickEntry) {
      lastClickEntry.successCount = (lastClickEntry.successCount || 0) + 1;
      writeMCPLog(
        `[verifyGUIState] Incremented successCount for click at (${lastClickEntry.x}, ${lastClickEntry.y}) to ${lastClickEntry.successCount}`,
        'Success Tracking'
      );

      // Save the updated click history to disk
      await saveLatestClickToHistory(lastClickEntry, { incrementCount: false });
    }
  } else {
    writeMCPLog(
      `[verifyGUIState] Could not parse operation success judgment from response`,
      'Success Parsing Warning'
    );
  }

  // Cross-check with macOS frontmost app for app-open verification style questions.
  // This prevents false-positive "SUCCESS" when the wrong app is actually focused.
  if (PLATFORM === 'darwin') {
    const expectedAliases = inferExpectedAppAliasesFromText(question);
    const requiresForegroundMatch = isLikelyAppLaunchVerification(question);

    if (expectedAliases.length > 0 && requiresForegroundMatch) {
      const frontmostApp = await getFrontmostMacApplicationName();
      if (frontmostApp) {
        const frontmostMatched = appNameMatchesAliases(frontmostApp, expectedAliases);
        writeMCPLog(
          `[verifyGUIState] Frontmost app cross-check. frontmost="${frontmostApp}", expectedAliases=${JSON.stringify(expectedAliases)}, matched=${frontmostMatched}`,
          'Success Parsing'
        );

        if (operationSuccess && !frontmostMatched) {
          operationSuccess = false;
          answer += `\n\n[System Cross-check] Frontmost app is "${frontmostApp}", which does not match the expected target app from the question.`;
          writeMCPLog(
            `[verifyGUIState] Overrode operationSuccess to false due to frontmost app mismatch.`,
            'Success Parsing Warning'
          );
        }
      }
    }
  }

  // Keep success parsing internal; strip the judgment block from user-visible answer text.
  answer = stripOperationSuccessJudgmentBlock(answer);

  return JSON.stringify({
    success: true,
    question,
    answer,
    operationSuccess,
    screenshot_path: screenshotPath,
    displayIndex: normalizedDisplayIndex,
  });
}

export function stripOperationSuccessJudgmentBlock(answer: string): string {
  if (!answer) {
    return answer;
  }

  const normalized = answer.replace(/\r\n/g, '\n');
  const patterns = [
    /\n?\*\*Operation Success Judgment:\*\*[\s\S]*?(?:- Status:\s*(?:SUCCESS|FAILURE)[\s\S]*?(?:\n{2,}|$))/gi,
    /\n?Operation Success Judgment:\s*[\s\S]*?(?:Status:\s*(?:SUCCESS|FAILURE)[\s\S]*?(?:\n{2,}|$))/gi,
  ];

  let stripped = normalized;
  for (const pattern of patterns) {
    stripped = stripped.replace(pattern, '\n\n');
  }
  return stripped.replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractGUIInfo(
  extractionPrompt: string,
  displayIndex?: number
): Promise<string> {
  // Supported on both macOS and Windows
  if (PLATFORM !== 'darwin' && PLATFORM !== 'win32') {
    throw new Error(`GUI extraction is not supported on platform: ${PLATFORM}`);
  }

  // Take screenshot
  const screenshotPath = path.join(SCREENSHOTS_DIR, `gui_extract_${Date.now()}.png`);
  await takeScreenshot(screenshotPath, displayIndex);

  // Analyze with vision model
  const imageBuffer = await fs.readFile(screenshotPath);
  const base64Image = imageBuffer.toString('base64');

  const prompt = buildGuiExtractionPrompt(extractionPrompt);

  const extractedInfo = await callVisionAPI(base64Image, prompt, 30000, 'extractGUIInfo');
  writeMCPLog(`[extractGUIInfo] Response Length: ${extractedInfo.length}`, 'Response');
  writeMCPLog(
    `[extractGUIInfo] Response (first 500 chars): ${extractedInfo.substring(0, 500)}`,
    'Response Preview'
  );

  return JSON.stringify({
    success: true,
    extraction_prompt: extractionPrompt,
    extracted_info: extractedInfo,
    screenshot_path: screenshotPath,
    displayIndex: displayIndex ?? 'all',
  });
}
