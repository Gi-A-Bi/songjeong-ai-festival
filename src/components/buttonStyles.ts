export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg' | 'xl';

export function buttonClassName(options: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}): string {
  const { variant = 'primary', size = 'md', fullWidth = false, className } = options;
  return ['btn', `btn--${variant}`, `btn--${size}`, fullWidth ? 'btn--full' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
}
