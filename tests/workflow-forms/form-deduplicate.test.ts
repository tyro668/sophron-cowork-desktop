import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Helpers ───────────────────────────────────────────────────────────

function ok(config: Record<string, unknown>) {
  const type = 'deduplicate' as const;
  const dsl = exportPrepOperatorDsl({ id: 'test', type, config });
  const parsed = parsePrepOperatorDsl(dsl, type);
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  expect(errors, `DSL errors: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, `null operator: ${dsl}`).not.toBeNull();
  return { dsl, config: parsed.operator!.config };
}

// ── Config ↔ DSL ──────────────────────────────────────────────────────

describe('FormDeduplicate — config ↔ DSL', () => {
  it('全字段去重，保留第一条（默认）', () => {
    const r = ok({ strategy: 'all_columns' });
    expect(r.dsl).toBe('deduplicate');
    expect(r.config.strategy).toBe('all_columns');
    expect(r.config.keep).toBe('first');
  });

  it('全字段去重，保留最后一条', () => {
    const r = ok({ strategy: 'all_columns', keep: 'last' });
    expect(r.dsl).toBe('deduplicate keep last');
    expect(r.config.keep).toBe('last');
  });

  it('按单个字段去重', () => {
    const r = ok({
      strategy: 'by_columns',
      columns: ['order_id'],
      keep: 'first',
    });
    expect(r.dsl).toContain('deduplicate by [order_id]');
    expect(r.config.columns).toEqual(['order_id']);
  });

  it('按多个字段去重', () => {
    const r = ok({
      strategy: 'by_columns',
      columns: ['order_id', 'customer_id', 'region'],
      keep: 'first',
    });
    expect(r.dsl).toContain('by [order_id], [customer_id], [region]');
    expect(r.config.columns).toEqual(['order_id', 'customer_id', 'region']);
  });

  it('按字段去重 + 保留最后一条 + 单字段排序', () => {
    const r = ok({
      strategy: 'by_columns',
      columns: ['order_id'],
      keep: 'last',
      orderBy: [{ field: 'updated_at', direction: 'desc' }],
    });
    expect(r.dsl).toContain('deduplicate by [order_id] keep last');
    expect(r.dsl).toContain('order by [updated_at] desc');
  });

  it('按字段去重 + 多字段排序', () => {
    const r = ok({
      strategy: 'by_columns',
      columns: ['user_id'],
      keep: 'first',
      orderBy: [
        { field: 'created_at', direction: 'asc' },
        { field: 'score', direction: 'desc' },
      ],
    });
    expect(r.dsl).toContain('order by [created_at] asc, [score] desc');
  });

  it('NULL 置前的排序', () => {
    const r = ok({
      strategy: 'by_columns',
      columns: ['id'],
      keep: 'last',
      orderBy: [{ field: 'closed_at', direction: 'asc', nulls: 'first' }],
    });
    expect(r.dsl).toContain('nulls first');
  });

  it('NULL 置后的排序（显式）', () => {
    const r = ok({
      strategy: 'by_columns',
      columns: ['id'],
      keep: 'last',
      orderBy: [{ field: 'updated_at', direction: 'asc', nulls: 'last' }],
    });
    expect(r.dsl).toContain('nulls last');
  });

  it('排序不指定 NULL 处理时 DSL 省略 nulls 子句', () => {
    const r = ok({
      strategy: 'by_columns',
      columns: ['id'],
      keep: 'first',
      orderBy: [{ field: 'priority', direction: 'desc' }],
    });
    expect(r.dsl).not.toContain('nulls');
  });
});

// ── DSL idempotent ─────────────────────────────────────────────────────

describe('FormDeduplicate — DSL 往返幂等', () => {
  const configs: Record<string, unknown>[] = [
    { strategy: 'all_columns' },
    { strategy: 'all_columns', keep: 'last' },
    { strategy: 'by_columns', columns: ['id'], keep: 'first' },
    {
      strategy: 'by_columns',
      columns: ['a', 'b'],
      keep: 'last',
      orderBy: [{ field: 'ts', direction: 'desc' }],
    },
    {
      strategy: 'by_columns',
      columns: ['x'],
      keep: 'last',
      orderBy: [
        { field: 'rank', direction: 'asc' },
        { field: 'name', direction: 'asc', nulls: 'last' },
      ],
    },
    {
      strategy: 'by_columns',
      columns: ['order_id', 'item_id'],
      keep: 'first',
      orderBy: [{ field: 'created_at', direction: 'desc', nulls: 'first' }],
    },
  ];

  for (const config of configs) {
    it(`export→parse→export: ${JSON.stringify(config)}`, () => {
      const dsl1 = exportPrepOperatorDsl({ id: 't', type: 'deduplicate', config });
      const parsed = parsePrepOperatorDsl(dsl1, 'deduplicate');
      expect(parsed.operator).not.toBeNull();
      const dsl2 = exportPrepOperatorDsl({
        id: 't',
        type: 'deduplicate',
        config: parsed.operator!.config,
      });
      expect(dsl2).toBe(dsl1);
    });
  }
});

// ── DSL 解析 → config ──────────────────────────────────────────────────

describe('FormDeduplicate — DSL 解析准确性', () => {
  it('deduplicate → 全字段去重', () => {
    const parsed = parsePrepOperatorDsl('deduplicate', 'deduplicate');
    expect(parsed.operator!.config.strategy).toBe('all_columns');
    expect(parsed.operator!.config.keep).toBe('first');
    expect(parsed.operator!.config.columns).toBeUndefined();
    expect(parsed.operator!.config.orderBy).toBeUndefined();
  });

  it('deduplicate keep last → 全字段去重保留最后一条', () => {
    const parsed = parsePrepOperatorDsl('deduplicate keep last', 'deduplicate');
    expect(parsed.operator!.config.keep).toBe('last');
  });

  it('deduplicate by [order_id] keep last order by [updated_at] desc', () => {
    const parsed = parsePrepOperatorDsl(
      'deduplicate by [order_id] keep last order by [updated_at] desc',
      'deduplicate'
    );
    const cfg = parsed.operator!.config;
    expect(cfg.strategy).toBe('by_columns');
    expect(cfg.columns).toEqual(['order_id']);
    expect(cfg.keep).toBe('last');
    expect(cfg.orderBy).toEqual([{ field: 'updated_at', direction: 'desc' }]);
  });

  it('解析带 nulls last 的排序', () => {
    const parsed = parsePrepOperatorDsl(
      'deduplicate by [id] keep last order by [created_at] asc nulls last',
      'deduplicate'
    );
    const orderBy = parsed.operator!.config.orderBy as Array<Record<string, string>>;
    expect(orderBy).toHaveLength(1);
    expect(orderBy[0].field).toBe('created_at');
    expect(orderBy[0].nulls).toBe('last');
  });

  it('解析多字段排序', () => {
    const parsed = parsePrepOperatorDsl(
      'deduplicate by [region] keep first order by [priority] desc, [name] asc nulls last',
      'deduplicate'
    );
    const orderBy = parsed.operator!.config.orderBy as Array<Record<string, string>>;
    expect(orderBy).toHaveLength(2);
    expect(orderBy[0].field).toBe('priority');
    expect(orderBy[0].direction).toBe('desc');
    expect(orderBy[1].field).toBe('name');
    expect(orderBy[1].direction).toBe('asc');
  });
});

// ── 组件源码结构检查 ───────────────────────────────────────────────────

describe('FormDeduplicate — 组件结构检查', () => {
  const src = readFileSync(
    resolve(__dirname, '../../src/renderer/components/workflow-forms/FormDeduplicate.tsx'),
    'utf-8'
  );

  it('左侧标签式表单布局', () => {
    expect(src).toContain('GlassFormLabel');
    expect(src).toContain('flex-col');
  });

  it('去重依据使用分段控件（指定字段/整行）', () => {
    expect(src).toContain('GlassSegmentedControl');
    expect(src).toContain("'by_columns'");
    expect(src).toContain("'all_columns'");
  });

  it('去重字段使用下拉多选组件', () => {
    expect(src).toContain('GlassFieldMultiDropdown');
    expect(src).toContain('columnTypes');
  });

  it('下拉触发框复用筛选值标签，超出一行时显示剩余数量', () => {
    const dropdownSrc = readFileSync(
      resolve(
        __dirname,
        '../../src/renderer/components/workflow-forms/shared/GlassFieldMultiDropdown.tsx'
      ),
      'utf-8'
    );
    expect(dropdownSrc).toContain('GlassOverflowTagList');
    expect(dropdownSrc).toContain('values={selected}');
    expect(dropdownSrc).toContain('variant="field"');
  });

  it('去重字段标签的左侧、顶部和底部使用相同的留白', () => {
    const dropdownSrc = readFileSync(
      resolve(
        __dirname,
        '../../src/renderer/components/workflow-forms/shared/GlassFieldMultiDropdown.tsx'
      ),
      'utf-8'
    );
    expect(dropdownSrc).toContain('py-[5px] pl-[5px] pr-2');
  });

  it('字段选择支持全选/半选', () => {
    expect(src).toContain('GlassFieldMultiDropdown');
    // 全选/半选由下拉面板内的 GlassFieldMultiSelect 处理
    const multiSrc = readFileSync(
      resolve(
        __dirname,
        '../../src/renderer/components/workflow-forms/shared/GlassFieldMultiSelect.tsx'
      ),
      'utf-8'
    );
    expect(multiSrc).toContain('selectAll');
    expect(multiSrc).toContain('indeterminate');
  });

  it('重复记录使用 first/last 两个选项', () => {
    expect(src).toContain('GlassOptionSingleSelect');
    expect(src).toContain("'first'");
    expect(src).toContain("'last'");
  });

  it('保留哪条使用字段下拉 + 方向下拉', () => {
    expect(src).toContain('GlassFieldSingleSelect');
    expect(src).toContain("'asc'");
    expect(src).toContain("'desc'");
  });

  it('排序方向默认升序', () => {
    expect(src).toContain("?? 'asc'");
  });

  it('默认保留策略为 first', () => {
    expect(src).toMatch(/\bkeep\b.*'first'/);
  });
});

// ── 真实场景模拟 ──────────────────────────────────────────────────────

describe('FormDeduplicate — 真实使用场景', () => {
  it('电商订单去重：按订单号去重，保留最新（按更新时间降序）', () => {
    const config = {
      strategy: 'by_columns',
      columns: ['order_id'],
      keep: 'last',
      orderBy: [{ field: 'updated_at', direction: 'desc' }],
    };
    const r = ok(config);
    expect(r.dsl).toContain('by [order_id] keep last order by [updated_at] desc');
  });

  it('客户去重：按姓名+手机号联合去重，保留最早创建记录', () => {
    const config = {
      strategy: 'by_columns',
      columns: ['name', 'phone'],
      keep: 'first',
      orderBy: [{ field: 'created_at', direction: 'asc' }],
    };
    const r = ok(config);
    expect(r.dsl).toContain('by [name], [phone]');
    // keep first is the default and is omitted in canonical output
    expect(r.dsl).toContain('order by [created_at] asc');
  });

  it('日志去重：全字段去重（不指定去重字段）', () => {
    const config = { strategy: 'all_columns' };
    const r = ok(config);
    expect(r.dsl).toBe('deduplicate');
  });

  it('排行榜去重：按用户去重，按分数降序保留最高，分数相同按时间升序保留最早', () => {
    const config = {
      strategy: 'by_columns',
      columns: ['user_id'],
      keep: 'first',
      orderBy: [
        { field: 'score', direction: 'desc' },
        { field: 'created_at', direction: 'asc' },
      ],
    };
    const r = ok(config);
    expect(r.config.orderBy).toHaveLength(2);
    expect(r.dsl).toContain('order by [score] desc, [created_at] asc');
  });

  it('NULL 值处理：将空值排到末尾', () => {
    const config = {
      strategy: 'by_columns',
      columns: ['id'],
      keep: 'last',
      orderBy: [{ field: 'closed_at', direction: 'asc', nulls: 'last' }],
    };
    const r = ok(config);
    expect(r.dsl).toContain('nulls last');
  });

  it('切换保留策略：first 和 last 均在 DSL 中体现', () => {
    const first = ok({ strategy: 'by_columns', columns: ['id'], keep: 'first' });
    // keep first is the default and is omitted in canonical output
    expect(first.dsl).not.toContain('keep first');

    const last = ok({ strategy: 'by_columns', columns: ['id'], keep: 'last' });
    expect(last.dsl).toContain('keep last');
    expect(first.dsl).not.toBe(last.dsl);
  });
});
