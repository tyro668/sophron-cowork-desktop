/**
 * Action planning and element location: turns natural-language goals into
 * action plans, grounds elements via the vision model, and executes action
 * steps (including vision-based interaction fallbacks).
 */
import * as path from 'path';
import * as fs from 'fs/promises';
import { writeMCPLog } from '../mcp-logger.js';
import { PLATFORM, SCREENSHOTS_DIR } from './types.js';
import { buildGuiActionPlanPrompt } from '../../prompts/gui-vision';
import {
  performClick,
  performType,
  performKeyPress,
  takeScreenshot,
  moveMouse,
} from './actions.js';
import {
  callVisionAPI,
  analyzeScreenshotWithVision,
  markPointOnImage,
  getImageDimensions,
} from './vision.js';
import { getDisplayConfiguration } from './display.js';
import { tryLocateElementInDockByAccessibility } from './macos.js';

export async function planGUIActions(
  taskDescription: string,
  displayIndex?: number
): Promise<{
  steps: Array<{
    step: number;
    action: string;
    element_description: string;
    value?: string;
    reasoning: string;
  }>;
  summary?: string;
}> {
  // Supported on both macOS and Windows
  if (PLATFORM !== 'darwin' && PLATFORM !== 'win32') {
    throw new Error(`GUI action planning is not supported on platform: ${PLATFORM}`);
  }

  // Take screenshot to understand current GUI state
  const screenshotPath = path.join(SCREENSHOTS_DIR, `gui_plan_${Date.now()}.png`);
  await takeScreenshot(screenshotPath, displayIndex);

  // Get image dimensions
  const imageDims = await getImageDimensions(screenshotPath);

  // Read screenshot as base64
  const imageBuffer = await fs.readFile(screenshotPath);
  const base64Image = imageBuffer.toString('base64');

  const prompt = buildGuiActionPlanPrompt({
    taskDescription,
    imageWidth: imageDims.width,
    imageHeight: imageDims.height,
  });

  const responseText = await callVisionAPI(base64Image, prompt, 20000, 'planGUIActions');
  writeMCPLog(`[planGUIActions] Raw Response Length: ${responseText.length}`, 'Response');
  writeMCPLog(
    `[planGUIActions] Raw Response (first 500 chars): ${responseText.substring(0, 500)}`,
    'Response Preview'
  );

  // Parse the response
  let jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    writeMCPLog(
      `[planGUIActions] No JSON found with simple regex, trying code block pattern`,
      'Parse Attempt'
    );
    const codeBlockMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
      jsonMatch = [codeBlockMatch[1]];
      writeMCPLog(
        `[planGUIActions] Found JSON in code block, length: ${jsonMatch[0].length}`,
        'Parse Success'
      );
    }
  } else {
    writeMCPLog(
      `[planGUIActions] Found JSON with simple regex, length: ${jsonMatch[0].length}`,
      'Parse Success'
    );
  }

  if (!jsonMatch) {
    writeMCPLog(
      `[planGUIActions] Failed to find JSON in response. Full response: ${responseText}`,
      'Parse Error'
    );
    throw new Error('Failed to parse action plan response: No JSON found in response');
  }

  let plan;
  try {
    writeMCPLog(
      `[planGUIActions] Attempting to parse JSON (first 200 chars): ${jsonMatch[0].substring(0, 200)}`,
      'JSON Parse'
    );
    plan = JSON.parse(jsonMatch[0]);
    writeMCPLog(
      `[planGUIActions] JSON parsed successfully. Steps count: ${plan.steps?.length || 0}`,
      'JSON Parse Success'
    );
  } catch (parseError: unknown) {
    writeMCPLog(
      `[planGUIActions] JSON parse failed: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      'JSON Parse Error'
    );
    writeMCPLog(
      `[planGUIActions] JSON string that failed to parse: ${jsonMatch[0]}`,
      'JSON Parse Error'
    );
    throw new Error(
      `Failed to parse action plan JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}. JSON string: ${jsonMatch[0].substring(0, 500)}`
    );
  }

  if (!plan.steps || !Array.isArray(plan.steps)) {
    writeMCPLog(
      `[planGUIActions] Invalid plan format. Plan keys: ${Object.keys(plan).join(', ')}, steps type: ${typeof plan.steps}`,
      'Validation Error'
    );
    throw new Error(
      `Invalid action plan format: missing steps array. Plan structure: ${JSON.stringify(plan, null, 2).substring(0, 500)}`
    );
  }

  return plan;
}

/**
 * Locate a GUI element using vision
 */
export async function locateGUIElement(
  elementDescription: string,
  displayIndex?: number
): Promise<{
  x: number;
  y: number;
  confidence: number;
  displayIndex: number;
  reasoning?: string;
  boundingBox?: { left: number; top: number; right: number; bottom: number };
}> {
  // Supported on both macOS and Windows
  if (PLATFORM !== 'darwin' && PLATFORM !== 'win32') {
    throw new Error(`Element location is not supported on platform: ${PLATFORM}`);
  }

  // On macOS, prefer deterministic Dock lookup for Dock-related requests.
  // This avoids visual mis-grounding when multiple similar icons are present.
  if (PLATFORM === 'darwin') {
    try {
      const dockCoords = await tryLocateElementInDockByAccessibility(
        elementDescription,
        displayIndex
      );
      if (dockCoords) {
        return dockCoords;
      }
    } catch (dockError: unknown) {
      writeMCPLog(
        `[locateGUIElement] Dock accessibility lookup failed: ${dockError instanceof Error ? dockError.message : String(dockError)}`,
        'Dock Locate Warning'
      );
    }
  }

  // Take screenshot
  const screenshotPath = path.join(SCREENSHOTS_DIR, `gui_locate_${Date.now()}.png`);
  await takeScreenshot(screenshotPath, displayIndex);

  // Analyze screenshot to find element
  const coords = await analyzeScreenshotWithVision(
    screenshotPath,
    elementDescription,
    displayIndex
  );

  // Mark the located point on the screenshot
  // Note: coords are in logical coordinates, but the screenshot is in pixel coordinates
  // So we need to convert back to pixel coordinates for marking
  try {
    const config = await getDisplayConfiguration();
    const targetDisplay =
      displayIndex !== undefined
        ? config.displays.find((d) => d.index === displayIndex)
        : config.displays.find((d) => d.isMain);

    if (targetDisplay) {
      // On macOS, coords are logical (divided by scaleFactor), so multiply back to get pixels.
      // On Windows, coords are already in physical pixels (no scaleFactor division was applied).
      const rawScaleFactor = targetDisplay.scaleFactor || 1;
      const effectiveScaleFactor = PLATFORM === 'win32' ? 1 : rawScaleFactor;
      const pixelX = coords.x * effectiveScaleFactor;
      const pixelY = coords.y * effectiveScaleFactor;

      writeMCPLog(
        `[locateGUIElement] Marking point on screenshot: logical=(${coords.x}, ${coords.y}), pixel=(${pixelX}, ${pixelY}), effectiveScale=${effectiveScaleFactor}`,
        'Image Marking'
      );

      // coords.boundingBox is already in pixel coordinates
      const markedPath = await markPointOnImage(
        screenshotPath,
        pixelX,
        pixelY,
        undefined,
        coords.boundingBox
      );
      writeMCPLog(`[locateGUIElement] Marked screenshot saved to: ${markedPath}`, 'Image Marking');
    }
  } catch (markError: unknown) {
    // Don't fail if marking fails, just log the error
    writeMCPLog(
      `[locateGUIElement] Failed to mark screenshot: ${markError instanceof Error ? markError.message : String(markError)}`,
      'Image Marking Warning'
    );
  }

  return coords;
}

/**
 * Execute a single GUI action step
 */
export async function executeActionStep(
  step: { step: number; action: string; element_description: string; value?: string },
  displayIndex?: number
): Promise<{
  success: boolean;
  step: number;
  action: string;
  coordinates?: { x: number; y: number };
  error?: string;
}> {
  try {
    writeMCPLog(
      `[executeActionStep] Starting step ${step.step}: ${step.action} on "${step.element_description}"`,
      'Step Execution'
    );

    // Locate the element
    const coords = await locateGUIElement(step.element_description, displayIndex);
    writeMCPLog(
      `[executeActionStep] Step ${step.step}: Located element at (${coords.x}, ${coords.y}) with confidence ${coords.confidence}%`,
      'Step Execution'
    );

    if (coords.confidence < 50) {
      writeMCPLog(
        `[executeActionStep] Step ${step.step}: Low confidence (${coords.confidence}%), aborting`,
        'Step Execution'
      );
      return {
        success: false,
        step: step.step,
        action: step.action,
        error: `Element "${step.element_description}" not found with sufficient confidence (${coords.confidence}%)`,
      };
    }

    // Perform the action
    writeMCPLog(
      `[executeActionStep] Step ${step.step}: Executing action "${step.action}"`,
      'Step Execution'
    );
    switch (step.action) {
      case 'click':
        await performClick(coords.x, coords.y, coords.displayIndex, 'single');
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Click completed successfully`,
          'Step Execution'
        );
        return {
          success: true,
          step: step.step,
          action: 'click',
          coordinates: { x: coords.x, y: coords.y },
        };

      case 'double_click':
        await performClick(coords.x, coords.y, coords.displayIndex, 'double');
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Double click completed successfully`,
          'Step Execution'
        );
        return {
          success: true,
          step: step.step,
          action: 'double_click',
          coordinates: { x: coords.x, y: coords.y },
        };

      case 'right_click':
        await performClick(coords.x, coords.y, coords.displayIndex, 'right');
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Right click completed successfully`,
          'Step Execution'
        );
        return {
          success: true,
          step: step.step,
          action: 'right_click',
          coordinates: { x: coords.x, y: coords.y },
        };

      case 'type':
        if (!step.value) {
          writeMCPLog(
            `[executeActionStep] Step ${step.step}: Type action missing value`,
            'Step Execution Error'
          );
          return {
            success: false,
            step: step.step,
            action: 'type',
            error: 'Value is required for type action',
          };
        }
        // Click first to focus, then type
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Clicking to focus, then typing "${step.value}"`,
          'Step Execution'
        );
        await performClick(coords.x, coords.y, coords.displayIndex, 'single');
        await new Promise((resolve) => setTimeout(resolve, 200));
        await performType(step.value, false);
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Type completed successfully`,
          'Step Execution'
        );
        return {
          success: true,
          step: step.step,
          action: 'type',
          coordinates: { x: coords.x, y: coords.y },
        };

      case 'hover':
        await moveMouse(coords.x, coords.y, coords.displayIndex);
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Hover completed successfully`,
          'Step Execution'
        );
        return {
          success: true,
          step: step.step,
          action: 'hover',
          coordinates: { x: coords.x, y: coords.y },
        };

      case 'key_press':
        if (!step.value) {
          writeMCPLog(
            `[executeActionStep] Step ${step.step}: Key press action missing key name`,
            'Step Execution Error'
          );
          return {
            success: false,
            step: step.step,
            action: 'key_press',
            error: 'Key name is required for key_press action',
          };
        }
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Pressing key "${step.value}"`,
          'Step Execution'
        );
        await performKeyPress(step.value, []);
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Key press completed successfully`,
          'Step Execution'
        );
        return {
          success: true,
          step: step.step,
          action: 'key_press',
        };

      default:
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Unsupported action "${step.action}"`,
          'Step Execution Error'
        );
        return {
          success: false,
          step: step.step,
          action: step.action,
          error: `Unsupported action: ${step.action}`,
        };
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    writeMCPLog(
      `[executeActionStep] Step ${step.step}: Error occurred: ${errMsg}`,
      'Step Execution Error'
    );
    writeMCPLog(
      `[executeActionStep] Step ${step.step}: Error stack: ${errStack}`,
      'Step Execution Error'
    );
    return {
      success: false,
      step: step.step,
      action: step.action,
      error: errMsg,
    };
  }
}

/**
 * Perform GUI interaction using vision - automatically plans and executes steps
 */
export async function performVisionBasedInteraction(
  taskDescription: string,
  displayIndex?: number
): Promise<string> {
  // Supported on both macOS and Windows
  if (PLATFORM !== 'darwin' && PLATFORM !== 'win32') {
    throw new Error(`Vision-based GUI interaction is not supported on platform: ${PLATFORM}`);
  }

  writeMCPLog(`[performVisionBasedInteraction] Starting task: "${taskDescription}"`, 'Task Start');
  writeMCPLog(
    `[performVisionBasedInteraction] Display index: ${displayIndex ?? 'main'}`,
    'Task Start'
  );

  // Step 1: Plan the actions
  writeMCPLog(`[performVisionBasedInteraction] Step 1: Planning actions...`, 'Task Planning');
  let plan;
  try {
    plan = await planGUIActions(taskDescription, displayIndex);
    writeMCPLog(
      `[performVisionBasedInteraction] Planning completed. Total steps: ${plan.steps.length}`,
      'Task Planning'
    );
    writeMCPLog(
      `[performVisionBasedInteraction] Plan summary: ${plan.summary || 'No summary'}`,
      'Task Planning'
    );
  } catch (error: unknown) {
    writeMCPLog(
      `[performVisionBasedInteraction] Planning failed: ${error instanceof Error ? error.message : String(error)}`,
      'Task Planning Error'
    );
    throw error;
  }

  // Step 2: Execute each step
  writeMCPLog(
    `[performVisionBasedInteraction] Step 2: Executing ${plan.steps.length} steps...`,
    'Task Execution'
  );
  const results: Array<{
    step: number;
    success: boolean;
    action: string;
    element_description: string;
    error?: string;
    coordinates?: { x: number; y: number };
  }> = [];

  for (const step of plan.steps) {
    writeMCPLog(
      `[performVisionBasedInteraction] Executing step ${step.step}/${plan.steps.length}: ${step.action}`,
      'Task Execution'
    );
    // Wait a bit between steps to allow GUI to update
    // Longer wait after type actions to allow UI to process
    if (results.length > 0) {
      const lastAction = results[results.length - 1]?.action;
      const waitTime = lastAction === 'type' ? 800 : 500;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    const result = await executeActionStep(step, displayIndex);
    results.push({
      step: step.step,
      success: result.success,
      action: step.action,
      element_description: step.element_description,
      error: result.error,
      coordinates: result.coordinates,
    });

    // If a step fails, stop execution
    if (!result.success) {
      writeMCPLog(
        `[performVisionBasedInteraction] Step ${step.step} failed, stopping execution`,
        'Task Execution Error'
      );
      break;
    } else {
      writeMCPLog(
        `[performVisionBasedInteraction] Step ${step.step} completed successfully`,
        'Task Execution'
      );
    }

    // Additional wait after click actions that might open dialogs/menus
    if (step.action === 'click' || step.action === 'double_click') {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  const allSuccessful = results.every((r) => r.success);
  writeMCPLog(
    `[performVisionBasedInteraction] Task completed. Success: ${allSuccessful}, Steps executed: ${results.length}/${plan.steps.length}`,
    'Task Completion'
  );

  return JSON.stringify({
    success: allSuccessful,
    task: taskDescription,
    plan_summary: plan.summary || 'No summary provided',
    steps_executed: results.length,
    total_steps: plan.steps.length,
    results,
    failed_at_step: allSuccessful ? undefined : results.findIndex((r) => !r.success) + 1,
  });
}

/**
 * Verify GUI state using vision
 */
