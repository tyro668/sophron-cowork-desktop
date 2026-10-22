import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';

interface OkResult {
  dsl: string;
  config: Record<string, unknown> & { conversions?: Array<Record<string, unknown>> };
}

function ok(config: Record<string, unknown>): OkResult {
  const type = 'type_convert' as const;
  const dsl = exportPrepOperatorDsl({ id: 'test', type, config });
  const parsed = parsePrepOperatorDsl(dsl, type);
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  expect(errors, `DSL errors: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, `null operator: ${dsl}`).not.toBeNull();
  return { dsl, config: parsed.operator!.config };
}

describe('FormTypeConvert — config ↔ DSL', () => {
  it('single conversion to date', () => {
    const r = ok({
      conversions: [{ field: 'order_date', type: 'date' }],
    });
    expect(r.dsl).toContain('cast [order_date] as date');
  });

  it('conversion to float with on_error', () => {
    const r = ok({
      conversions: [{ field: 'revenue', type: 'float', onError: 'null' }],
    });
    expect(r.dsl).toContain('as float');
    // on_error null is the default and is omitted in canonical output
    expect(r.dsl).not.toContain('on_error');
  });

  it('conversion to integer with on_error fail', () => {
    const r = ok({
      conversions: [{ field: 'qty', type: 'integer', onError: 'fail' }],
    });
    expect(r.dsl).toContain('on_error fail');
  });

  it('datetime conversion', () => {
    const r = ok({
      conversions: [
        {
          field: 'created_at',
          type: 'datetime',
        },
      ],
    });
    expect(r.dsl).toContain('datetime');
  });

  it('decimal conversion', () => {
    const r = ok({
      conversions: [{ field: 'price', type: 'decimal' }],
    });
    expect(r.dsl).toContain('decimal');
  });

  it('multiple conversions', () => {
    const r = ok({
      conversions: [
        { field: 'dt', type: 'date' },
        { field: 'rev', type: 'float', onError: 'null' },
        { field: 'qty', type: 'integer', onError: 'fail' },
      ],
    });
    const convs = r.config.conversions as Array<Record<string, unknown>>;
    expect(convs).toHaveLength(3);
  });

  it('text conversion with on_error keep', () => {
    const r = ok({
      conversions: [{ field: 'name', type: 'text', onError: 'keep' }],
    });
    expect(r.dsl).toContain('on_error keep');
  });

  it('date conversion with format', () => {
    const r = ok({
      conversions: [{ field: 'date_str', type: 'date', format: '%m/%d/%y' }],
    });
    expect(r.dsl).toContain('format "%m/%d/%y"');
    expect(r.config.conversions![0].format).toBe('%m/%d/%y');
  });

  it('datetime conversion with format', () => {
    const r = ok({
      conversions: [{ field: 'ts', type: 'datetime', format: '%Y-%m-%d %H:%M:%S' }],
    });
    expect(r.dsl).toContain('format "%Y-%m-%d %H:%M:%S"');
    expect(r.config.conversions![0].format).toBe('%Y-%m-%d %H:%M:%S');
  });

  it('DSL idempotent with format', () => {
    const config = { conversions: [{ field: 'dt', type: 'date', format: '%m/%d/%y' }] };
    const dsl1 = exportPrepOperatorDsl({ id: 't', type: 'type_convert', config });
    const parsed = parsePrepOperatorDsl(dsl1, 'type_convert');
    expect(parsed.operator).not.toBeNull();
    const dsl2 = exportPrepOperatorDsl({
      id: 't',
      type: 'type_convert',
      config: parsed.operator!.config,
    });
    expect(dsl2).toBe(dsl1);
  });
});

import { duckDbTypeForDataFieldType } from '../../src/shared/data-field-types';

describe('FormTypeConvert — type detection', () => {
  it('date resolves to TIMESTAMPTZ', () => {
    expect(duckDbTypeForDataFieldType('datetime')).toBe('TIMESTAMPTZ');
  });
});

describe('FormTypeConvert — DSL idempotent', () => {
  it('export→parse→export produces same DSL', () => {
    const configs = [
      { conversions: [{ field: 'dt', type: 'date' }] },
      { conversions: [{ field: 'rev', type: 'float', onError: 'null' }] },
      {
        conversions: [
          {
            field: 'ts',
            type: 'datetime',
          },
        ],
      },
    ];
    for (const config of configs) {
      const dsl1 = exportPrepOperatorDsl({
        id: 't',
        type: 'type_convert',
        config,
      });
      const parsed = parsePrepOperatorDsl(dsl1, 'type_convert');
      expect(parsed.operator).not.toBeNull();
      const dsl2 = exportPrepOperatorDsl({
        id: 't',
        type: 'type_convert',
        config: parsed.operator!.config,
      });
      expect(dsl2).toBe(dsl1);
    }
  });
});
