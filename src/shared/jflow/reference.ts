/**
 * jflow language reference served to AI authoring (tool `data_get_workflow_dsl_reference`) and
 * embedded in generation prompts. Every example is compiled by tests/jflow/jflow-reference.test.ts.
 */
export const JFLOW_REFERENCE_VERSION = 'jflow/r1';

export type JflowReferenceTopic =
  'overview' | 'workflow' | 'operators' | 'derive_window' | 'reshape' | 'examples' | 'all';

export interface JflowExample {
  id: string;
  title: string;
  text: string;
}

const OVERVIEW = `jflow (${JFLOW_REFERENCE_VERSION}) — pipe-style data-prep language. Each step consumes the table on its left.
- Fields are ALWAYS bracketed: [金额], [Order Date], qualified [left].[id] / [b].[id]. Never bare names, never "double quotes".
- Strings use single quotes: 'paid'; escape a quote by doubling it: 'O''Brien'. Raw SQL text uses '''...'''.
- Tables: source <alias> = @id('local:raw/<RAW_TABLE_ID>') (exact, preferred) or @name('<表名>') (must be unique).
  Results: write @new('<结果表名>') creates a result table; write @id('local:result/<ID>') overwrites an existing one.
  Unknown ids fail with E_REF_NOT_FOUND — copy ids verbatim from the catalog.
- Conditions: if <cond> then <v> elseif <cond> then <v> else <v> end   (CASE WHEN … is also accepted).
- Conditional aggregates: sumif([金额], [状态] = '已付'), countif([金额] > 0), avgif/minif/maxif/countdistinctif.
- Comments: ## comment line. Optional node label: #! label: 中文名 on the line before a step.`;

const WORKFLOW = `File layout:
  pipeline <名称>                       (optional header)
  source <alias> = @id('local:raw/<id>')
  let <name> = <alias> | step | step     (named intermediate result, reusable)
  <alias or name> | step | ... | write @new('<结果表>')
Rules:
- Every flow must end in write; several writes are allowed.
- write options: mode: replace | append | merge (needs keys: [k1], [k2]) ; schema: strict | extend | replace.
- incremental source: source s = @id('local:raw/<id>') incremental: [updated_at]  (write mode must not be replace).
- Multi-input steps reference other names: join <name> …, lookup <name> …, union <name>, <name2> ….
- A sub-flow can be inlined in parentheses: join left (other | where [x] > 0) as o on [k] keep: [left].*, [o].[v].`;

const OPERATORS = `Steps (one per line, each starting with |):
- where <cond>                                   filter rows
- select [a], [b], [新名] = <expr>                keep / compute exactly these columns (full projection)
- drop [a], [b]                                  remove columns
- derive [new] = <expr>, replace [old] = <expr>  add columns; "replace" overwrites an existing column
- rename [old] as [new], prefix 'p_' ([a], [b])
- cast [a] as integer, [d] as date format: '%Y-%m-%d' on_error: null   (types: text integer bigint float double decimal(p,s) boolean date datetime)
- fill [a] with 0, [b] with mean | median | mode | forward | backward
- nullify [a] values ('', 'N/A')                 turn marker values into NULL
- drop_empty fields: [a], [b]
- sort [a], -[b] nulls: last                     "-" = descending
- take 10 | take 1 per: [客户] sort: -[金额]      first N rows (per group)
- distinct | distinct by: [id] sort: -[updated_at] keep: first
- group [k1], [k2] (agg [合计] = sum([金额]), [笔数] = count(*), [已付] = sumif([金额], [状态] = '已付'))
- join inner|left|right|full|semi|anti <name> on [k1], [k2] keep: [left].*, [别名] = [<name>].[col]
    on accepts shared key names or an expression ([left].[id] = [b].[ref_id] and …); keep: lists the full output
    projection — [left].* plus each right column you need; expect: many_to_one guards cardinality.
- lookup <name> on [k] get [col1], [col2]        left lookup that fails on duplicate dimension keys
- union <name>, <name2> by: name               (also intersect / except)
- pivot [维度] values: sum([金额])               | unpivot [m1], [m2] into: ([指标], [值])
- unnest [list_col] | unnest json [payload]
- check [金额] > 0 | check unique [id] | check rows >= 1     assertion: fails the run when violated
- sql '''SELECT … FROM input'''                 escape hatch (the upstream table is named input)
- write @new('结果表') mode: replace`;

const DERIVE_WINDOW = `Window functions go in derive / where with over (...):
  | derive [排名] = row_number() over (partition by [区域] order by [销售额] desc)
  | derive [累计] = sum([金额]) over (partition by [客户] order by [日期])
  | where [日期] = max([日期]) over ()          latest snapshot
Use take … per: … for "top N per group" instead of a manual row_number filter when possible.`;

const RESHAPE = `Reshape:
  | pivot [月份] values: sum([金额])               rows → columns (other columns become the row keys; select them first)
  | unpivot [一月], [二月] into: ([月份], [金额])  columns → rows
  | unnest [标签]                                  one row per list element
  | unnest json [payload]                          expand a JSON object column`;

export const JFLOW_EXAMPLES: JflowExample[] = [
  {
    id: 'filter_derive',
    title: '过滤、条件列、排序',
    text: `source orders = @id('local:raw/RAW_ID')

orders
  | where [状态] <> '取消' and [金额] > 0
  | derive [档位] = if [金额] >= 1000 then '大单' elseif [金额] >= 100 then '中单' else '小单' end
  | sort -[金额]
  | write @new('订单分档')`,
  },
  {
    id: 'group_conditional',
    title: '分组汇总与条件聚合',
    text: `source orders = @id('local:raw/RAW_ID')

orders
  | group [区域] (agg [销售额] = sum([金额]), [订单数] = count(*),
                  [已付金额] = sumif([金额], [状态] = '已付'), [退款单数] = countif([状态] = '退款'))
  | sort -[销售额]
  | write @new('区域汇总')`,
  },
  {
    id: 'join_keep',
    title: '关联维表（keep: 写全输出列）',
    text: `source orders = @id('local:raw/RAW_ID')
source customers = @id('local:raw/DIM_ID')

orders
  | join left customers on [客户ID] keep: [left].*, [客户名称] = [customers].[名称], [customers].[等级]
  | write @new('订单含客户')`,
  },
  {
    id: 'top_per_group',
    title: '每组取前 N',
    text: `source orders = @id('local:raw/RAW_ID')

orders
  | take 3 per: [区域] sort: -[金额]
  | select [区域], [订单号], [金额]
  | write @new('区域前三')`,
  },
];

const EXAMPLES = JFLOW_EXAMPLES.map((example) => `### ${example.title}\n${example.text}`).join(
  '\n\n'
);

const SECTION_BY_TOPIC: Record<JflowReferenceTopic, string> = {
  overview: OVERVIEW,
  workflow: WORKFLOW,
  operators: OPERATORS,
  derive_window: DERIVE_WINDOW,
  reshape: RESHAPE,
  examples: EXAMPLES,
  all: [OVERVIEW, WORKFLOW, OPERATORS, DERIVE_WINDOW, RESHAPE, EXAMPLES].join('\n\n'),
};

export function getJflowReference(topic: JflowReferenceTopic = 'all'): string {
  return SECTION_BY_TOPIC[topic] ?? SECTION_BY_TOPIC.all;
}

export function getJflowQuickReference(): string {
  return [OVERVIEW, OPERATORS].join('\n\n');
}
