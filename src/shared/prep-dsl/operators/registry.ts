import type { PrepDiagnostic, PrepOperatorAst, PrepOperatorType } from '../ast';
import { OPERATOR_DEFINITIONS, OPERATOR_TYPES } from '../../operators';
import type { OperatorCommand, OperatorDslCodec } from './codec';

// Codec coverage derives from the operator registry: `dsl` is absent only for
// operators not expressible as DSL steps (input_source binds via `from <ref>`).
const codecs: readonly OperatorDslCodec[] = OPERATOR_TYPES.flatMap((type) => {
  const codec = OPERATOR_DEFINITIONS[type].dsl;
  return codec ? [codec] : [];
});

export function parseRegisteredOperator(
  command: OperatorCommand,
  diagnostics: PrepDiagnostic[]
): { matched: boolean; operator: PrepOperatorAst | null } {
  const codec = codecs.find((candidate) => candidate.matches(command.text));
  return codec
    ? { matched: true, operator: codec.parse(command, diagnostics) }
    : { matched: false, operator: null };
}

export function formatRegisteredOperator(
  type: PrepOperatorType,
  config: Record<string, unknown> | undefined
): string | null | undefined {
  return codecs.find((codec) => codec.type === type)?.format(config);
}
