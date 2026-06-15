import { useCallback, useEffect, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
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
  anchorRef?: RefObject<HTMLElement | null>;
  placement?: 'top' | 'bottom';
}

const MENU_GAP = 8;
const MENU_HEADER_HEIGHT = 32;
const MENU_MAX_WIDTH = 448;
const MENU_MIN_WIDTH = 280;
const MENU_MAX_LIST_HEIGHT = 256;
const VIEWPORT_PADDING = 12;

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
  anchorRef,
  placement = 'top',
}: SkillMentionMenuProps) {
  const { t } = useTranslation();
  const [portalLayout, setPortalLayout] = useState<{
    style: CSSProperties;
    listMaxHeight: number;
  } | null>(null);

  const updatePortalLayout = useCallback(() => {
    if (!anchorRef?.current || typeof window === 'undefined') {
      setPortalLayout(null);
      return;
    }

    const rect = anchorRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(
      Math.max(rect.width, MENU_MIN_WIDTH),
      MENU_MAX_WIDTH,
      Math.max(MENU_MIN_WIDTH, viewportWidth - VIEWPORT_PADDING * 2)
    );
    const left = Math.min(
      Math.max(rect.left, VIEWPORT_PADDING),
      Math.max(VIEWPORT_PADDING, viewportWidth - width - VIEWPORT_PADDING)
    );

    if (placement === 'bottom') {
      const availableBelow = Math.max(
        96,
        viewportHeight - rect.bottom - MENU_GAP - VIEWPORT_PADDING
      );
      setPortalLayout({
        style: {
          position: 'fixed',
          top: rect.bottom + MENU_GAP,
          left,
          width,
          maxHeight: availableBelow,
        },
        listMaxHeight: Math.max(
          64,
          Math.min(MENU_MAX_LIST_HEIGHT, availableBelow - MENU_HEADER_HEIGHT)
        ),
      });
      return;
    }

    const availableAbove = Math.max(96, rect.top - MENU_GAP - VIEWPORT_PADDING);
    setPortalLayout({
      style: {
        position: 'fixed',
        bottom: viewportHeight - rect.top + MENU_GAP,
        left,
        width,
        maxHeight: availableAbove,
      },
      listMaxHeight: Math.max(
        64,
        Math.min(MENU_MAX_LIST_HEIGHT, availableAbove - MENU_HEADER_HEIGHT)
      ),
    });
  }, [anchorRef, placement]);

  useEffect(() => {
    if (!open || !anchorRef?.current || typeof window === 'undefined') {
      setPortalLayout(null);
      return;
    }

    updatePortalLayout();
    window.addEventListener('resize', updatePortalLayout);
    window.addEventListener('scroll', updatePortalLayout, true);
    return () => {
      window.removeEventListener('resize', updatePortalLayout);
      window.removeEventListener('scroll', updatePortalLayout, true);
    };
  }, [anchorRef, open, updatePortalLayout]);

  if (!open) {
    return null;
  }

  if (anchorRef && !portalLayout && typeof document !== 'undefined') {
    return null;
  }

  const menu = (
    <div
      className={
        portalLayout
          ? 'z-[90] overflow-hidden rounded-xl border border-border-subtle bg-[var(--glass-card-strong)] shadow-elevated backdrop-blur-xl'
          : 'absolute bottom-full left-4 z-40 mb-2 w-[min(28rem,calc(100%-2rem))] overflow-hidden rounded-xl border border-border-subtle bg-[var(--glass-card-strong)] shadow-elevated backdrop-blur-xl'
      }
      style={portalLayout?.style}
    >
      <div className="flex h-8 items-center gap-2 border-b border-border-subtle px-3 text-[12px] font-medium text-text-secondary">
        <AtSign className="h-3.5 w-3.5 text-accent" />
        {t('chat.insertSkill')}
      </div>
      {skills.length > 0 ? (
        <div
          className="overflow-y-auto py-1"
          style={{ maxHeight: portalLayout?.listMaxHeight ?? MENU_MAX_LIST_HEIGHT }}
        >
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

  if (portalLayout && typeof document !== 'undefined') {
    return createPortal(menu, document.body);
  }

  return menu;
}
