/**
 * Public Prep DSL parsing API.
 *
 * Workflow and operator parsing live under operators/parser so callers do not depend on
 * implementation modules. Syntax primitives are re-exported here for backward compatibility.
 */
export {
  parsePrepDsl,
  parsePrepOperatorDsl,
  parseFieldRef,
  parseFieldRefExact,
  formatFieldName,
  toFieldName,
  toQualifiedName,
  unwrapFieldName,
} from './operators/parser';
