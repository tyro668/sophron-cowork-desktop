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
    const context = vm.createContext(Object.create(null), {
      codeGeneration: { strings: false, wasm: false },
    });
    const bootstrapSource = `(${installWorkflowSandbox.toString()})(${serializeForJavaScript({
      inputTableId: payload.inputTableId,
      outputTableName: payload.outputTableName,
      sdkVersion: payload.sdkVersion,
      allowedOperationTypes: payload.allowedOperationTypes,
      expressionCapabilities: payload.expressionCapabilities,
      expressions: payload.expressions,
    })});`;
    new vm.Script(bootstrapSource, { filename: 'workflow-sandbox-bootstrap.js' }).runInContext(
      context,
      { timeout: Math.min(Number(payload.timeoutMs) || 2_000, 2_000), breakOnSigint: true }
    );
    const script = new vm.Script(
      payload.javascript + '\n;__finish(main());\n__serializeWorkflowResult();',
      { filename: 'generated-workflow.js' }
    );
    const result = script.runInContext(context, {
      timeout: payload.timeoutMs,
      breakOnSigint: true,
    });
    if (typeof result !== 'string') throw new TypeError('Workflow sandbox returned non-text data');
    process.stdout.write(result);
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

function serializeForJavaScript(value) {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * This function is stringified and executed inside the VM realm. Do not close
 * over host values or add host callbacks to the context: keeping the SDK and
 * every callable object realm-local prevents constructor-based host escapes.
 */
function installWorkflowSandbox(payload) {
  'use strict';

  const SafeObject = Object;
  const SafeArray = Array;
  const SafeString = String;
  const SafeNumber = Number;
  const SafeError = Error;
  const SafeWeakSet = WeakSet;
  const SafeReflect = Reflect;
  const SafeJSON = JSON;
  for (const constructor of [
    Object,
    Function,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    Date,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
  ]) {
    if (constructor.prototype) SafeObject.freeze(constructor.prototype);
    SafeObject.freeze(constructor);
  }
  SafeObject.freeze(SafeReflect);
  SafeObject.freeze(SafeJSON);

  const operations = [];
  const provenance = [];
  let inputSeen = false;
  let outputSeen = false;
  let outputOperationId = null;
  let mainResult;
  const allowedOperationTypes = new Set(payload.allowedOperationTypes);
  const expressionCapabilities = payload.expressionCapabilities;

  const freeze = (value) => SafeObject.freeze(value);
  const deepFreeze = (value, seen = new SafeWeakSet()) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const key of SafeReflect.ownKeys(value)) deepFreeze(value[key], seen);
    return freeze(value);
  };
  const expression = (value) => deepFreeze(value);
  const preparedExpressions = new Map();
  const expressionIrByWrapper = new WeakMap();
  const metricByWrapper = new WeakMap();
  const workflowNodeByValue = new WeakMap();
  for (const item of SafeArray.isArray(payload.expressions) ? payload.expressions : []) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      !item.ir ||
      typeof item.ir !== 'object' ||
      preparedExpressions.has(item.id)
    ) {
      const error = new TypeError('Invalid precompiled workflow expression payload');
      error.code = 'INVALID_PRECOMPILED_EXPRESSION';
      throw error;
    }
    preparedExpressions.set(item.id, expression(item.ir));
  }

  const literal = (value) => expression({ kind: 'literal', value });
  const asExpression = (value) => expressionIrByWrapper.get(value) || literal(value);
  const wrapExpression = (ir) => {
    const api = SafeObject.create(null);
    expressionIrByWrapper.set(api, ir);
    for (const [name, op] of SafeObject.entries(expressionCapabilities.binaryMethods)) {
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
    for (const [name, op] of SafeObject.entries(expressionCapabilities.unaryMethods)) {
      api[name] = () => wrapExpression(expression({ kind: 'unary', op, value: ir }));
    }
    api.cast = (targetType, options = {}) =>
      wrapExpression(
        expression({
          kind: 'cast',
          value: ir,
          targetType,
          options: typeof options === 'number' ? { scale: options } : options,
        })
      );
    return freeze(api);
  };
  const requireWorkflow = (value) => {
    if (!value || !workflowNodeByValue.has(value)) {
      const error = new TypeError('First argument must be a WorkflowValue');
      error.code = 'INVALID_WORKFLOW_INPUT';
      throw error;
    }
  };
  const deepUnwrap = (value) => {
    if (SafeArray.isArray(value)) return value.map(deepUnwrap);
    const metricValue = metricByWrapper.get(value);
    if (metricValue) return metricValue;
    const expressionValue = expressionIrByWrapper.get(value);
    if (expressionValue) return expressionValue;
    if (value && typeof value === 'object') {
      const result = SafeObject.create(null);
      for (const key of SafeObject.keys(value)) result[key] = deepUnwrap(value[key]);
      return result;
    }
    return value;
  };
  const stackLocation = () => {
    const stack = SafeString(new SafeError().stack || '').split('\n');
    for (const line of stack) {
      const match = line.match(/at\s+(?:([^\s(]+)\s+\()?generated-workflow\.js:(\d+):(\d+)\)?/);
      if (match) {
        return {
          functionName: match[1] || 'main',
          line: SafeNumber(match[2]),
          column: SafeNumber(match[3]),
          start: 0,
          end: 0,
        };
      }
    }
    return { functionName: 'main', line: 1, column: 1, start: 0, end: 0 };
  };
  const slug = (value) =>
    SafeString(value || 'operation')
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
  const workflowValue = (nodeId) => {
    const value = SafeObject.create(null);
    workflowNodeByValue.set(value, nodeId);
    return freeze(value);
  };
  const add = (type, inputValue, fields) => {
    requireWorkflow(inputValue);
    if (!allowedOperationTypes.has(type)) {
      const error = new TypeError('Unsupported workflow operation type: ' + String(type));
      error.code = 'UNSUPPORTED_WORKFLOW_OPERATION';
      throw error;
    }
    if (!fields || typeof fields !== 'object' || SafeArray.isArray(fields)) {
      const error = new TypeError('Workflow operation payload must be an object');
      error.code = 'INVALID_WORKFLOW_PAYLOAD';
      throw error;
    }
    const location = stackLocation();
    const operationId = stableOperationId(type, location);
    const unwrappedFields = deepUnwrap(fields);
    for (const reserved of ['operationId', 'type', 'inputOperationId', 'location']) {
      if (SafeObject.prototype.hasOwnProperty.call(unwrappedFields, reserved)) {
        const error = new TypeError('Workflow operation payload uses reserved field: ' + reserved);
        error.code = 'RESERVED_WORKFLOW_PAYLOAD_FIELD';
        throw error;
      }
    }
    operations.push({
      ...unwrappedFields,
      operationId,
      type,
      inputOperationId: workflowNodeByValue.get(inputValue),
    });
    provenance.push({ operationId, language: 'javascript', source: location });
    return workflowValue(operationId);
  };

  const workflow = freeze({
    input: () => {
      inputSeen = true;
      return workflowValue('input');
    },
    step: (inputValue, type, fields) => add(type, inputValue, fields),
    output: (inputValue) => {
      requireWorkflow(inputValue);
      outputSeen = true;
      outputOperationId = workflowNodeByValue.get(inputValue);
      return inputValue;
    },
  });
  const col = (name) => wrapExpression(expression({ kind: 'column', name }));
  const lit = (value) => wrapExpression(literal(value));
  const workflowExpression = (id) => {
    if (typeof id !== 'string' || !preparedExpressions.has(id)) {
      const error = new TypeError('Unknown precompiled workflow expression: ' + String(id));
      error.code = 'UNKNOWN_PRECOMPILED_EXPRESSION';
      throw error;
    }
    return wrapExpression(preparedExpressions.get(id));
  };
  const fn = freeze(
    SafeObject.fromEntries(
      expressionCapabilities.functions.map((name) => [
        name,
        (...args) =>
          wrapExpression(
            expression({
              kind: 'function',
              name,
              args: args.map(asExpression),
            })
          ),
      ])
    )
  );
  const metricFactory = (name) => (value) => {
    const result = SafeObject.create(null);
    result.as = (alias) => {
      const wrapper = SafeObject.create(null);
      metricByWrapper.set(wrapper, {
        fn: name,
        expression: value === undefined ? '*' : asExpression(value),
        alias,
      });
      return freeze(wrapper);
    };
    return freeze(result);
  };
  const metric = freeze(
    SafeObject.fromEntries(
      ['sum', 'avg', 'min', 'max', 'count', 'countDistinct'].map((name) => [
        name,
        metricFactory(name),
      ])
    )
  );

  const defineGlobal = (name, value) => {
    SafeObject.defineProperty(globalThis, name, {
      value,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  };
  defineGlobal('INPUT_TABLE_ID', payload.inputTableId);
  defineGlobal('OUTPUT_TABLE_NAME', payload.outputTableName);
  defineGlobal('workflow', workflow);
  defineGlobal('col', col);
  defineGlobal('lit', lit);
  defineGlobal('fn', fn);
  defineGlobal('metric', metric);
  defineGlobal('__workflowExpression', workflowExpression);
  defineGlobal('__finish', (value) => {
    mainResult = value;
  });
  defineGlobal('__serializeWorkflowResult', () => {
    requireWorkflow(mainResult);
    return SafeJSON.stringify({
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
    });
  });
}
