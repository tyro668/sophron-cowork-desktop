// AskUserQuestion tool block — read-only display for historical messages
import { useTranslation } from 'react-i18next';
import { HelpCircle } from 'lucide-react';
import type { ToolUseContent, QuestionItem } from '../../types';

interface AskUserQuestionBlockProps {
  block: ToolUseContent;
}

export function AskUserQuestionBlock({ block }: AskUserQuestionBlockProps) {
  const { t } = useTranslation();
  const questions: QuestionItem[] =
    ((block.input as Record<string, unknown>)?.questions as QuestionItem[]) || [];

  const getOptionLetter = (index: number) => String.fromCharCode(65 + index);

  if (questions.length === 0) {
    return (
      <div className="rounded-lg border border-border-subtle p-3.5">
        <span className="text-[13px] text-text-muted">{t('messageCard.noQuestions')}</span>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border-subtle px-3.5 py-2.5">
        <HelpCircle className="h-4 w-4 flex-shrink-0 text-accent" />
        <span className="text-[13px] font-medium text-text-primary">
          {t('messageCard.question')}
        </span>
      </div>

      {/* Questions (read-only) */}
      <div className="space-y-4 p-3.5">
        {questions.map((q, qIdx) => (
          <div key={qIdx} className="space-y-2">
            {q.header && (
              <span className="inline-block rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                {q.header}
              </span>
            )}
            <p className="text-[13px] font-medium text-text-primary">{q.question}</p>
            {q.options && q.options.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {q.options.map((option, optIdx) => (
                  <div
                    key={optIdx}
                    className="flex w-full items-start gap-2.5 rounded-lg border border-border-subtle/70 bg-surface-muted/50 p-2.5 text-left"
                  >
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-surface-active text-[11px] font-medium text-text-secondary">
                      {getOptionLetter(optIdx)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-[13px] text-text-primary">{option.label}</span>
                      {option.description && (
                        <p className="mt-0.5 text-[12px] text-text-muted">{option.description}</p>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
