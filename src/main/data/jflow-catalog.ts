/**
 * Resolves the tables a jflow text references (sources and writes) against the local store, so
 * `compileWorkflowJflow` can bind `@id` / `@name` refs and check fields against real columns.
 */
import {
  compileWorkflowJflow,
  parseJflow,
  parseResourceUri,
  type CompiledWorkflow,
  type JflowCatalog,
  type JflowCatalogTable,
} from '../../shared/jflow';
import type { ResourceRef } from '../../shared/jflow';
import type { DataPipelineStore } from './data-pipeline-store';
import { logDataCommandFallback } from './data-command-utils';

function collectRefs(value: unknown, out: ResourceRef[]): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, out);
    return;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.form === 'string' &&
    typeof record.arg === 'string' &&
    record.form.startsWith('@')
  ) {
    out.push(record as unknown as ResourceRef);
  }
  for (const child of Object.values(record)) collectRefs(child, out);
}

export async function resolveJflowCatalog(
  store: DataPipelineStore,
  text: string,
  extra: JflowCatalogTable[] = []
): Promise<JflowCatalog> {
  const parsed = parseJflow(text);
  const refs: ResourceRef[] = [];
  if (parsed.ast) collectRefs(parsed.ast, refs);
  const tables = new Map<string, JflowCatalogTable>();
  for (const table of extra) tables.set(`${table.kind}:${table.id}`, table);
  const rawColumns = async (id: string) => {
    try {
      const preview = await store.previewRawTable({ id, limit: 1 });
      return preview.columnTypes.map((column) => ({
        name: column.name,
        type: column.storageType || column.type,
      }));
    } catch (error) {
      logDataCommandFallback('jflow catalog: column lookup failed', error, { id });
      return null;
    }
  };
  const addRaw = async (id: string) => {
    if (tables.has(`raw:${id}`)) return;
    const record = await store.getRawTableRecord(id);
    if (record) {
      tables.set(`raw:${id}`, {
        id,
        name: record.name,
        kind: 'raw',
        columns: await rawColumns(id),
      });
    }
  };
  const addResult = async (id: string) => {
    if (tables.has(`result:${id}`)) return;
    const record = await store.getResultTableRecord(id);
    if (record) tables.set(`result:${id}`, { id, name: record.name, kind: 'result' });
  };
  for (const ref of refs) {
    if (ref.form === '@id') {
      const uri = parseResourceUri(ref.arg);
      if (uri?.kind === 'raw' && uri.id) await addRaw(uri.id);
      if (uri?.kind === 'result' && uri.id) await addResult(uri.id);
    } else if (ref.form === '@name' || ref.form === '@new') {
      const raw = ref.form === '@name' ? await store.findRawTableRecordByName(ref.arg) : null;
      if (raw) await addRaw(raw.id);
      const dashboard = await store.getDashboard({
        query: ref.arg,
        includeSummary: false,
        includePipelines: false,
        includeRawTables: false,
        includeResultTables: true,
        outputLimit: 50,
      });
      for (const result of dashboard.resultTables.filter((item) => item.name === ref.arg)) {
        await addResult(result.id);
      }
    }
  }
  return { tables: [...tables.values()] };
}

/** Compiles jflow text against the store (refs resolved lazily). */
export async function compileJflowAgainstStore(
  store: DataPipelineStore,
  text: string,
  idPrefix = '',
  extra: JflowCatalogTable[] = []
): Promise<CompiledWorkflow & { catalog: JflowCatalog }> {
  const catalog = await resolveJflowCatalog(store, text, extra);
  return { ...compileWorkflowJflow(text, catalog, idPrefix), catalog };
}
