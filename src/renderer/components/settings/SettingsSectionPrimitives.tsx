import type { ReactNode } from 'react';

interface SettingsCardProps {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
}

export function SettingsCard({ icon, title, children }: SettingsCardProps) {
  return (
    <section className="ui-group min-w-0 bg-surface">
      <h2 className="ui-group-title gap-2">
        {icon ? (
          <span className="flex shrink-0 text-text-muted [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
        ) : null}
        {title}
      </h2>
      <div>{children}</div>
    </section>
  );
}

interface FieldRowProps {
  label: string;
  children: ReactNode;
}

export function FieldRow({ label, children }: FieldRowProps) {
  return (
    <div className="ui-form-row min-w-0">
      <span className="ui-form-label items-center">{label}</span>
      <div className="ui-form-value min-w-0">{children}</div>
    </div>
  );
}
