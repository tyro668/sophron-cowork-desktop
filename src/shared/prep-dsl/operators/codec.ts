import type { PrepDiagnostic, PrepOperatorAst, PrepOperatorType } from '../ast';

export interface OperatorCommand {
  text: string;
  line: number;
}

export interface OperatorDslCodec {
  type: PrepOperatorType;
  matches(text: string): boolean;
  parse(command: OperatorCommand, diagnostics: PrepDiagnostic[]): PrepOperatorAst | null;
  format(config: Record<string, unknown> | undefined): string | null;
}

export function createOperator(
  type: PrepOperatorType,
  dsl: string,
  config: Record<string, unknown>
): PrepOperatorAst {
  return {
    type,
    label: type,
    dsl,
    config: { dsl, ...withoutUndefined(config) },
  };
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function objectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item)
      )
    : [];
}

function withoutUndefined(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined));
}
