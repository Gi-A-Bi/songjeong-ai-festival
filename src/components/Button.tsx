import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { buttonClassName, type ButtonSize, type ButtonVariant } from './buttonStyles';
import { Icon } from './Icon';
import type { IconName } from './icons';
import './Button.css';

interface CommonButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconEnd?: IconName;
  fullWidth?: boolean;
  children: ReactNode;
}

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>, CommonButtonProps {
  loading?: boolean;
  /** 진행 중에 보여 줄 문구. 없으면 원래 문구를 유지한다. */
  loadingLabel?: string;
}

export function Button({
  variant,
  size,
  icon,
  iconEnd,
  fullWidth,
  loading = false,
  loadingLabel,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName({ variant, size, fullWidth, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="btn__spinner" aria-hidden="true" />
      ) : icon ? (
        <Icon name={icon} size={size === 'xl' ? 'lg' : 'md'} />
      ) : null}
      <span className="btn__label">{loading && loadingLabel ? loadingLabel : children}</span>
      {iconEnd && !loading ? <Icon name={iconEnd} size={size === 'xl' ? 'lg' : 'md'} /> : null}
    </button>
  );
}

type ButtonLinkProps = Omit<LinkProps, 'children'> & CommonButtonProps;

export function ButtonLink({
  variant,
  size,
  icon,
  iconEnd,
  fullWidth,
  children,
  className,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={buttonClassName({ variant, size, fullWidth, className })} {...rest}>
      {icon ? <Icon name={icon} size={size === 'xl' ? 'lg' : 'md'} /> : null}
      <span className="btn__label">{children}</span>
      {iconEnd ? <Icon name={iconEnd} size={size === 'xl' ? 'lg' : 'md'} /> : null}
    </Link>
  );
}
