import guiActionPlanTemplate from './gui/gui-operate/action-plan.txt?raw';
import guiExtractInformationTemplate from './gui/gui-operate/extract-information.txt?raw';
import guiGroundingBoxTemplate from './gui/gui-operate/grounding-box.txt?raw';
import guiVerifyOperationTemplate from './gui/gui-operate/verify-operation.txt?raw';
import softwareAssertStateTemplate from './gui/software-development/assert-state.txt?raw';
import softwareDescribeStateTemplate from './gui/software-development/describe-state.txt?raw';
import softwareLocateElementTemplate from './gui/software-development/locate-element-pixels.txt?raw';
import softwarePreviousScreenContextTemplate from './gui/software-development/previous-screen-context.txt?raw';
import softwareScreenContextTemplate from './gui/software-development/screen-context.txt?raw';
import { renderPromptTemplate } from './template';

export interface GuiVisionElement {
  description: string;
  type: string;
  position: { x: number; y: number; width: number; height: number };
}

export function buildGuiGroundingBoxPrompt(elementDescription: string): string {
  return renderPromptTemplate(guiGroundingBoxTemplate, {
    ELEMENT_DESCRIPTION: elementDescription,
  });
}

export function buildGuiActionPlanPrompt(input: {
  taskDescription: string;
  imageWidth: number;
  imageHeight: number;
}): string {
  return renderPromptTemplate(guiActionPlanTemplate, {
    TASK_DESCRIPTION: input.taskDescription,
    IMAGE_WIDTH: String(input.imageWidth),
    IMAGE_HEIGHT: String(input.imageHeight),
  });
}

export function buildGuiOperationVerificationPrompt(question: string): string {
  return renderPromptTemplate(guiVerifyOperationTemplate, { QUESTION: question });
}

export function buildGuiExtractionPrompt(extractionRequest: string): string {
  return renderPromptTemplate(guiExtractInformationTemplate, {
    EXTRACTION_REQUEST: extractionRequest,
  });
}

export function buildSoftwareScreenContextPrompt(input: {
  screenWidth: number;
  screenHeight: number;
  imageWidth: number;
  imageHeight: number;
  previousContext?: {
    analysis: string;
    elements: GuiVisionElement[];
  };
}): string {
  const previousContext = input.previousContext
    ? renderPromptTemplate(softwarePreviousScreenContextTemplate, {
        PREVIOUS_ANALYSIS: input.previousContext.analysis,
        PREVIOUS_ELEMENTS: input.previousContext.elements
          .map(
            (element) =>
              `- ${element.description} at (${element.position.x}, ${element.position.y})`
          )
          .join('\n'),
      })
    : '';

  return renderPromptTemplate(softwareScreenContextTemplate, {
    SCREEN_WIDTH: String(input.screenWidth),
    SCREEN_HEIGHT: String(input.screenHeight),
    IMAGE_WIDTH: String(input.imageWidth),
    IMAGE_HEIGHT: String(input.imageHeight),
    PREVIOUS_CONTEXT: previousContext ? `\n\n${previousContext}` : '',
  });
}

export function buildSoftwareElementLocatorPrompt(input: {
  elementDescription: string;
  screenWidth: number;
  screenHeight: number;
  overallLayout: string;
  elements: GuiVisionElement[];
}): string {
  const visibleElements = input.elements.slice(0, 20);
  return renderPromptTemplate(softwareLocateElementTemplate, {
    ELEMENT_DESCRIPTION: input.elementDescription,
    SCREEN_WIDTH: String(input.screenWidth),
    SCREEN_HEIGHT: String(input.screenHeight),
    OVERALL_LAYOUT: input.overallLayout,
    KNOWN_ELEMENTS: visibleElements
      .map(
        (element) =>
          `- ${element.description} (${element.type}) at position (${element.position.x}, ${element.position.y}), size ${element.position.width}x${element.position.height}`
      )
      .join('\n'),
    MORE_ELEMENTS:
      input.elements.length > 20 ? `... and ${input.elements.length - 20} more elements` : '',
  });
}

export function buildSoftwareGuiAssertionPrompt(question: string): string {
  return renderPromptTemplate(softwareAssertStateTemplate, { QUESTION: question });
}

export function buildSoftwareGuiDescriptionPrompt(question: string): string {
  return renderPromptTemplate(softwareDescribeStateTemplate, { QUESTION: question });
}
