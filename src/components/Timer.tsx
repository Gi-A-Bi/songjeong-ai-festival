import type { EventStatus } from '../domain/types';
import { useNow } from '../hooks/useNow';
import { formatClock, formatSpokenDuration } from '../lib/time';
import { Icon } from './Icon';
import './Timer.css';

interface TimerProps {
  status: EventStatus;
  endsAt: number | null;
  pausedRemainingMs: number | null;
  size?: 'md' | 'lg';
}

/** 서버가 정한 종료 시각을 기준으로 남은 시간을 계산하고, 화면 갱신만 브라우저가 한다. */
export function Timer({ status, endsAt, pausedRemainingMs, size = 'md' }: TimerProps) {
  const now = useNow(1000);

  let remainingMs: number | null = null;
  if (status === 'paused') remainingMs = pausedRemainingMs;
  else if (status === 'active' && endsAt !== null) remainingMs = Math.max(0, endsAt - now);

  const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000);

  let tone: 'normal' | 'warning' | 'over' | 'paused' | 'idle' = 'normal';
  let label = '남은 시간';
  if (seconds === null) {
    tone = 'idle';
    label = '라운드 대기';
  } else if (status === 'paused') {
    tone = 'paused';
    label = '일시정지';
  } else if (seconds === 0) {
    tone = 'over';
    label = '시간 종료';
  } else if (seconds <= 60) {
    tone = 'warning';
  }

  const spoken = seconds === null ? '' : ` ${formatSpokenDuration(seconds)}`;

  return (
    <div
      className={`timer timer--${tone} timer--${size}`}
      role="timer"
      aria-label={`${label}${spoken}`}
    >
      <Icon name={tone === 'paused' ? 'pause' : 'timer'} size={size === 'lg' ? 'lg' : 'md'} />
      <span className="timer__label" aria-hidden="true">
        {label}
      </span>
      <span className="timer__value number" aria-hidden="true">
        {seconds === null ? '--:--' : formatClock(seconds)}
      </span>
    </div>
  );
}
