import type { PrepDiagnostic, PrepOperatorAst, PrepOperatorType } from '../ast';
import { aggregateCodec } from './aggregate';
import { calculateFieldCodec } from './calculate-field';
import type { OperatorCommand, OperatorDslCodec } from './codec';
import { deduplicateCodec } from './deduplicate';
import { fieldMappingCodec } from './field-mapping';
import { fieldSelectCodec } from './field-select';
import { filterCodec } from './filter';
import { joinCodec } from './join';
import { limitCodec } from './limit';
import { missingValueCodec } from './missing-value';
import { outputCodec } from './output';
import { pivotCodec } from './pivot';
import { setOpCodec } from './set-op';
import { sortCodec } from './sort';
import { typeConvertCodec } from './type-convert';
import { unnestCodec } from './unnest';
import { unpivotCodec } from './unpivot';

const codecs: readonly OperatorDslCodec[] = [
  fieldSelectCodec,
  calculateFieldCodec,
  fieldMappingCodec,
  filterCodec,
  joinCodec,
  typeConvertCodec,
  sortCodec,
  deduplicateCodec,
  aggregateCodec,
  limitCodec,
  missingValueCodec,
  pivotCodec,
  unpivotCodec,
  setOpCodec,
  unnestCodec,
  outputCodec,
];

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
