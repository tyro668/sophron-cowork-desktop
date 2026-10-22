import requirementAnalysisSystemPrompt from './data-workflow/requirement-analysis-system.txt?raw';
import workflowGenerationSystemPrompt from './data-workflow/workflow-generation-system.txt?raw';
import type { PrepDiagnostic } from '../../shared/prep-dsl';
import {
  getRequirementCapabilityContractOperationTypes,
  getRequirementCapabilityPrompt,
  type RequirementCapabilityContract,
} from '../data/workflow/requirement-capability-registry';
import { getWorkflowExpressionCapabilityPrompt } from '../data/workflow/workflow-expression-registry';
import {
  getWorkflowJavascriptCapabilityPrompt,
  getWorkflowOperationTypeList,
} from '../data/workflow/workflow-ir-operation-registry';
import {
  indexJavaScriptFunctions,
  indexJavaScriptFunctionsBestEffort,
} from '../data/workflow/javascript-runtime';
import type { WorkflowRepairStrategy } from '../data/workflow/workflow-failure';
import { isRecord } from '../data/workflow/utils';
import { renderPromptTemplate } from './template';

export function buildRequirementAnalysisSystemPrompt(): string {
  return renderPromptTemplate(requirementAnalysisSystemPrompt, {
    // Analysis classifies against capability ids — operation type names are
    // enough; JS payload signatures belong to generation only.
    WORKFLOW_CAPABILITIES: getWorkflowOperationTypeList(),
    REQUIREMENT_CAPABILITIES: getRequirementCapabilityPrompt(),
    WORKFLOW_EXPRESSION_CAPABILITIES: getWorkflowExpressionCapabilityPrompt(),
  });
}

export function buildRequirementAnalysisUserPrompt(input: {
  requirement: string;
  requirementConversation?: Array<{ role: 'user' | 'assistant'; text: string }>;
  inputColumns: Array<{ name: string; type?: string }>;
}): string {
  return JSON.stringify(
    {
      ...input,
      conversationNote: input.requirementConversation?.length
        ? 'requirementConversation lists the earlier turns in order: each user message and the assistant analysis feedback it received. requirement contains every user message joined in order, so the newest message at the end usually answers or refines items from that feedback. Interpret short answers against the item they respond to instead of treating them as standalone requests, then classify the complete accumulated requirement.'
        : undefined,
    },
    null,
    2
  );
}

export function buildWorkflowGenerationSystemPrompt(input?: {
  /** Confirmed requirement contract — limits the payload doc to approved ops. */
  operationTypes?: readonly string[];
  repairFunctionName?: string;
}): string {
  return renderPromptTemplate(workflowGenerationSystemPrompt, {
    RESPONSE_CONTRACT: input?.repairFunctionName
      ? `Return only ${JSON.stringify({ javascriptPatch: { functionName: input.repairFunctionName, replacementSource: 'complete named function declaration(s)' } })}. Include the requested function and any new helpers it needs. Do not return javascriptSource, redefine other existing functions, or include main() unless main is the requested function.`
      : 'Return {"javascriptSource":"..."}. The program must contain named helper functions and function main().',
    WORKFLOW_CAPABILITIES: getWorkflowJavascriptCapabilityPrompt(input?.operationTypes),
    WORKFLOW_EXPRESSION_CAPABILITIES: getWorkflowExpressionCapabilityPrompt(),
  });
}

export function buildWorkflowGenerationUserPrompt(input: {
  rawTableId: string;
  resultTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  requirementContract?: RequirementCapabilityContract;
  failedJavascriptSource?: string;
  diagnostics?: PrepDiagnostic[];
  repairFunctionName?: string;
  repairStrategy?: WorkflowRepairStrategy;
}): string {
  const scopedRepairContext =
    input.failedJavascriptSource && input.repairFunctionName
      ? buildScopedRepairSourceContext(input.failedJavascriptSource, input.repairFunctionName)
      : undefined;
  return JSON.stringify(
    {
      pipeline:
        'Convert the user requirement into standard JavaScript that builds a Sophron data workflow through the provided Workflow SDK.',
      requirement: input.requirement,
      inputColumns: input.columns,
      compilationTarget: {
        rawTableId: input.rawTableId,
        resultTableName: input.resultTableName,
      },
      confirmedRequirementCapabilityContract: input.requirementContract
        ? {
            operationTypes: getRequirementCapabilityContractOperationTypes(
              input.requirementContract
            ),
            capabilities: input.requirementContract.capabilityIds.map((id) => ({
              id,
              description: getRequirementCapabilityPrompt([id]),
            })),
            instruction:
              'Implement every listed operation type and capability variant. Do not add operation types or capability variants that are not listed. Multiple steps of an approved operation type are allowed only when needed by the requirement.',
          }
        : undefined,
      generationRules: {
        sequentialHelpers:
          'A helper may call workflow.step() multiple times in sequence. Bind every intermediate workflow value to a descriptive const, pass it to the next step, and return the final value.',
        mainContract:
          input.failedJavascriptSource && input.repairFunctionName
            ? `Return only the replacement for ${input.repairFunctionName} and any new helpers it needs. The existing program supplies all unchanged functions; do not reproduce them.`
            : 'The complete program must call workflow.input() exactly once and workflow.output() exactly once. main() must return the exact object returned by workflow.output().',
      },
      outputJsonSchema:
        input.failedJavascriptSource && input.repairFunctionName
          ? {
              javascriptPatch: {
                functionName: input.repairFunctionName,
                replacementSource:
                  'one or more complete named function declarations; retain the requested function, optionally add uniquely named helpers, and do not include main unless main is the requested function',
              },
            }
          : {
              javascriptSource:
                'complete standard function-oriented JavaScript with named helpers and main(). Express data operations only through the provided Workflow SDK and use RAW_TABLE_ID and RESULT_TABLE_NAME constants exactly.',
              requiredColumns: [{ name: 'input column referenced by the DSL', type: 'optional' }],
              changeSummary: 'brief user-facing summary of what the workflow changes',
            },
      previousFailedAttempt: input.failedJavascriptSource
        ? {
            failedJavascriptSource: scopedRepairContext ? undefined : input.failedJavascriptSource,
            repairTarget: scopedRepairContext,
            diagnostics: (input.diagnostics ?? []).map((diagnostic) => ({
              severity: diagnostic.severity,
              code: diagnostic.code,
              message: diagnostic.message,
              line: diagnostic.line,
              column: diagnostic.column,
              functionName: isRecord(diagnostic) ? diagnostic.functionName : undefined,
              operationId: isRecord(diagnostic) ? diagnostic.operationId : undefined,
              operationType: isRecord(diagnostic) ? diagnostic.operationType : undefined,
              expectedSignature: isRecord(diagnostic) ? diagnostic.expectedSignature : undefined,
              repairHint: isRecord(diagnostic) ? diagnostic.repairHint : undefined,
              sourceLine: isRecord(diagnostic) ? diagnostic.sourceLine : undefined,
              sourceExcerpt: isRecord(diagnostic) ? diagnostic.sourceExcerpt : undefined,
              caret: isRecord(diagnostic) ? diagnostic.caret : undefined,
              nodeId: isRecord(diagnostic) ? diagnostic.nodeId : undefined,
              nodeType: isRecord(diagnostic) ? diagnostic.nodeType : undefined,
              failureStage: isRecord(diagnostic) ? diagnostic.failureStage : undefined,
              repairClass: isRecord(diagnostic) ? diagnostic.repairClass : undefined,
            })),
            repairStrategy: input.repairStrategy,
            previousRepairWasIdentical: input.repairStrategy === 'duplicate_rewrite',
            instruction:
              input.repairStrategy === 'duplicate_rewrite'
                ? 'The previous repair returned byte-for-byte identical JavaScript and repeated the same diagnostics. Do not copy the failed source unchanged. Rewrite the failing function or, when its boundary is uncertain, reconstruct the complete program from scratch. Return complete corrected javascriptSource with every helper and main(). Apply the reported source excerpt, caret, repairHint, and canonical expectedSignature exactly. Do not return javascriptPatch or DSL.'
                : input.repairFunctionName
                  ? `Repair only ${input.repairFunctionName}. Return javascriptPatch with functionName exactly "${input.repairFunctionName}" and replacementSource containing the corrected function plus only any new helpers it requires. Do not return the complete program or DSL.`
                  : 'A full repair is required. Return the complete corrected javascriptSource, including every helper and main(). Apply every diagnostic source excerpt, caret, repairHint, and canonical expectedSignature exactly. Do not return a partial function, javascriptPatch, or DSL.',
          }
        : undefined,
      examples: input.failedJavascriptSource ? undefined : WORKFLOW_GENERATION_EXAMPLES,
    },
    null,
    2
  );
}

const WORKFLOW_GENERATION_EXAMPLES = [
  {
    requirement: '过滤掉Market为EU的数据',
    javascriptSource:
      'function filterEurope(input) {\n  return workflow.step(input, "filter", { condition: expr(row => row["Market"] !== "EU") });\n}\n\nfunction main() {\n  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });\n  const filtered = filterEurope(input);\n  return workflow.output(filtered, RESULT_TABLE_NAME, { mode: "replace" });\n}',
    requiredColumns: [{ name: 'Market' }],
  },
  {
    requirement: '按照Sales升序排列，删除记录数',
    javascriptSource:
      'function sortSales(input) {\n  return workflow.step(input, "sort", { orderBy: [{ field: "Sales", direction: "asc" }] });\n}\n\nfunction removeRecordCount(input) {\n  return workflow.step(input, "select", { selection: "exclude", fields: ["记录数"] });\n}\n\nfunction main() {\n  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });\n  const sorted = sortSales(input);\n  const cleaned = removeRecordCount(sorted);\n  return workflow.output(cleaned, RESULT_TABLE_NAME, { mode: "replace" });\n}',
    requiredColumns: [{ name: 'Sales' }, { name: '记录数' }],
  },
  {
    requirement: '从 Date 提取年份和月份',
    javascriptSource:
      'function extractYearAndMonth(input) {\n  const withYear = workflow.step(input, "derive", { column: "Year", expression: expr(row => year(row["Date"])) });\n  const withMonth = workflow.step(withYear, "derive", { column: "Month", expression: expr(row => month(row["Date"])) });\n  return withMonth;\n}\n\nfunction main() {\n  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });\n  const enriched = extractYearAndMonth(input);\n  return workflow.output(enriched, RESULT_TABLE_NAME, { mode: "replace" });\n}',
    requiredColumns: [{ name: 'Date' }],
  },
  {
    requirement:
      '根据利润率新增“经营等级”：利润率大于等于 20% 为“高收益”，0%到20%之间为“低收益”，小于0%为“亏损”。Sales 为 0 的话利润率置0。',
    javascriptSource:
      'function addProfitRate(input) {\n  return workflow.step(input, "derive", { column: "利润率", expression: expr(row => cast(row["Sales"] == null || row["Sales"] === 0 ? 0 : row["Profit"] / row["Sales"], "decimal", { scale: 2 })) });\n}\n\nfunction addOperatingGrade(input) {\n  return workflow.step(input, "derive", { column: "经营等级", expression: expr(row => row["利润率"] >= 0.2 ? "高收益" : row["利润率"] >= 0 ? "低收益" : "亏损") });\n}\n\nfunction main() {\n  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });\n  const withProfitRate = addProfitRate(input);\n  const withOperatingGrade = addOperatingGrade(withProfitRate);\n  return workflow.output(withOperatingGrade, RESULT_TABLE_NAME, { mode: "replace" });\n}',
    requiredColumns: [{ name: 'Sales' }, { name: 'Profit' }],
  },
  {
    requirement:
      '以 Product Type 为行分组，将 Market 透视为列，固定生成 Central、East、South、West 四列，单元格汇总 Sales。',
    javascriptSource:
      'function pivotMarketSales(input) {\n  return workflow.step(input, "pivot", { config: { on: [{ field: "Market", values: ["Central", "East", "South", "West"] }], using: [{ function: "sum", expression: expr(row => row["Sales"]), alias: "Sales" }], groupBy: ["Product Type"] } });\n}\n\nfunction main() {\n  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });\n  const pivoted = pivotMarketSales(input);\n  return workflow.output(pivoted, RESULT_TABLE_NAME, { mode: "replace" });\n}',
    requiredColumns: [{ name: 'Product Type' }, { name: 'Market' }, { name: 'Sales' }],
  },
  {
    requirement: '按客户汇总销售额，找出销售额最高的前10名客户',
    javascriptSource:
      'function summarizeCustomers(input) {\n  return workflow.step(input, "aggregate", { groupBy: [expr(row => row["Customer ID"]), expr(row => row["Customer Name"])], metrics: [{ fn: "sum", expression: expr(row => row["Sales"]), alias: "总销售额" }] });\n}\n\nfunction rankCustomers(input) {\n  const sorted = workflow.step(input, "sort", { orderBy: [{ field: "总销售额", direction: "desc" }] });\n  const limited = workflow.step(sorted, "limit", { config: { sampling: "fixed", limit: 10, unit: "rows", offset: 0, orderBy: [] } });\n  return limited;\n}\n\nfunction main() {\n  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });\n  const summarized = summarizeCustomers(input);\n  const ranked = rankCustomers(summarized);\n  return workflow.output(ranked, RESULT_TABLE_NAME, { mode: "replace" });\n}',
    requiredColumns: [{ name: 'Customer ID' }, { name: 'Customer Name' }, { name: 'Sales' }],
  },
  {
    requirement:
      '按 Country 汇总 Sales，然后计算各国家销售额占全部国家销售额的比例，结果按占比降序排列。',
    javascriptSource:
      'function summarizeCountrySales(input) {\n  return workflow.step(input, "aggregate", { groupBy: [expr(row => row["Country"])], metrics: [{ fn: "sum", expression: expr(row => row["Sales"]), alias: "国家销售额" }] });\n}\n\nfunction addOverallSales(input) {\n  return workflow.step(input, "derive_window", { column: "全部销售额", function: "sum", expression: expr(row => row["国家销售额"]), partitionBy: [], orderBy: [] });\n}\n\nfunction addSalesShare(input) {\n  return workflow.step(input, "derive", { column: "销售额占比", expression: expr(row => cast(row["全部销售额"] == null || row["全部销售额"] === 0 ? 0 : row["国家销售额"] / row["全部销售额"], "decimal", { scale: 4 })) });\n}\n\nfunction sortBySalesShare(input) {\n  return workflow.step(input, "sort", { orderBy: [{ field: "销售额占比", direction: "desc" }] });\n}\n\nfunction main() {\n  const input = workflow.input(RAW_TABLE_ID, { alias: "src" });\n  const summarized = summarizeCountrySales(input);\n  const withOverallSales = addOverallSales(summarized);\n  const withSalesShare = addSalesShare(withOverallSales);\n  const sorted = sortBySalesShare(withSalesShare);\n  return workflow.output(sorted, RESULT_TABLE_NAME, { mode: "replace" });\n}',
    requiredColumns: [{ name: 'Country' }, { name: 'Sales' }],
  },
] as const;

function buildScopedRepairSourceContext(
  javascriptSource: string,
  functionName: string
): { functionName: string; source: string; availableFunctions: string[] } | undefined {
  let functions: ReturnType<typeof indexJavaScriptFunctionsBestEffort>;
  try {
    functions = indexJavaScriptFunctions(javascriptSource);
  } catch {
    functions = indexJavaScriptFunctionsBestEffort(javascriptSource);
  }
  const target = functions.find((item) => item.name === functionName);
  if (!target) return undefined;
  return {
    functionName,
    source: javascriptSource.slice(target.start, target.end).trim(),
    availableFunctions: functions.map((item) => item.name),
  };
}
