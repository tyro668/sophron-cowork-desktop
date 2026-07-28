'use strict';

const vm = require('node:vm');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input);
    const operations = [];
    const provenance = [];
    let inputSeen = false;
    let outputSeen = false;
    let outputOperationId = null;
    let mainResult;
    const allowedOperationTypes = new Set(payload.allowedOperationTypes);

    const freeze = (value) => Object.freeze(value);
    const expression = (value) => freeze(value);
    const literal = (value) => expression({ kind: 'literal', value });
    const asExpression = (value) =>
      value && typeof value === 'object' && value.__expression
        ? value.__expression
        : literal(value);
    const wrapExpression = (ir) => {
      const api = Object.create(null);
      Object.defineProperty(api, '__expression', { value: ir, enumerable: false });
      for (const [name, op] of Object.entries({
        eq: '=',
        neq: '<>',
        gt: '>',
        gte: '>=',
        lt: '<',
        lte: '<=',
        contains: 'contains',
        notContains: 'not_contains',
        add: '+',
        sub: '-',
        mul: '*',
        div: '/',
      })) {
        api[name] = (value) =>
          wrapExpression(
            expression({
              kind: 'binary',
              op,
              left: ir,
              right: asExpression(value),
            })
          );
      }
      api.isNull = () => wrapExpression(expression({ kind: 'unary', op: 'is_null', value: ir }));
      api.isNotNull = () =>
        wrapExpression(expression({ kind: 'unary', op: 'is_not_null', value: ir }));
      return freeze(api);
    };
    const requireWorkflow = (value) => {
      if (!value || value.__workflow !== true) {
        const error = new TypeError('First argument must be a WorkflowValue');
        error.code = 'INVALID_WORKFLOW_INPUT';
        throw error;
      }
    };
    const deepUnwrap = (value) => {
      if (Array.isArray(value)) return value.map(deepUnwrap);
      if (value && value.__metric) {
        return { fn: value.fn, expression: value.expression, alias: value.alias };
      }
      if (value && value.__expression) return value.__expression;
      if (value && typeof value === 'object') {
        const result = Object.create(null);
        for (const key of Object.keys(value)) result[key] = deepUnwrap(value[key]);
        return result;
      }
      return value;
    };
    const stackLocation = () => {
      const stack = String(new Error().stack || '').split('\n');
      for (const line of stack) {
        const match = line.match(/at\s+(?:([^\s(]+)\s+\()?generated-workflow\.js:(\d+):(\d+)\)?/);
        if (match) {
          return {
            functionName: match[1] || 'main',
            line: Number(match[2]),
            column: Number(match[3]),
            start: 0,
            end: 0,
          };
        }
      }
      return { functionName: 'main', line: 1, column: 1, start: 0, end: 0 };
    };
    const slug = (value) =>
      String(value || 'operation')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'operation';
    const operationIdCounts = new Map();
    const stableOperationId = (type, location) => {
      const base = slug(location.functionName === 'main' ? type : location.functionName);
      const count = (operationIdCounts.get(base) || 0) + 1;
      operationIdCounts.set(base, count);
      return count === 1 ? base : base + '-' + count;
    };
    const workflowValue = (nodeId) =>
      freeze(
        Object.assign(Object.create(null), {
          __workflow: true,
          __nodeId: nodeId,
        })
      );
    const add = (type, input, fields) => {
      requireWorkflow(input);
      if (!allowedOperationTypes.has(type)) {
        const error = new TypeError('Unsupported workflow operation type: ' + String(type));
        error.code = 'UNSUPPORTED_WORKFLOW_OPERATION';
        throw error;
      }
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
        const error = new TypeError('Workflow operation payload must be an object');
        error.code = 'INVALID_WORKFLOW_PAYLOAD';
        throw error;
      }
      const location = stackLocation();
      const operationId = stableOperationId(type, location);
      operations.push({
        operationId,
        type,
        inputOperationId: input.__nodeId,
        ...deepUnwrap(fields),
      });
      provenance.push({ operationId, language: 'javascript', source: location });
      return workflowValue(operationId);
    };
    const sdk = Object.create(null);
    sdk.INPUT_TABLE_ID = payload.inputTableId;
    sdk.OUTPUT_TABLE_NAME = payload.outputTableName;
    sdk.workflow = freeze({
      input: () => {
        inputSeen = true;
        return workflowValue('input');
      },
      step: (input, type, fields) => add(type, input, fields),
      output: (input) => {
        requireWorkflow(input);
        outputSeen = true;
        outputOperationId = input.__nodeId;
        return input;
      },
    });
    sdk.col = (name) => wrapExpression(expression({ kind: 'column', name }));
    sdk.lit = (value) => wrapExpression(literal(value));
    sdk.fn = freeze(
      Object.fromEntries(
        ['regexpExtract', 'year', 'month', 'upper', 'lower', 'trim', 'replace', 'concat'].map(
          (name) => [
            name,
            (...args) =>
              wrapExpression(
                expression({
                  kind: 'function',
                  name,
                  args: args.map(asExpression),
                })
              ),
          ]
        )
      )
    );
    const metricFactory = (name) => (value) => {
      const result = Object.create(null);
      result.as = (alias) =>
        freeze({
          __metric: true,
          fn: name,
          expression: value === undefined ? '*' : asExpression(value),
          alias,
        });
      return freeze(result);
    };
    sdk.metric = freeze(
      Object.fromEntries(
        ['sum', 'avg', 'min', 'max', 'count', 'countDistinct'].map((name) => [
          name,
          metricFactory(name),
        ])
      )
    );
    sdk.__finish = (value) => {
      mainResult = value;
    };

    const context = vm.createContext(Object.freeze({ ...sdk }), {
      codeGeneration: { strings: false, wasm: false },
    });
    const script = new vm.Script(payload.javascript + '\n;__finish(main());', {
      filename: 'generated-workflow.js',
    });
    script.runInContext(context, { timeout: payload.timeoutMs, breakOnSigint: true });
    requireWorkflow(mainResult);
    process.stdout.write(
      JSON.stringify({
        ok: true,
        ir: {
          irVersion: '1.0',
          kind: 'workflow',
          sourceLanguage: 'javascript',
          sdkVersion: payload.sdkVersion,
          inputSeen,
          outputSeen,
          outputOperationId,
          operations,
          provenance,
        },
      })
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error: {
          code: error && error.code,
          name: error && error.name,
          message: error && error.message,
          stack: error && error.stack,
        },
      })
    );
  }
});
