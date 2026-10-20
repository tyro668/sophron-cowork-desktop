import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Table2, TableProperties, Workflow } from 'lucide-react';
import {
  parseDataResourceHref,
  type DataResourceKind,
  type DataResourceTarget,
} from '../../../shared/data-resource-link';
import { useAppStore } from '../../store';

const DATA_LINK_RE = /\[([^\]\n]+)\]\(((?:#\/data\/|sophron:\/\/data\/)[^)\s]+)\)/gi;

export interface DataObjectRef extends DataResourceTarget {
  name: string;
}

/** Data objects referenced via data links (`[name](#/data/...)`), de-duplicated. */
export function extractDataObjects(texts: string[]): DataObjectRef[] {
  const seen = new Map<string, DataObjectRef>();
  for (const text of texts) {
    for (const match of text.matchAll(DATA_LINK_RE)) {
      const target = parseDataResourceHref(match[2]);
      if (!target) continue;
      const key = `${target.kind}:${target.id}`;
      if (!seen.has(key)) seen.set(key, { ...target, name: match[1] });
    }
  }
  return [...seen.values()];
}

export const DATA_OBJECT_ICONS: Record<DataResourceKind, typeof Workflow> = {
  pipeline: Workflow,
  raw_table: Table2,
  result_table: TableProperties,
};

export const DataObjectCards = memo(function DataObjectCards({
  objects,
}: {
  objects: DataObjectRef[];
}) {
  const { t } = useTranslation();
  const navigateToDataElement = useAppStore((state) => state.navigateToDataElement);
  if (objects.length === 0) return null;
  return (
    <div className="space-y-1.5 pt-1">
      {objects.map((object) => {
        const Icon = DATA_OBJECT_ICONS[object.kind];
        return (
          <div
            key={`${object.kind}:${object.id}`}
            className="flex h-12 items-center gap-3 rounded-xl border border-border-muted bg-surface px-3 shadow-soft"
          >
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-text-primary">
                {object.name}
              </span>
              <span className="block text-[11.5px] text-text-muted">
                {t(`messageCard.dataObjectKind.${object.kind}`)}
              </span>
            </span>
            <button
              type="button"
              onClick={() => navigateToDataElement({ kind: object.kind, id: object.id })}
              className="inline-flex h-7 flex-shrink-0 items-center gap-1 rounded-lg border border-border-muted px-2.5 text-xs text-text-secondary hover:border-accent/40 hover:text-text-primary"
            >
              {t('messageCard.openDataObject')}
              <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
});
