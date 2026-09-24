import type { DuckDBConnection } from '@duckdb/node-api';
import { duckDbTypeForDataFieldType } from '../../../shared/data-field-types';
import { SqlQueryConfigSchema } from '../../../shared/operator-schemas/sql-query';
import {
  propagateWorkflowPlanSchemas,
  type PlanColumn,
  type WorkflowPlan,
  type WorkflowPlanDiagnostic,
} from '../../../shared/workflow-plan';
import { buildSqlQuery, describeSqlQuery } from '../operators/sql-query';
import { quoteIdentifier } from '../operators/utils';

/** Enrich the shared plan's schema resolver with native SQL binding, without executing queries. */
export async function resolveSqlQuerySchemas(
  connection: DuckDBConnection,
  plan: WorkflowPlan,
  sourceSchemas: Map<string, PlanColumn[]>
) {
  const resolved = new Map(sourceSchemas);
  const diagnostics: WorkflowPlanDiagnostic[] = [];
  const pending = new Map(
    plan.nodes
      .filter(
        (node) =>
          node.type === 'sql_query' && (node.config as Record<string, unknown>).disabled !== true
      )
      .map((node) => [node.id, node])
  );
  const fail = (id: string, error: unknown) => {
    diagnostics.push({
      code: 'planSqlQueryInvalid',
      severity: 'error',
      nodeId: id,
      nodeType: 'sql_query',
      message: `SQL: ${error instanceof Error ? error.message : String(error)}`,
      params: { message: error instanceof Error ? error.message : String(error) },
    });
    pending.delete(id);
  };
  // Native parsing still runs when upstream column types are not yet known.
  for (const [id, node] of pending) {
    try {
      const config = SqlQueryConfigSchema.parse(node.config);
      const statements = await connection.extractStatements(
        buildSqlQuery(config.sql, 'SELECT NULL AS __unknown')
      );
      if (statements.count !== 1) throw new Error('SQL operator accepts only one query');
    } catch (error) {
      fail(id, error);
    }
  }
  while (pending.size) {
    const { schemas } = propagateWorkflowPlanSchemas(plan, (node) => resolved.get(node.id) ?? null);
    let progressed = false;
    for (const [id, node] of pending) {
      const edge = plan.edges.find((item) => item.targetNodeId === id);
      const upstream = edge ? schemas.get(edge.sourceNodeId) : undefined;
      // Unknown expression types must not be guessed as VARCHAR: that would
      // reject valid numeric queries before their upstream node has executed.
      if (
        !upstream?.known ||
        upstream.columns.some((column) => !column.type && !column.storageType)
      )
        continue;
      try {
        const columns = upstream.columns.map(
          (column) =>
            `CAST(NULL AS ${column.storageType || duckDbTypeForDataFieldType(column.type)}) AS ${quoteIdentifier(column.name)}`
        );
        if (!columns.length) continue;
        const query = buildSqlQuery(
          SqlQueryConfigSchema.parse(node.config).sql,
          `SELECT ${columns.join(', ')} WHERE FALSE`
        );
        resolved.set(id, await describeSqlQuery(connection, query));
        pending.delete(id);
      } catch (error) {
        fail(id, error);
      }
      progressed = true;
    }
    if (!progressed) break;
  }
  return { resolved, diagnostics };
}
