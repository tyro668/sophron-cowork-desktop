/**
 * Local raw-table drafts — editor state only, never persisted. Creating a
 * draft just stages a row in the list until the user picks a source.
 */
import { useCallback, useState } from 'react';
import { makeLocalId } from '../../../components/data-view/shared';
import type { RawTableDraft } from '../model/types';

export function useRawTableDrafts() {
  const [drafts, setDrafts] = useState<RawTableDraft[]>([]);

  const createDraft = useCallback((name: string): RawTableDraft => {
    const now = Date.now();
    const draft: RawTableDraft = {
      id: makeLocalId('raw_table'),
      name,
      createdAt: now,
      updatedAt: now,
    };
    setDrafts((current) => [draft, ...current]);
    return draft;
  }, []);

  const renameDraft = useCallback((id: string, name: string) => {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, name, updatedAt: Date.now() } : draft))
    );
  }, []);

  const removeDraft = useCallback((id: string) => {
    setDrafts((current) => current.filter((draft) => draft.id !== id));
  }, []);

  const removeDrafts = useCallback((ids: string[]) => {
    setDrafts((current) => current.filter((draft) => !ids.includes(draft.id)));
  }, []);

  return { drafts, createDraft, renameDraft, removeDraft, removeDrafts };
}

export type RawTableDraftsState = ReturnType<typeof useRawTableDrafts>;
