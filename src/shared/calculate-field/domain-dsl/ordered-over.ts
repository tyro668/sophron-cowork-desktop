import type { ExprToken } from '../../expression-tokenizer';
import { type CalculationOrderField } from '../function-registry';
import type { CalculationWindowFrame } from '../window-frame';
import { parseFrameFromCursor } from './frame-parser';
import { DomainTokenCursor, type DomainParseOptions } from './token-cursor';
import { requiredField } from './validators';

export function parsePartition(tail: string): string[] {
  if (!tail) return [];
  const cursor = new DomainTokenCursor(tail);
  if (!cursor.matchIdentifier('over')) {
    throw new Error('Calculation domain functions only allow over(partition by ...)');
  }
  if (cursor.peek()?.type !== 'ParenOpen') {
    throw new Error('Calculation domain functions only allow over(partition by ...)');
  }
  cursor.consume();
  if (!cursor.matchIdentifier('partition')) {
    throw new Error('Calculation domain functions only allow over(partition by ...)');
  }
  if (!cursor.matchIdentifier('by')) {
    throw new Error('Calculation domain functions only allow over(partition by ...)');
  }

  const fields: string[] = [];
  let expectsField = true;
  while (!cursor.eof) {
    const token = cursor.peek();
    if (token?.type === 'EOF') break;
    if (token?.type === 'ParenClose') {
      if (expectsField) {
        throw new Error('Calculation domain partition contains a misplaced comma');
      }
      cursor.consume();
      break;
    }
    if (token?.type === 'Comma') {
      if (expectsField) {
        throw new Error('Calculation domain partition contains a misplaced comma');
      }
      expectsField = true;
      cursor.consume();
      continue;
    }
    if (!expectsField) {
      throw new Error('Calculation domain partition fields must be separated by commas');
    }
    if (token?.type === 'Ident' && token.value.toLowerCase() === 'order') {
      throw new Error('Calculation domain functions only allow over(partition by ...)');
    }
    const field = requiredField('over', token?.value ?? '', 1);
    fields.push(field);
    expectsField = false;
    cursor.consume();
  }
  if (cursor.peek()?.type !== 'EOF') {
    throw new Error('Calculation domain functions only allow over(partition by ...)');
  }
  if (fields.length === 0) throw new Error('Calculation domain partition cannot be empty');
  return fields;
}

export function parseOrderedPartition(
  functionId: string,
  tail: string,
  options: DomainParseOptions = {}
): { partitionBy: string[]; orderBy: CalculationOrderField[]; frame?: CalculationWindowFrame } {
  if (!tail) throw new Error('Ordered functions require over(... order by ...)');
  const cursor = new DomainTokenCursor(tail);
  if (!cursor.matchIdentifier('over')) {
    throw new Error('Ordered functions require over(... order by ...)');
  }
  if (cursor.peek()?.type !== 'ParenOpen') {
    throw new Error('Ordered functions require over(... order by ...)');
  }
  cursor.consume();

  const partitionBy: string[] = [];
  if (cursor.matchIdentifier('partition')) {
    if (!cursor.matchIdentifier('by')) {
      throw new Error('Ordered functions require over(partition by ...)');
    }
    let expectsField = true;
    while (!cursor.eof) {
      const token = cursor.peek();
      if (token?.type === 'EOF') break;
      if (token?.type === 'ParenClose') break;
      if (token?.type === 'Ident' && token.value.toLowerCase() === 'order') {
        break;
      }
      if (token?.type === 'Comma') {
        if (expectsField) {
          throw new Error('Ordered functions have a misplaced comma in partition');
        }
        expectsField = true;
        cursor.consume();
        continue;
      }
      if (!expectsField) {
        throw new Error('Ordered functions partition fields must be separated by commas');
      }
      if (!token) {
        throw new Error('Ordered functions require over(... order by ...)');
      }
      partitionBy.push(parseOrderedFieldToken(functionId, token, options));
      expectsField = false;
      cursor.consume();
    }
    if (partitionBy.length === 0) {
      throw new Error('Ordered functions partition cannot be empty');
    }
  }

  if (!cursor.matchIdentifier('order')) {
    throw new Error('Ordered functions require over(... order by ...)');
  }
  if (!cursor.matchIdentifier('by')) {
    throw new Error('Ordered functions require over(... order by ...)');
  }

  const orderBy: CalculationOrderField[] = [];
  let frame: CalculationWindowFrame | undefined;
  let expectsField = true;
  while (!cursor.eof) {
    const token = cursor.peek();
    if (token?.type === 'EOF') break;
    if (token?.type === 'ParenClose') {
      if (expectsField) {
        throw new Error('Ordered functions have a misplaced comma in order by');
      }
      cursor.consume();
      break;
    }
    if (token?.type === 'Comma') {
      if (expectsField) {
        throw new Error('Ordered functions have a misplaced comma in order by');
      }
      expectsField = true;
      cursor.consume();
      continue;
    }
    if (!token) {
      throw new Error('Ordered functions require over(... order by ...)');
    }
    const lower = token.value.toLowerCase();
    if (lower === 'rows' || lower === 'range' || lower === 'groups') {
      frame = parseFrameFromCursor(cursor);
      break;
    }
    if (!expectsField) {
      throw new Error('Ordered functions order fields must be separated by commas');
    }
    const field = parseOrderedFieldToken(functionId, token, options);
    cursor.consume();
    let direction: 'asc' | 'desc' = 'asc';
    const next = cursor.peek();
    if (
      next?.type === 'Ident' &&
      (next.value.toLowerCase() === 'asc' || next.value.toLowerCase() === 'desc')
    ) {
      direction = next.value.toLowerCase() as 'asc' | 'desc';
      cursor.consume();
    }
    orderBy.push({ field, direction });
    expectsField = false;
  }
  if (cursor.peek()?.type !== 'EOF') {
    throw new Error('Ordered functions require over(... order by ...)');
  }

  if (orderBy.length === 0) throw new Error('Ordered functions require at least one order field');
  return { partitionBy, orderBy, frame };
}

function parseOrderedFieldToken(
  functionId: string,
  token: ExprToken,
  options: DomainParseOptions = {}
): string {
  if (token.type === 'FieldRef') return requiredField(functionId, token.value, 1);
  if (token.type === 'Ident' && options.allowBareIdentifiers) return token.value;
  throw new Error(
    `Calculation function '${functionId}' requires field references in over(...) as [field], got '${token.value}'`
  );
}
