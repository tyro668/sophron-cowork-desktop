import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface HelperToken {
  label: string;
  apply: string;
  cursorOffset?: number;
  i18nDescKey?: string;
}

function functionToken(label: string, descKey?: string): HelperToken {
  return { label, apply: `${label}()`, cursorOffset: label.length + 1, i18nDescKey: descKey };
}

const FN_CHIP =
  'inline-flex h-6 cursor-pointer items-center rounded-md border border-border-muted/60 bg-background/20 px-1.5 font-mono text-[11px] text-text-secondary transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent';

const FUNCTION_GROUPS: Array<{ i18nKey: string; tokens: HelperToken[] }> = [
  {
    i18nKey: 'calcFieldCategoryCondition',
    tokens: [
      {
        label: 'if … then … else … end',
        apply: 'if  then  else  end',
        cursorOffset: 3,
        i18nDescKey: 'calcFieldDesc_ifElseEnd',
      },
      {
        label: 'if … then … end',
        apply: 'if  then  end',
        cursorOffset: 3,
        i18nDescKey: 'calcFieldDesc_ifEnd',
      },
      {
        label: 'case … when … then … end',
        apply: 'case  when  then  end',
        cursorOffset: 5,
        i18nDescKey: 'calcFieldDesc_caseWhenEnd',
      },
    ],
  },
  {
    i18nKey: 'calcFieldCategoryWindow',
    tokens: [
      functionToken('row_number', 'calcFieldDesc_rowNumber'),
      functionToken('rank', 'calcFieldDesc_rank'),
      functionToken('lag', 'calcFieldDesc_lag'),
      functionToken('lead', 'calcFieldDesc_lead'),
    ],
  },
  {
    i18nKey: 'calcFieldCategoryAggregate',
    tokens: [
      functionToken('sum', 'calcFieldDesc_sum'),
      functionToken('avg', 'calcFieldDesc_avg'),
      functionToken('count', 'calcFieldDesc_count'),
      functionToken('min', 'calcFieldDesc_min'),
      functionToken('max', 'calcFieldDesc_max'),
    ],
  },
  {
    i18nKey: 'calcFieldCategoryMath',
    tokens: [
      functionToken('abs', 'calcFieldDesc_abs'),
      functionToken('round', 'calcFieldDesc_round'),
    ],
  },
  {
    i18nKey: 'calcFieldCategoryString',
    tokens: [
      functionToken('upper', 'calcFieldDesc_upper'),
      functionToken('lower', 'calcFieldDesc_lower'),
      functionToken('trim', 'calcFieldDesc_trim'),
      functionToken('length', 'calcFieldDesc_length'),
      functionToken('substr', 'calcFieldDesc_substr'),
      functionToken('split_part', 'calcFieldDesc_splitPart'),
      functionToken('concat', 'calcFieldDesc_concat'),
    ],
  },
  {
    i18nKey: 'calcFieldCategoryNull',
    tokens: [
      functionToken('coalesce', 'calcFieldDesc_coalesce'),
      functionToken('nullif', 'calcFieldDesc_nullif'),
    ],
  },
  {
    i18nKey: 'calcFieldCategoryType',
    tokens: [
      { label: 'CAST', apply: 'CAST( AS )', cursorOffset: 5, i18nDescKey: 'calcFieldDesc_cast' },
    ],
  },
];

interface GlassFunctionHelperProps {
  onInsert: (text: string, cursorOffset?: number) => void;
}

export function GlassFunctionHelper({ onInsert }: GlassFunctionHelperProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string) =>
      t(`data.workflow.formLabels.${key}`, { defaultValue: fallback }),
    [t]
  );

  return (
    <div className="space-y-2">
      {FUNCTION_GROUPS.map((group) => (
        <div key={group.i18nKey}>
          <div className="mb-1 text-[11px] font-medium text-text-muted">
            {tr(group.i18nKey, group.i18nKey)}
          </div>
          <div className="flex flex-wrap gap-1">
            {group.tokens.map((token) => (
              <button
                key={token.label}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onInsert(token.apply, token.cursorOffset);
                }}
                className={FN_CHIP}
                title={token.i18nDescKey ? tr(token.i18nDescKey, token.label) : undefined}
              >
                {token.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
