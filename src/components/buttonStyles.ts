/** gold는 카드 보상·힌트처럼 눈에 띄어야 하는 행동에 쓴다. */
export type ButtonVariant = 'primary' | 'accent' | 'gold' | 'secondary' | 'ghost' | 'danger';
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
