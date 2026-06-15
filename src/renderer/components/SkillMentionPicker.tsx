import { AtSign, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SkillMention } from '../hooks/useSkillMentions';

interface SelectedSkillChipsProps {
  skills: SkillMention[];
  disabled?: boolean;
  onRemove: (skillName: string) => void;
}

interface SkillMentionMenuProps {
  open: boolean;
  skills: SkillMention[];
  highlightedIndex: number;
  onSelect: (skill: SkillMention) => void;
}

export function SelectedSkillChips({ skills, disabled, onRemove }: SelectedSkillChipsProps) {
  const { t } = useTranslation();

  if (skills.length === 0) {
    return null;
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      <span className="inline-flex h-6 items-center gap-1 rounded-full border border-accent/18 bg-accent/8 px-2 text-[12px] font-medium text-accent">
        <AtSign className="h-3.5 w-3.5" />
        {t('chat.selectedSkills')}
      </span>
      {skills.map((skill) => (
        <span
          key={skill.id}
          className="inline-flex h-6 max-w-[14rem] items-center gap-1 rounded-full border border-border-subtle bg-background/70 px-2 text-[12px] text-text-secondary shadow-soft"
          title={skill.description || skill.name}
        >
          <span className="truncate">@{skill.name}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRemove(skill.name)}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t('chat.removeSkill', { name: skill.name })}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

export function SkillMentionMenu({
  open,
  skills,
  highlightedIndex,
  onSelect,
}: SkillMentionMenuProps) {
  const { t } = useTranslation();

  if (!open) {
    return null;
  }

  return (
    <div className="absolute bottom-full left-4 z-40 mb-2 w-[min(28rem,calc(100%-2rem))] overflow-hidden rounded-xl border border-border-subtle bg-[var(--glass-card-strong)] shadow-elevated backdrop-blur-xl">
      <div className="flex h-8 items-center gap-2 border-b border-border-subtle px-3 text-[12px] font-medium text-text-secondary">
        <AtSign className="h-3.5 w-3.5 text-accent" />
        {t('chat.insertSkill')}
      </div>
      {skills.length > 0 ? (
        <div className="max-h-64 overflow-y-auto py-1">
          {skills.map((skill, index) => (
            <button
              key={skill.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(skill)}
              className={`flex w-full items-start gap-2 px-3 py-2 text-left transition-colors ${
                index === highlightedIndex
                  ? 'bg-accent/10 text-text-primary'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
              }`}
            >
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent">
                <AtSign className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">@{skill.name}</span>
                {skill.description && (
                  <span className="mt-0.5 line-clamp-2 block text-[12px] leading-4 text-text-muted">
                    {skill.description}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-3 py-3 text-[12px] text-text-muted">{t('chat.noMatchingSkills')}</div>
      )}
    </div>
  );
}
