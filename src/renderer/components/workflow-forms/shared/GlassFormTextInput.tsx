import type { InputHTMLAttributes } from 'react';

interface GlassFormTextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  textCenter?: boolean;
}

export function GlassFormTextInput({
  value,
  onChange,
  placeholder,
  className = '',
  textCenter,
  ...rest
}: GlassFormTextInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`min-h-7 rounded border border-border-muted bg-background/42 px-2 text-[13px] text-text-primary outline-none transition-colors placeholder:text-[12px] placeholder:text-text-muted focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 ${textCenter ? 'text-center' : ''} ${className}`}
      {...rest}
    />
  );
}
