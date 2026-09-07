import { parseLiteral } from '../../prep-dsl/syntax/literals';
import {
  parseWindowFrameBound,
  validateWindowFrameOrder,
  type CalculationWindowFrame,
} from '../window-frame';
import { DomainTokenCursor } from './token-cursor';

export function parseFrameFromCursor(cursor: DomainTokenCursor): CalculationWindowFrame {
  const typeToken = cursor.consume();
  if (
    !typeToken ||
    (typeToken.value.toLowerCase() !== 'rows' &&
      typeToken.value.toLowerCase() !== 'range' &&
      typeToken.value.toLowerCase() !== 'groups')
  ) {
    throw new Error(`Unsupported window frame type '${typeToken?.value ?? ''}'`);
  }
  const frameType = typeToken.value.toLowerCase() as CalculationWindowFrame['type'];

  if (!cursor.matchIdentifier('between')) {
    throw new Error('Window frame requires "between"');
  }

  const start = parseFrameBoundFromCursor(cursor);
  if (!cursor.matchIdentifier('and')) {
    throw new Error('Window frame requires "and"');
  }
  const end = parseFrameBoundFromCursor(cursor);

  let exclude: CalculationWindowFrame['exclude'];
  if (cursor.matchIdentifier('exclude')) {
    // "current row" / "no others" are multi-word; consume remaining tokens up to the closing paren.
    const excludeText = consumeUntilParen(cursor);
    const normalized = excludeText.trim().toLowerCase();
    if (
      normalized !== 'current row' &&
      normalized !== 'group' &&
      normalized !== 'ties' &&
      normalized !== 'no others'
    ) {
      throw new Error(`Unsupported window frame exclusion '${excludeText.trim()}'`);
    }
    exclude = normalized;
  } else if (cursor.peek()?.type === 'ParenClose') {
    cursor.consume();
  } else {
    throw new Error('Window frame is not terminated by ")"');
  }

  if (!validateWindowFrameOrder(parseWindowFrameBound(start), parseWindowFrameBound(end))) {
    throw new Error('Invalid window frame order in over(...)');
  }

  return { type: frameType, start, end, ...(exclude ? { exclude } : {}) };
}

export function parseFrameBoundFromCursor(cursor: DomainTokenCursor): string {
  const first = cursor.peek();
  if (!first) throw new Error('Invalid window frame bound');
  const lower = first.value.toLowerCase();

  if (lower === 'unbounded') {
    cursor.consume();
    const second = cursor.peek();
    if (second?.type === 'Ident' && second.value.toLowerCase() === 'preceding') {
      cursor.consume();
      return 'unbounded preceding';
    }
    if (second?.type === 'Ident' && second.value.toLowerCase() === 'following') {
      cursor.consume();
      return 'unbounded following';
    }
    throw new Error('Invalid unbounded frame bound');
  }

  if (lower === 'current') {
    cursor.consume();
    if (!cursor.matchIdentifier('row')) {
      throw new Error('Invalid current row frame bound');
    }
    return 'current row';
  }

  if (lower === 'interval') {
    cursor.consume();
    const sizeToken = cursor.peek();
    if (!sizeToken || sizeToken.type !== 'Number') {
      throw new Error('Invalid interval frame bound');
    }
    cursor.consume();
    const unitToken = cursor.peek();
    if (!unitToken || unitToken.type !== 'StringLiteral') {
      throw new Error('Invalid interval frame unit');
    }
    cursor.consume();
    const directionToken = cursor.peek();
    if (
      !directionToken ||
      directionToken.type !== 'Ident' ||
      (directionToken.value.toLowerCase() !== 'preceding' &&
        directionToken.value.toLowerCase() !== 'following')
    ) {
      throw new Error('Invalid interval frame direction');
    }
    cursor.consume();
    const unit = String(parseLiteral(unitToken.value));
    return `interval ${sizeToken.value} ${unit} ${directionToken.value.toLowerCase()}`;
  }

  if (first.type === 'Number') {
    cursor.consume();
    const directionToken = cursor.peek();
    if (
      !directionToken ||
      directionToken.type !== 'Ident' ||
      (directionToken.value.toLowerCase() !== 'preceding' &&
        directionToken.value.toLowerCase() !== 'following')
    ) {
      throw new Error('Invalid numeric frame bound');
    }
    cursor.consume();
    return `${first.value} ${directionToken.value.toLowerCase()}`;
  }

  throw new Error(`Invalid window frame bound '${first.value}'`);
}

function consumeUntilParen(cursor: DomainTokenCursor): string {
  const parts: string[] = [];
  while (!cursor.eof) {
    const token = cursor.peek();
    if (token?.type === 'ParenClose') {
      cursor.consume();
      break;
    }
    parts.push(token?.value ?? '');
    cursor.consume();
  }
  return parts.join(' ');
}
