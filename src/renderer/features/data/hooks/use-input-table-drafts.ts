/**
 * Local input-table drafts — editor state only, never persisted. Creating a
 * draft just stages a row in the list until the user picks a source.
 */
import { useCallback, useState } from 'react';
import { makeLocalId } from '../../../components/data-view/shared';
import type { InputTableDraft } from '../model/types';

export function useInputTableDrafts() {
  const [drafts, setDrafts] = useState<InputTableDraft[]>([]);

  const createDraft = useCallback((name: string): InputTableDraft => {
    const now = Date.now();
    const draft: InputTableDraft = {
      id: makeLocalId('input_table'),
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

export type InputTableDraftsState = ReturnType<typeof useInputTableDrafts>;
