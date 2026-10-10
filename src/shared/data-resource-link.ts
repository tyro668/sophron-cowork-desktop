export type DataResourceKind = 'pipeline' | 'raw_table' | 'result_table';

export interface DataResourceTarget {
  kind: DataResourceKind;
  id: string;
}

const PATH_BY_KIND: Record<DataResourceKind, string> = {
  pipeline: 'pipelines',
  raw_table: 'raw-tables',
  result_table: 'result-tables',
};

const KIND_BY_PATH: Record<string, DataResourceKind> = {
  task: 'pipeline',
  pipelines: 'pipeline',
  'raw-table': 'raw_table',
  'raw-tables': 'raw_table',
  raw_tables: 'raw_table',
  'result-table': 'result_table',
  'result-tables': 'result_table',
  result_tables: 'result_table',
};

export function createDataResourceHref(kind: DataResourceKind, id: string): string {
  return `#/data/${PATH_BY_KIND[kind]}/${encodeURIComponent(id)}`;
}

export function parseDataResourceHref(href: string | undefined): DataResourceTarget | null {
  if (!href) return null;
  const match =
    href.match(/^#\/data\/([^/?#]+)\/([^?#]+)(?:[?#].*)?$/i) ??
    href.match(/^sophron:\/\/data\/([^/?#]+)\/([^?#]+)(?:[?#].*)?$/i);
  if (!match) return null;

  const kind = KIND_BY_PATH[match[1].toLowerCase()];
  if (!kind) return null;

  try {
    const id = decodeURIComponent(match[2]).trim();
    return id ? { kind, id } : null;
  } catch {
    return null;
  }
}

export function normalizeDataResourceMarkdownLinks(markdown: string): string {
  return markdown.replace(
    /\[([^\]\n]+)\]\((sophron:\/\/data\/[^)\s]+)\)/gi,
    (full, label: string, href: string) => {
      const target = parseDataResourceHref(href);
      return target ? `[${label}](${createDataResourceHref(target.kind, target.id)})` : full;
    }
  );
}
