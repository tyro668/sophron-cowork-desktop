import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import type { Skill } from '../types';
import { getLocalizedSkillDescription } from '../utils/localized-skill';

export interface SkillMention {
  id: string;
  name: string;
  description?: string;
  descriptionEn?: string;
  descriptionZh?: string;
  type: Skill['type'];
}

interface MentionTrigger {
  start: number;
  end: number;
  query: string;
}

interface UseSkillMentionsOptions {
  prompt: string;
  setPrompt: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  isElectron: boolean;
  selectedSkillNames?: string[];
  onSelectedSkillNamesChange?: (names: string[]) => void;
  onSkillSelectionCommit?: (next: { prompt: string; selectedSkillNames: string[] }) => void;
  /** Pick up `pendingSkillMention` from the store (welcome composer only). */
  consumePendingSkill?: boolean;
}

const MAX_VISIBLE_SKILLS = 8;

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function detectMentionTrigger(value: string, cursor: number): MentionTrigger | null {
  const beforeCursor = value.slice(0, cursor);
  const atIndex = beforeCursor.lastIndexOf('@');
  if (atIndex < 0) {
    return null;
  }

  const prefix = beforeCursor.slice(0, atIndex);
  const query = beforeCursor.slice(atIndex + 1);
  if (query.includes('\n') || query.includes(' ') || query.includes('\t') || query.includes('@')) {
    return null;
  }
  if (prefix.length > 0 && !/\s$/.test(prefix)) {
    return null;
  }

  return { start: atIndex, end: cursor, query };
}

export function useSkillMentions({
  prompt,
  setPrompt,
  textareaRef,
  isElectron,
  selectedSkillNames: controlledSelectedSkillNames,
  onSelectedSkillNamesChange,
  onSkillSelectionCommit,
  consumePendingSkill = false,
}: UseSkillMentionsOptions) {
  const { i18n } = useTranslation();
  const skillsStorageChangedAt = useAppStore((state) => state.skillsStorageChangedAt);
  const [availableSkills, setAvailableSkills] = useState<SkillMention[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<SkillMention[]>([]);
  const pendingSkillMention = useAppStore((state) => state.pendingSkillMention);
  useEffect(() => {
    if (!consumePendingSkill || !pendingSkillMention) return;
    const skill = availableSkills.find((item) => item.name === pendingSkillMention);
    if (!skill) return;
    useAppStore.getState().setPendingSkillMention(null);
    setSelectedSkills((current) => {
      if (current.some((item) => item.name === skill.name)) return current;
      const next = [...current, skill];
      onSelectedSkillNamesChange?.(next.map((item) => item.name));
      return next;
    });
    requestAnimationFrame(() => textareaRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableSkills, consumePendingSkill, pendingSkillMention]);
  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const controlledSelectedSignature = useMemo(
    () =>
      controlledSelectedSkillNames
        ? JSON.stringify(controlledSelectedSkillNames.map((name) => name.trim()).filter(Boolean))
        : '',
    [controlledSelectedSkillNames]
  );

  useEffect(() => {
    if (!isElectron || typeof window === 'undefined' || !window.electronAPI) {
      setAvailableSkills([]);
      return;
    }

    let cancelled = false;
    window.electronAPI.skills
      .getAll()
      .then((skills) => {
        if (cancelled) return;
        setAvailableSkills(
          skills
            .filter((skill) => skill.enabled)
            .map((skill) => ({
              id: skill.id,
              name: skill.name,
              description: getLocalizedSkillDescription(
                skill,
                i18n.resolvedLanguage || i18n.language
              ),
              descriptionEn: skill.descriptionEn,
              descriptionZh: skill.descriptionZh,
              type: skill.type,
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      })
      .catch((error) => {
        console.error('[SkillMentions] Failed to load skills:', error);
        if (!cancelled) {
          setAvailableSkills([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [i18n.language, i18n.resolvedLanguage, isElectron, skillsStorageChangedAt]);

  useEffect(() => {
    if (!controlledSelectedSkillNames) {
      return;
    }

    const skillsByName = new Map(
      availableSkills.map((skill) => [normalizeText(skill.name), skill])
    );
    const nextSelectedSkills = controlledSelectedSkillNames
      .map((name) => name.trim())
      .filter(Boolean)
      .map(
        (name): SkillMention =>
          skillsByName.get(normalizeText(name)) || {
            id: `selected-${name}`,
            name,
            type: 'custom',
          }
      );
    const nextSignature = JSON.stringify(nextSelectedSkills.map((skill) => skill.name));

    setSelectedSkills((current) =>
      JSON.stringify(current.map((skill) => skill.name)) === nextSignature
        ? current
        : nextSelectedSkills
    );
  }, [availableSkills, controlledSelectedSignature, controlledSelectedSkillNames]);

  const selectedSkillNames = useMemo(
    () => selectedSkills.map((skill) => skill.name),
    [selectedSkills]
  );

  const filteredSkills = useMemo(() => {
    if (!mentionTrigger) return [];
    const query = normalizeText(mentionTrigger.query);
    const selectedNames = new Set(selectedSkills.map((skill) => normalizeText(skill.name)));

    return availableSkills
      .filter((skill) => {
        if (selectedNames.has(normalizeText(skill.name))) {
          return false;
        }
        if (!query) {
          return true;
        }
        return (
          normalizeText(skill.name).includes(query) ||
          normalizeText(skill.description || '').includes(query) ||
          normalizeText(skill.descriptionEn || '').includes(query) ||
          normalizeText(skill.descriptionZh || '').includes(query)
        );
      })
      .slice(0, MAX_VISIBLE_SKILLS);
  }, [availableSkills, mentionTrigger, selectedSkills]);

  const updateMentionTrigger = useCallback((value: string, cursor: number) => {
    setMentionTrigger(detectMentionTrigger(value, cursor));
    setHighlightedIndex(0);
  }, []);

  const handlePromptChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const nextPrompt = event.target.value;
      setPrompt(nextPrompt);
      updateMentionTrigger(nextPrompt, event.target.selectionStart ?? nextPrompt.length);
    },
    [setPrompt, updateMentionTrigger]
  );

  const closeMentionMenu = useCallback(() => {
    setMentionTrigger(null);
    setHighlightedIndex(0);
  }, []);

  const selectSkill = useCallback(
    (skill: SkillMention) => {
      const nextSelectedSkills = selectedSkills.some((item) => item.name === skill.name)
        ? selectedSkills
        : [...selectedSkills, skill];
      const nextSelectedSkillNames = nextSelectedSkills.map((item) => item.name);
      const textarea = textareaRef.current;
      const cursor = textarea?.selectionStart ?? prompt.length;
      const trigger = mentionTrigger || detectMentionTrigger(prompt, cursor);
      let nextPrompt = prompt;
      let nextCursor = cursor;

      if (trigger) {
        const before = prompt.slice(0, trigger.start).replace(/[ \t]+$/g, '');
        const after = prompt.slice(trigger.end).replace(/^[ \t]+/g, '');
        nextPrompt = before && after ? `${before} ${after}` : before || after;
        nextCursor = before.length + (before && after ? 1 : 0);
      }

      setSelectedSkills(nextSelectedSkills);
      if (onSkillSelectionCommit) {
        onSkillSelectionCommit({
          prompt: nextPrompt,
          selectedSkillNames: nextSelectedSkillNames,
        });
      } else {
        onSelectedSkillNamesChange?.(nextSelectedSkillNames);
        setPrompt(nextPrompt);
      }

      requestAnimationFrame(() => {
        textarea?.focus();
        textarea?.setSelectionRange(nextCursor, nextCursor);
      });

      closeMentionMenu();
    },
    [
      closeMentionMenu,
      mentionTrigger,
      onSkillSelectionCommit,
      onSelectedSkillNamesChange,
      prompt,
      selectedSkills,
      setPrompt,
      textareaRef,
    ]
  );

  /**
   * Insert "@" at the caret (space-separated when needed, since the trigger
   * only fires at a word boundary) and open the same picker typing "@" opens.
   */
  const insertMentionTrigger = useCallback(() => {
    const textarea = textareaRef.current;
    const value = textarea?.value ?? prompt;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? start;
    const before = value.slice(0, start);
    const insert = before.length > 0 && !/\s$/.test(before) ? ' @' : '@';
    const nextPrompt = `${before}${insert}${value.slice(end)}`;
    const nextCursor = start + insert.length;
    setPrompt(nextPrompt);
    updateMentionTrigger(nextPrompt, nextCursor);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCursor, nextCursor);
    });
  }, [prompt, setPrompt, textareaRef, updateMentionTrigger]);

  const removeSkill = useCallback(
    (skillName: string) => {
      const next = selectedSkills.filter((skill) => skill.name !== skillName);
      setSelectedSkills(next);
      onSelectedSkillNamesChange?.(next.map((item) => item.name));
    },
    [onSelectedSkillNamesChange, selectedSkills]
  );

  const clearSelectedSkills = useCallback(() => {
    setSelectedSkills([]);
    onSelectedSkillNamesChange?.([]);
    closeMentionMenu();
  }, [closeMentionMenu, onSelectedSkillNamesChange]);

  const handlePromptKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!mentionTrigger) {
        return false;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlightedIndex((index) =>
          filteredSkills.length > 0 ? (index + 1) % filteredSkills.length : 0
        );
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlightedIndex((index) =>
          filteredSkills.length > 0
            ? (index - 1 + filteredSkills.length) % filteredSkills.length
            : 0
        );
        return true;
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && filteredSkills.length > 0) {
        event.preventDefault();
        selectSkill(filteredSkills[Math.min(highlightedIndex, filteredSkills.length - 1)]);
        return true;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        closeMentionMenu();
        return true;
      }

      return false;
    },
    [closeMentionMenu, filteredSkills, highlightedIndex, mentionTrigger, selectSkill]
  );

  return {
    selectedSkills,
    selectedSkillNames,
    filteredSkills,
    highlightedIndex,
    isMentionMenuOpen: Boolean(mentionTrigger),
    handlePromptChange,
    handlePromptKeyDown,
    selectSkill,
    insertMentionTrigger,
    removeSkill,
    clearSelectedSkills,
    closeMentionMenu,
  };
}
