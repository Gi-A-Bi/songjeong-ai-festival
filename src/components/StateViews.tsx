import type { ReactNode } from 'react';
import type { AssetKey } from '../assets/manifest';
import { toUserMessage } from '../data/errors';
import { AssetImage } from './AssetImage';
import { Button } from './Button';
import { Icon } from './Icon';
import type { IconName } from './icons';
import './StateViews.css';

export function LoadingView({ label = '불러오는 중이에요' }: { label?: string }) {
  return (
    <div className="state-view" role="status">
      <span className="state-view__spinner" aria-hidden="true" />
      <p className="state-view__title">{label}</p>
    </div>
  );
}

interface EmptyViewProps {
  title: string;
  description?: string;
  icon?: IconName;
  mascot?: AssetKey;
  action?: ReactNode;
}

export function EmptyView({ title, description, icon = 'info', mascot, action }: EmptyViewProps) {
  return (
    <div className="state-view">
      {mascot ? (
        <AssetImage asset={mascot} decorative className="state-view__mascot" />
      ) : (
        <span className="state-view__icon">
          <Icon name={icon} size="xl" />
        </span>
      )}
      <p className="state-view__title">{title}</p>
      {description ? <p className="state-view__description">{description}</p> : null}
      {action}
    </div>
  );
}

interface ErrorViewProps {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorView({
  error,
  title = '문제가 생겼어요',
  onRetry,
  retryLabel = '다시 시도',
}: ErrorViewProps) {
  return (
    <div className="state-view state-view--error" role="alert">
      <AssetImage asset="mascotRetry" decorative className="state-view__mascot" />
      <p className="state-view__title">{title}</p>
      <p className="state-view__description">{toUserMessage(error)}</p>
      {onRetry ? (
        <Button variant="primary" size="lg" icon="refresh" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

type AlertTone = 'danger' | 'warning' | 'info' | 'success';

const ALERT_ICONS: Record<AlertTone, IconName> = {
  danger: 'error',
  warning: 'warning',
  info: 'info',
  success: 'check_circle',
};

interface InlineAlertProps {
  tone: AlertTone;
  children: ReactNode;
  icon?: IconName;
  action?: ReactNode;
}

/** 화면 안의 짧은 안내. 오류는 낭독기가 바로 읽도록 alert 역할을 준다. */
export function InlineAlert({ tone, children, icon, action }: InlineAlertProps) {
  return (
    <div
      className={`inline-alert inline-alert--${tone}`}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <Icon name={icon ?? ALERT_ICONS[tone]} />
      <div className="inline-alert__body">{children}</div>
      {action ? <div className="inline-alert__action">{action}</div> : null}
    </div>
  );
}
