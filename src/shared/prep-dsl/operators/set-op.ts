import { createOperator, type OperatorDslCodec } from './codec';

export const setOpCodec: OperatorDslCodec = {
  type: 'set_op',
  matches: (text) =>
    text.startsWith('union ') || text.startsWith('intersect ') || text.startsWith('except '),
  parse: ({ text }) => {
    const parsed = /^(union|intersect|except)\s+([A-Za-z_][A-Za-z0-9_]*)(.*)$/.exec(text);
    const rest = parsed?.[3] ?? '';
    const mode = /\smode\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(rest)?.[1] ?? 'distinct';
    const match = /\s+by\s+(name|position)\b/.exec(rest)?.[1];
    return createOperator('set_op', text, {
      operation: parsed?.[1] ?? 'union',
      rightInput: parsed?.[2] ?? '',
      mode,
      match: match === 'name' ? 'by_name' : 'by_position',
    });
  },
  format: (config) => {
    const operation = String(config?.operation ?? 'union');
    const rightInput = String(config?.rightInput ?? 'right_source');
    const mode = typeof config?.mode === 'string' ? ` mode ${config.mode}` : '';
    const match =
      operation === 'union' ? ` by ${config?.match === 'by_name' ? 'name' : 'position'}` : '';
    return `${operation} ${rightInput}${mode}${match}`;
  },
};
