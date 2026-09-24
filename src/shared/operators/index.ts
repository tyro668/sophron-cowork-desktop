import { z, type ZodType } from 'zod';
import type { PrepDiagnostic } from '../prep-dsl/ast';
import {
  OPERATOR_CATEGORIES,
  OPERATOR_TYPES,
  issuesToDiagnostics,
  withoutOperatorMetadata,
  type DataWorkflowOperatorType,
  type OperatorDefinition,
} from './definition';
import { OPERATOR_DEFINITIONS } from './definitions';

export {
  OPERATOR_CATEGORIES,
  OPERATOR_TYPES,
  BINARY_INPUT_PORTS,
  TRANSFORM_PORTS,
  configSchemaDiagnostics,
  defineOperator,
  issuesToDiagnostics,
  withoutOperatorMetadata,
} from './definition';
export type {
  OperatorCategory,
  DataWorkflowOperatorType,
  OperatorCompileKind,
  OperatorDefinition,
  OperatorInputHandle,
  OperatorOutputHandle,
  OperatorPorts,
} from './definition';
export { OPERATOR_DEFINITIONS } from './definitions';
export type { OperatorDefinitionMap, WorkflowOperatorConfigMap } from './definitions';

/** Ordered category index shared by the palette and capability manifest, including empty groups. */
export const OPERATOR_GROUPS = OPERATOR_CATEGORIES.map((category) => ({
  category,
  operatorTypes: OPERATOR_TYPES.filter((type) => OPERATOR_DEFINITIONS[type].category === category),
}));

export function getOperatorDefinition(type: string): OperatorDefinition | undefined {
  return (OPERATOR_DEFINITIONS as Record<string, OperatorDefinition | undefined>)[type];
}

export function requireOperatorDefinition(type: string): OperatorDefinition {
  const definition = getOperatorDefinition(type);
  if (!definition) {
    throw new Error(`Unsupported workflow operator type: ${type}`);
  }
  return definition;
}

export function isWorkflowOperatorType(value: string): value is DataWorkflowOperatorType {
  return value in OPERATOR_DEFINITIONS;
}

/** Operators whose input edges use the binary left/right handles. */
export function hasBinaryInputs(type: string): boolean {
  return (getOperatorDefinition(type)?.ports.inputs.length ?? 0) > 1;
}

/** Config schemas keyed by operator type — derived from the registry. */
export const SCHEMA_MAP: Record<string, ZodType> = Object.fromEntries(
  OPERATOR_TYPES.map((type) => [type, OPERATOR_DEFINITIONS[type].schema])
);

export function parseOperatorConfig<T>(schema: ZodType<T>, config: Record<string, unknown>): T {
  return schema.parse(withoutOperatorMetadata(config));
}

export function getOperatorConfigValidation(
  type: string,
  config: Record<string, unknown>
): ReturnType<ZodType['safeParse']> {
  const schema = SCHEMA_MAP[type];
  if (schema) {
    return schema.safeParse(withoutOperatorMetadata(config));
  }
  return z
    .record(z.string(), z.unknown())
    .superRefine((_value, context) => {
      context.addIssue({
        code: 'custom',
        message: `Unsupported workflow operator type: ${type}`,
      });
    })
    .safeParse(withoutOperatorMetadata(config));
}

export function validateOperatorConfig(
  type: string,
  config: Record<string, unknown>
): PrepDiagnostic[] {
  const result = getOperatorConfigValidation(type, config);
  return result.success ? [] : issuesToDiagnostics(type, result.error.issues);
}
