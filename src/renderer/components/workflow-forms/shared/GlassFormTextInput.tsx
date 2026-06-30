import type { InputHTMLAttributes } from 'react';

interface GlassFormTextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
}

export function GlassFormTextInput({
  value,
  onChange,
  placeholder,
  className = '',
  ...rest
}: GlassFormTextInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`h-8 rounded-lg border border-border-muted bg-background/42 px-2.5 text-[13px] text-text-primary shadow-soft outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 ${className}`}
      {...rest}
    />
  );
}
