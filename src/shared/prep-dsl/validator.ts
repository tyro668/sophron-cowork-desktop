import type { PrepDiagnostic, PrepOperatorAst, PrepWorkflowAst } from './ast';
import { createPrepDiagnostic } from './diagnostics';
import { parseFieldRef } from './syntax/fields';

export function validatePrepWorkflow(ast: PrepWorkflowAst): PrepDiagnostic[] {
  const diagnostics: PrepDiagnostic[] = [];
  const streamNames = new Set<string>();
  const streamNamesLower = new Set<string>();

  for (const source of ast.sources) {
    const alias = getAlias(source);
    if (!alias) {
      diagnostics.push(
        createPrepDiagnostic('inputSourceMissingAlias', 'Input source must declare as <alias>')
      );
      continue;
    }
    if (streamNamesLower.has(alias.toLowerCase())) {
      diagnostics.push(
        createPrepDiagnostic('duplicateInputAlias', `Duplicate input source alias: ${alias}`, {
          alias,
        })
      );
      continue;
    }
    streamNames.add(alias);
    streamNamesLower.add(alias.toLowerCase());
  }

  // Stream names resolve against sources and earlier steps only — forward
  // references would introduce cycles.
  for (const step of ast.steps) {
    if (streamNamesLower.has(step.name.toLowerCase())) {
      diagnostics.push(
        createPrepDiagnostic('duplicateStepName', `Duplicate step or source name: ${step.name}`, {
          alias: step.name,
        })
      );
    }
    if (step.input && !streamNamesLower.has(step.input.toLowerCase())) {
      diagnostics.push(
        createPrepDiagnostic(
          'stepInputNotFound',
          `Step "${step.name}" reads unknown stream: ${step.input}`,
          { alias: step.input, name: step.name }
        )
      );
    }
    let sawOutput = false;
    for (const operator of step.operators) {
      if (sawOutput) {
        diagnostics.push(
          createPrepDiagnostic(
            'outputNotTerminal',
            `Step "${step.name}" has operators after an output sink; outputs must end a chain`,
            { name: step.name }
          )
        );
      }
      if (operator.type === 'output') sawOutput = true;
      // `expect ... reject to <stream>` declares a named stream of violating
      // rows that later steps (and join/set_op right inputs) may read.
      if (operator.type === 'expect') {
        const rejectStream =
          typeof operator.config.rejectStream === 'string'
            ? operator.config.rejectStream.trim()
            : '';
        if (rejectStream) {
          if (streamNamesLower.has(rejectStream.toLowerCase())) {
            diagnostics.push(
              createPrepDiagnostic(
                'duplicateStepName',
                `Duplicate step or source name: ${rejectStream}`,
                { alias: rejectStream }
              )
            );
          } else {
            streamNames.add(rejectStream);
            streamNamesLower.add(rejectStream.toLowerCase());
          }
        }
      }
    }
    // The step's stream name binds to its output; operators following an output
    // already reported above. Name binds even when the step only holds sinks.
    if (!streamNamesLower.has(step.name.toLowerCase())) {
      streamNames.add(step.name);
      streamNamesLower.add(step.name.toLowerCase());
    }

    const leftStreams = new Set<string>();
    if (step.input) leftStreams.add(step.input.toLowerCase());
    if (ast.mainSource) leftStreams.add(ast.mainSource.toLowerCase());
    for (const operator of step.operators) {
      if (operator.type === 'join') {
        validateJoin(operator, streamNames, leftStreams, diagnostics);
      } else if (operator.type === 'set_op') {
        validateSetOp(operator, streamNames, diagnostics);
      }
    }
  }

  if (ast.outputs.length > 1) {
    diagnostics.push({
      ...createPrepDiagnostic(
        'multiOutputPartial',
        'Multiple output sinks are kept in the graph, but task execution materializes only the first sink; the rest are exported for downstream execution'
      ),
      severity: 'warning',
    });
  }

  return diagnostics;
}

function validateJoin(
  operator: PrepOperatorAst,
  aliases: Set<string>,
  currentLeftSources: Set<string>,
  diagnostics: PrepDiagnostic[]
): void {
  const rightInput = operator.config.rightInput;
  if (typeof rightInput !== 'string' || !aliases.has(rightInput)) {
    diagnostics.push(
      createPrepDiagnostic(
        'joinRightInputNotFound',
        `Join right input not found: ${String(rightInput)}`,
        {
          alias: String(rightInput),
        }
      )
    );
  }
  const rightAlias =
    typeof operator.config.rightAlias === 'string'
      ? operator.config.rightAlias
      : typeof rightInput === 'string'
        ? rightInput
        : undefined;
  const joinType = operator.config.joinType;
  if (joinType === 'asof') {
    const asof = operator.config.asof as
      | {
          operator?: string;
          tolerance?: string;
          leftTime?: string;
          rightTime?: string;
          by?: unknown;
        }
      | undefined;
    if (!asof) {
      diagnostics.push(
        createPrepDiagnostic(
          'asofMissingOn',
          'ASOF join must declare an on time-neighbor condition'
        )
      );
    } else {
      if (asof.operator === 'nearest' && !asof.tolerance) {
        diagnostics.push(
          createPrepDiagnostic('asofNearestMissingTolerance', 'ASOF nearest must declare tolerance')
        );
      }
      validateSidePair(
        String(asof.leftTime ?? ''),
        String(asof.rightTime ?? ''),
        rightAlias,
        aliases,
        currentLeftSources,
        diagnostics,
        'ASOF on'
      );
      if (Array.isArray(asof.by)) {
        for (const condition of asof.by) {
          validateConditionPair(
            condition,
            rightAlias,
            aliases,
            currentLeftSources,
            diagnostics,
            'ASOF by'
          );
        }
      }
    }
    return;
  }
  if (joinType !== 'cross') {
    const conditions = operator.config.conditions;
    if (!Array.isArray(conditions) || conditions.length === 0) {
      diagnostics.push(
        createPrepDiagnostic('joinMissingOn', 'Non-cross join must declare on conditions')
      );
    } else {
      for (const condition of conditions) {
        validateConditionPair(
          condition,
          rightAlias,
          aliases,
          currentLeftSources,
          diagnostics,
          'Join on'
        );
      }
    }
  }
  if (joinType !== 'semi' && joinType !== 'anti') {
    validateKeepSources(operator.config.keep, rightAlias, currentLeftSources, diagnostics);
  }
}

function validateConditionPair(
  condition: unknown,
  rightAlias: string | undefined,
  aliases: Set<string>,
  currentLeftSources: Set<string>,
  diagnostics: PrepDiagnostic[],
  context: string
): void {
  if (!isRecord(condition)) return;
  const left = typeof condition.left === 'string' ? condition.left : '';
  const right = typeof condition.right === 'string' ? condition.right : '';
  validateSidePair(left, right, rightAlias, aliases, currentLeftSources, diagnostics, context);
}

function validateSidePair(
  leftValue: string,
  rightValue: string,
  rightAlias: string | undefined,
  aliases: Set<string>,
  currentLeftSources: Set<string>,
  diagnostics: PrepDiagnostic[],
  context: string
): void {
  const leftSource = refSource(leftValue);
  const rightSource = refSource(rightValue);
  if (rightAlias && rightSource && !sameAlias(rightSource, rightAlias)) {
    diagnostics.push(
      createPrepDiagnostic(
        'joinConditionSideMismatch',
        `${context} right side references "${rightSource}" but the right input is "${rightAlias}"; right side must reference the right input`,
        { alias: rightAlias }
      )
    );
  }
  if (leftSource && !currentLeftSources.has(leftSource.toLowerCase())) {
    if (isKnownSource(leftSource, rightAlias, aliases)) {
      diagnostics.push(
        createPrepDiagnostic(
          'joinConditionSideMismatch',
          `${context} left side references "${leftSource}" which is not part of the left input`,
          { alias: leftSource }
        )
      );
    } else {
      diagnostics.push(
        createPrepDiagnostic(
          'joinFieldSourceNotFound',
          `${context} left field references unknown source "${leftSource}"`,
          { alias: leftSource }
        )
      );
    }
  }
}

function validateKeepSources(
  keep: unknown,
  rightAlias: string | undefined,
  currentLeftSources: Set<string>,
  diagnostics: PrepDiagnostic[]
): void {
  if (!Array.isArray(keep)) return;
  for (const item of keep) {
    if (!isRecord(item) || item.wildcard === true) continue;
    const source = typeof item.source === 'string' ? refSource(item.source) : undefined;
    if (
      source &&
      !currentLeftSources.has(source.toLowerCase()) &&
      !(rightAlias && sameAlias(source, rightAlias))
    ) {
      diagnostics.push(
        createPrepDiagnostic(
          'joinFieldSourceNotFound',
          `Join keep field references source "${source}" which is not part of the left input or the right input`,
          { alias: source }
        )
      );
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function refSource(value: string): string | undefined {
  if (!value.trim()) return undefined;
  return parseFieldRef(value)?.source;
}

function sameAlias(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function isKnownSource(
  source: string,
  rightAlias: string | undefined,
  aliases: Set<string>
): boolean {
  const lower = source.toLowerCase();
  if (rightAlias && rightAlias.toLowerCase() === lower) return true;
  for (const alias of aliases) {
    if (alias.toLowerCase() === lower) return true;
  }
  return false;
}

function validateSetOp(
  operator: PrepOperatorAst,
  aliases: Set<string>,
  diagnostics: PrepDiagnostic[]
): void {
  const rightInput = operator.config.rightInput;
  if (typeof rightInput !== 'string' || !aliases.has(rightInput)) {
    diagnostics.push(
      createPrepDiagnostic(
        'setOpRightInputNotFound',
        `Set operation right input not found: ${String(rightInput)}`,
        {
          alias: String(rightInput),
        }
      )
    );
  }
}

function getAlias(source: PrepOperatorAst): string | null {
  const alias = source.config.alias;
  return typeof alias === 'string' ? alias : null;
}
