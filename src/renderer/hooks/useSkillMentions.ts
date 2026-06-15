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
}: UseSkillMentionsOptions) {
  const { i18n } = useTranslation();
  const skillsStorageChangedAt = useAppStore((state) => state.skillsStorageChangedAt);
  const [availableSkills, setAvailableSkills] = useState<SkillMention[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<SkillMention[]>([]);
  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

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
      setSelectedSkills((current) =>
        current.some((item) => item.name === skill.name) ? current : [...current, skill]
      );

      const textarea = textareaRef.current;
      const cursor = textarea?.selectionStart ?? prompt.length;
      const trigger = mentionTrigger || detectMentionTrigger(prompt, cursor);
      if (trigger) {
        const before = prompt.slice(0, trigger.start).replace(/[ \t]+$/g, '');
        const after = prompt.slice(trigger.end).replace(/^[ \t]+/g, '');
        const nextPrompt = before && after ? `${before} ${after}` : before || after;
        setPrompt(nextPrompt);

        requestAnimationFrame(() => {
          textarea?.focus();
          const nextCursor = before.length + (before && after ? 1 : 0);
          textarea?.setSelectionRange(nextCursor, nextCursor);
        });
      } else {
        requestAnimationFrame(() => textarea?.focus());
      }

      closeMentionMenu();
    },
    [closeMentionMenu, mentionTrigger, prompt, setPrompt, textareaRef]
  );

  const removeSkill = useCallback((skillName: string) => {
    setSelectedSkills((current) => current.filter((skill) => skill.name !== skillName));
  }, []);

  const clearSelectedSkills = useCallback(() => {
    setSelectedSkills([]);
    closeMentionMenu();
  }, [closeMentionMenu]);

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
    removeSkill,
    clearSelectedSkills,
    closeMentionMenu,
  };
}
