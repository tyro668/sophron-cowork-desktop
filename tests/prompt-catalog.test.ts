import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_TOOL_COPY,
  DATA_TOOL_COPY,
  DEFAULT_MEMORY_PROMPTS,
  MEMORY_RETRIEVAL_EVAL_SYSTEM_PROMPT,
  buildAutomationToolStablePrompt,
  buildAutomationToolStatePrompt,
  buildGuiActionPlanPrompt,
  buildGuiGroundingBoxPrompt,
  buildGuiOperationVerificationPrompt,
  buildMainAgentSystemPrompt,
  buildMemoryRetrievalEvalUserPrompt,
  buildRequirementAnalysisSystemPrompt,
  buildRequirementAnalysisUserPrompt,
  buildSoftwareElementLocatorPrompt,
  buildSoftwareGuiAssertionPrompt,
  buildSoftwareGuiDescriptionPrompt,
  buildSoftwareScreenContextPrompt,
  buildWorkflowGenerationSystemPrompt,
  buildWorkflowGenerationUserPrompt,
} from '../src/main/prompts';

describe('central prompt catalog', () => {
  it('renders the main-agent template and omits empty optional sections', () => {
    const prompt = buildMainAgentSystemPrompt({
      workspaceInfo: '<workspace_info>/workspace</workspace_info>',
    });

    expect(prompt).toContain('CHAT FIRST');
    expect(prompt).toContain('<workspace_info>/workspace</workspace_info>');
    expect(prompt).not.toContain('{{');
    expect(prompt).not.toContain('<bundled_executables>');
  });

  it('renders dynamic automation time context without unresolved placeholders', () => {
    const state = buildAutomationToolStatePrompt({
      now: new Date(2026, 7, 20, 10, 30, 0).getTime(),
      timezone: 'Asia/Shanghai',
    });
    const stable = buildAutomationToolStablePrompt();

    expect(state).toContain('Desktop timezone: Asia/Shanghai');
    expect(state).toContain('2026-08-20T10:30:00');
    expect(stable).toContain('automation_set_enabled');
    expect(stable).not.toContain('{{');
  });

  it('builds data-workflow system and user prompts from the catalog', () => {
    const analysisSystem = buildRequirementAnalysisSystemPrompt();
    const generationSystem = buildWorkflowGenerationSystemPrompt();
    const analysisUser = JSON.parse(
      buildRequirementAnalysisUserPrompt({
        requirement: '按销售额降序',
        inputColumns: [{ name: 'Sales', type: 'decimal' }],
      })
    );
    const generationUser = JSON.parse(
      buildWorkflowGenerationUserPrompt({
        rawTableId: 'input-1',
        resultTableName: 'output-1',
        requirement: '按销售额降序',
        columns: [{ name: 'Sales', type: 'decimal' }],
      })
    );

    expect(analysisSystem).toContain('filter.boolean_predicate');
    expect(generationSystem).toContain('workflow.step(input');
    expect(analysisSystem).not.toContain('{{');
    expect(generationSystem).not.toContain('{{');
    expect(analysisUser.requirement).toBe('按销售额降序');
    expect(generationUser.examples).toHaveLength(7);
  });

  it('gives scoped repairs one consistent response contract in system and user prompts', () => {
    const system = buildWorkflowGenerationSystemPrompt({
      repairFunctionName: 'filterPositiveProfit',
    });
    const user = JSON.parse(
      buildWorkflowGenerationUserPrompt({
        rawTableId: 'input',
        resultTableName: 'output',
        requirement: '利润大于0',
        columns: [{ name: '利润', type: 'string' }],
        failedJavascriptSource: 'function filterPositiveProfit() {}',
        repairFunctionName: 'filterPositiveProfit',
        repairStrategy: 'function_patch',
      })
    );
    expect(system).toContain('"javascriptPatch":{"functionName":"filterPositiveProfit"');
    expect(system).not.toContain('Return {"javascriptSource":"..."}');
    expect(system).not.toContain('{{');
    expect(user.outputJsonSchema).not.toHaveProperty('javascriptSource');
    expect(user.outputJsonSchema.javascriptPatch.functionName).toBe('filterPositiveProfit');
    expect(user.generationRules.mainContract).toContain('Return only the replacement');
    expect(user.examples).toBeUndefined();
  });

  it('contains prompt copy for every app-owned custom data and automation tool', () => {
    expect(Object.keys(DATA_TOOL_COPY)).toHaveLength(34);
    expect(Object.keys(AUTOMATION_TOOL_COPY)).toHaveLength(6);
    for (const copy of [...Object.values(DATA_TOOL_COPY), ...Object.values(AUTOMATION_TOOL_COPY)]) {
      expect(copy.label.trim()).not.toBe('');
      expect(copy.description.trim()).not.toBe('');
    }
  });

  it('loads memory defaults from the catalog without changing the legacy whitespace contract', () => {
    expect(Object.keys(DEFAULT_MEMORY_PROMPTS)).toEqual([
      'coreMemoryUpdateSystemPrompt',
      'sessionChunkExtractionPrompt',
      'memoryNavigationPrompt',
      'promptIterationSystemPrompt',
    ]);

    for (const prompt of Object.values(DEFAULT_MEMORY_PROMPTS)) {
      expect(prompt).toMatch(/^\n\S/);
      expect(prompt).toMatch(/\S\n$/);
      expect(prompt).not.toContain('{{');
    }

    expect(MEMORY_RETRIEVAL_EVAL_SYSTEM_PROMPT).toContain(
      'Return JSON only with shape {"score": number, "reason": string}.'
    );
    expect(
      buildMemoryRetrievalEvalUserPrompt({
        prompt: 'How should I continue?',
        promptPrefix: '<memory>Use the prior decision</memory>',
      })
    ).toBe(
      'User prompt: How should I continue?\n\nInjected memory context:\n<memory>Use the prior decision</memory>'
    );
  });

  it('renders gui-operate prompts while preserving their response contracts', () => {
    const grounding = buildGuiGroundingBoxPrompt('保存按钮');
    const plan = buildGuiActionPlanPrompt({
      taskDescription: '保存文件',
      imageWidth: 1440,
      imageHeight: 900,
    });
    const verification = buildGuiOperationVerificationPrompt('文件是否保存成功？');

    expect(grounding).toContain('给我保存按钮的grounding坐标');
    expect(grounding).toContain('归一化到0-1000');
    expect(grounding).toContain('"box_2d"');
    expect(plan).toContain('Image dimensions: 1440x900 pixels');
    expect(plan).toContain('"action": "click|double_click|right_click|type|hover|key_press"');
    expect(verification).toContain('**Operation Success Judgment:**');
    expect(verification).toContain('- Status: [SUCCESS/FAILURE]');
    expect([grounding, plan, verification].join('\n')).not.toContain('{{');
  });

  it('renders software-development vision prompts with pixel-coordinate contracts', () => {
    const elements = Array.from({ length: 21 }, (_, index) => ({
      description: `Element ${index + 1}`,
      type: 'button',
      position: { x: index, y: index + 1, width: 100, height: 30 },
    }));
    const screenContext = buildSoftwareScreenContextPrompt({
      screenWidth: 1920,
      screenHeight: 1080,
      imageWidth: 1440,
      imageHeight: 810,
      previousContext: { analysis: 'A dialog was open.', elements: elements.slice(0, 1) },
    });
    const locator = buildSoftwareElementLocatorPrompt({
      elementDescription: 'Submit button',
      screenWidth: 1920,
      screenHeight: 1080,
      overallLayout: 'Form dialog',
      elements,
    });

    expect(screenContext).toContain('Screenshot resolution: 1440x810 pixels');
    expect(screenContext).toContain('**PREVIOUS SCREEN ANALYSIS:**');
    expect(locator).toContain('provide its EXACT CENTER coordinates');
    expect(locator).toContain('... and 1 more elements');
    expect(locator).not.toContain('Element 21 (button)');
    expect(buildSoftwareGuiAssertionPrompt('Is it open?')).toContain('clear yes/no answer');
    expect(buildSoftwareGuiDescriptionPrompt('What is visible?')).toContain(
      'Provide a detailed answer'
    );
    expect([screenContext, locator].join('\n')).not.toContain('{{');
  });
});
