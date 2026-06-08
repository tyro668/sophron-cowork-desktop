import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';

function ok(config: Record<string, unknown>) {
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
      conversions: [{ column: 'order_date', type: 'date', format: 'yyyy-MM-dd' }],
    });
    expect(r.dsl).toContain('cast [order_date] as date');
    expect(r.dsl).toContain('format "yyyy-MM-dd"');
  });

  it('conversion to double with on_error', () => {
    const r = ok({
      conversions: [{ column: 'revenue', type: 'double', onError: 'null' }],
    });
    expect(r.dsl).toContain('as double');
    expect(r.dsl).toContain('on_error null');
  });

  it('conversion to int with on_error fail', () => {
    const r = ok({
      conversions: [{ column: 'qty', type: 'int', onError: 'fail' }],
    });
    expect(r.dsl).toContain('on_error fail');
  });

  it('timestamp with format and timezone', () => {
    const r = ok({
      conversions: [
        {
          column: 'created_at',
          type: 'timestamp',
          format: 'yyyy-MM-dd HH:mm:ss',
          timezone: 'Asia/Shanghai',
        },
      ],
    });
    expect(r.dsl).toContain('timestamp');
    expect(r.dsl).toContain('timezone "Asia/Shanghai"');
  });

  it('decimal with locale', () => {
    const r = ok({
      conversions: [{ column: 'price', type: 'decimal', locale: 'de_DE' }],
    });
    expect(r.dsl).toContain('decimal');
    expect(r.dsl).toContain('locale');
  });

  it('multiple conversions', () => {
    const r = ok({
      conversions: [
        { column: 'dt', type: 'date', format: 'yyyy-MM-dd' },
        { column: 'rev', type: 'double', onError: 'null' },
        { column: 'qty', type: 'int', onError: 'fail' },
      ],
    });
    const convs = r.config.conversions as Array<Record<string, unknown>>;
    expect(convs).toHaveLength(3);
  });

  it('string conversion with on_error keep', () => {
    const r = ok({
      conversions: [{ column: 'name', type: 'string', onError: 'keep' }],
    });
    expect(r.dsl).toContain('on_error keep');
  });

  it('boolean conversion', () => {
    const r = ok({
      conversions: [{ column: 'is_active', type: 'boolean' }],
    });
    expect(r.dsl).toContain('as boolean');
  });
});

describe('FormTypeConvert — format detection', () => {
  // Simulate needsFormat from FormTypeConvert
  function needsFormat(type: string): boolean {
    return type === 'date' || type === 'timestamp';
  }

  it('date needs format', () => expect(needsFormat('date')).toBe(true));
  it('timestamp needs format', () => expect(needsFormat('timestamp')).toBe(true));
  it('int does not need format', () => expect(needsFormat('int')).toBe(false));
  it('string does not need format', () => expect(needsFormat('string')).toBe(false));
  it('boolean does not need format', () => expect(needsFormat('boolean')).toBe(false));
});

describe('FormTypeConvert — DSL idempotent', () => {
  it('export→parse→export produces same DSL', () => {
    const configs = [
      { conversions: [{ column: 'dt', type: 'date', format: 'yyyy-MM-dd' }] },
      { conversions: [{ column: 'rev', type: 'double', onError: 'null' }] },
      {
        conversions: [
          {
            column: 'ts',
            type: 'timestamp',
            format: 'yyyy-MM-dd HH:mm:ss',
            timezone: 'Asia/Shanghai',
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
