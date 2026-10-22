import { parseFieldRefExact, toFieldName } from '../../prep-dsl/syntax/fields';
import { parseLiteral } from '../../prep-dsl/syntax/literals';
function isIntegerString(value: string): boolean {
  return /^\d+$/.test(value);
}

export function requireArgumentCount(functionId: string, args: string[], expected: number): void {
  if (args.length !== expected) {
    throw new Error(`Calculation function '${functionId}' expects ${expected} arguments`);
  }
}

export function requireArgumentRange(
  functionId: string,
  args: string[],
  min: number,
  max: number
): void {
  if (args.length < min || args.length > max) {
    throw new Error(`Calculation function '${functionId}' expects ${min} to ${max} arguments`);
  }
}

export function requiredValue(functionId: string, value: string, position: number): string {
  if (!value.trim()) {
    throw new Error(`Calculation function '${functionId}' requires argument ${position}`);
  }
  return value.trim();
}

export function requiredField(functionId: string, value: string, position: number): string {
  const field = parseFieldRefExact(value);
  if (!field) {
    throw new Error(`Calculation function '${functionId}' argument ${position} must be a field`);
  }
  return toFieldName(field);
}

export function requiredString(functionId: string, value: string, position: number): string {
  if (!(value.startsWith("'") && value.endsWith("'"))) {
    throw new Error(
      `Calculation function '${functionId}' argument ${position} must be a single-quoted string`
    );
  }
  return String(parseLiteral(value));
}

export function positiveInteger(
  functionId: string,
  value: string,
  position: number,
  max: number
): string {
  if (!isIntegerString(value)) {
    throw new Error(`Calculation function '${functionId}' argument ${position} must be an integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(
      `Calculation function '${functionId}' argument ${position} is outside its range`
    );
  }
  return String(parsed);
}
