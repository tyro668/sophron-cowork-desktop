import type { PrepDiagnostic, PrepOperatorAst, PrepWorkflowAst } from './ast';
import { createPrepDiagnostic } from './diagnostics';

export function validatePrepWorkflow(ast: PrepWorkflowAst): PrepDiagnostic[] {
  const diagnostics: PrepDiagnostic[] = [];
  const aliases = new Set<string>();
  for (const source of ast.sources) {
    const alias = getAlias(source);
    if (!alias) {
      diagnostics.push(createPrepDiagnostic('inputSourceMissingAlias', 'Input source must declare as <alias>'));
      continue;
    }
    if (aliases.has(alias)) {
      diagnostics.push(
        createPrepDiagnostic('duplicateInputAlias', `Duplicate input source alias: ${alias}`, {
          alias,
        })
      );
    }
    aliases.add(alias);
  }
  if (ast.mainSource && !aliases.has(ast.mainSource)) {
    diagnostics.push(
      createPrepDiagnostic('mainSourceNotFound', `Main input source not found: ${ast.mainSource}`, {
        alias: ast.mainSource,
      })
    );
  }
  for (const operator of ast.operators) {
    if (operator.type === 'join') {
      validateJoin(operator, aliases, diagnostics);
    } else if (operator.type === 'set_op') {
      validateSetOp(operator, aliases, diagnostics);
    }
  }
  return diagnostics;
}

function validateJoin(operator: PrepOperatorAst, aliases: Set<string>, diagnostics: PrepDiagnostic[]): void {
  const rightInput = operator.config.rightInput;
  if (typeof rightInput !== 'string' || !aliases.has(rightInput)) {
    diagnostics.push(
      createPrepDiagnostic('joinRightInputNotFound', `Join right input not found: ${String(rightInput)}`, {
        alias: String(rightInput),
      })
    );
  }
  if (operator.config.joinType === 'asof') {
    const asof = operator.config.asof as { operator?: string; tolerance?: string } | undefined;
    if (!asof) {
      diagnostics.push(createPrepDiagnostic('asofMissingOn', 'ASOF join must declare an on time-neighbor condition'));
    } else if (asof.operator === 'nearest' && !asof.tolerance) {
      diagnostics.push(createPrepDiagnostic('asofNearestMissingTolerance', 'ASOF nearest must declare tolerance'));
    }
    return;
  }
  if (operator.config.joinType !== 'cross') {
    const conditions = operator.config.conditions;
    if (!Array.isArray(conditions) || conditions.length === 0) {
      diagnostics.push(createPrepDiagnostic('joinMissingOn', 'Non-cross join must declare on conditions'));
    }
  }
}

function validateSetOp(operator: PrepOperatorAst, aliases: Set<string>, diagnostics: PrepDiagnostic[]): void {
  const rightInput = operator.config.rightInput;
  if (typeof rightInput !== 'string' || !aliases.has(rightInput)) {
    diagnostics.push(
      createPrepDiagnostic('setOpRightInputNotFound', `Set operation right input not found: ${String(rightInput)}`, {
        alias: String(rightInput),
      })
    );
  }
}

function getAlias(source: PrepOperatorAst): string | null {
  const alias = source.config.alias;
  return typeof alias === 'string' ? alias : null;
}
