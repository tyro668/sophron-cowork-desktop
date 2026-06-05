import { useCallback } from 'react';
import type { OperatorFormProps } from './index';
import { GlassFormSection } from './shared/GlassFormSection';
import { GlassSortKeyEditor, type SortKeyEntry } from './shared/GlassSortKeyEditor';

export default function FormSort({ node, fieldCompletions, onNodeChange }: OperatorFormProps) {
  const updateConfig = useCallback(
    (updater: (config: Record<string, unknown>) => Record<string, unknown>) => {
      onNodeChange((current) => ({
        ...current,
        config: updater(current.config),
        updatedAt: Date.now(),
      }));
    },
    [onNodeChange]
  );

  const keys: SortKeyEntry[] = (node.config.keys as SortKeyEntry[]) ?? [];

  return (
    <div className="grid content-start gap-2.5">
      <GlassFormSection title="排序键">
        <GlassSortKeyEditor
          keys={keys}
          fieldCompletions={fieldCompletions}
          onChange={(nextKeys) =>
            updateConfig((cfg) => ({ ...cfg, keys: nextKeys.length > 0 ? nextKeys : undefined }))
          }
        />
      </GlassFormSection>
    </div>
  );
}
