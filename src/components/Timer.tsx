import type { CSSProperties } from 'react';
import type { EventStatus } from '../domain/types';
import { useCountdownSound } from '../hooks/useCountdownSound';
import { useServerNow } from '../hooks/useServerNow';
import { formatClock, formatSpokenDuration } from '../lib/time';
import { getTimerRatio, getTimerTone } from '../lib/timerTone';
import { Icon } from './Icon';
import './Timer.css';

interface TimerProps {
  status: EventStatus;
  endsAt: number | null;
  size?: 'md' | 'lg';
  /** box: 작은 상자, ring: 원형(팀 홈), bar: 화면 너비 막대(미션 화면) */
  variant?: 'box' | 'ring' | 'bar';
  /** 전체 게임 시간. ring과 bar가 남은 비율을 그릴 때 쓴다. */
  totalMs?: number | null;
  /** 마지막 10초와 종료 때 효과음을 낸다. */
  audible?: boolean;
}

/** 서버가 정한 종료 시각을 기준으로 남은 시간을 계산하고, 화면 갱신만 브라우저가 한다. */
export function Timer({
  status,
  endsAt,
  size = 'md',
  variant = 'box',
  totalMs = null,
  audible = false,
}: TimerProps) {
  const now = useServerNow(1000);

  const remainingMs = status === 'active' && endsAt !== null ? Math.max(0, endsAt - now) : null;
  const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  useCountdownSound(seconds, audible);

  const tone = getTimerTone(seconds);
  const label = tone === 'idle' ? '게임 대기' : tone === 'over' ? '시간 종료' : '남은 시간';
  const spoken = seconds === null ? '' : ` ${formatSpokenDuration(seconds)}`;
  const value = seconds === null ? '--:--' : formatClock(seconds);

  if (variant === 'ring') {
    return (
      <TimerRing
        seconds={seconds}
        totalSeconds={totalMs === null ? null : totalMs / 1000}
        label={label}
        size={size}
      />
    );
  }

  if (variant === 'bar') {
    const ratio = getTimerRatio(seconds, totalMs === null ? null : totalMs / 1000);
    // 막대에는 긴박함을 알리는 문구를 쓰고, 낭독기에는 늘 같은 이름을 읽어 준다.
    const barLabel = tone === 'urgent' ? '곧 끝나요!' : tone === 'warning' ? '마지막 1분!' : label;
    return (
      <div
        className={`timer-bar timer-bar--${tone}`}
        role="timer"
        aria-label={`${label}${spoken}`}
        style={{ '--timer-ratio': ratio } as CSSProperties}
      >
        <span className="timer-bar__label" aria-hidden="true">
          <Icon name={tone === 'over' ? 'timer_off' : 'timer'} />
          {barLabel}
        </span>
        <span className="timer-bar__track" aria-hidden="true">
          <span className="timer-bar__fill" />
        </span>
        <span className="timer-bar__value number" aria-hidden="true">
          {value}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`timer timer--${tone} timer--${size}`}
      role="timer"
      aria-label={`${label}${spoken}`}
    >
      <Icon name="timer" size={size === 'lg' ? 'lg' : 'md'} />
      <span className="timer__label" aria-hidden="true">
        {label}
      </span>
      <span className="timer__value number" aria-hidden="true">
        {value}
      </span>
    </div>
  );
}

interface TimerRingProps {
  /** 남은 초. null이면 아직 시작하지 않았다. */
  seconds: number | null;
  /** 고리를 가득 채우는 기준 시간(초) */
  totalSeconds: number | null;
  label?: string;
  size?: 'md' | 'lg' | 'xl';
}

/** 남은 시간을 고리로 보여 준다. 시간 계산은 부르는 쪽이 한다. */
export function TimerRing({ seconds, totalSeconds, label, size = 'md' }: TimerRingProps) {
  const tone = getTimerTone(seconds);
  const ratio = getTimerRatio(seconds, totalSeconds);
  const name = label ?? (tone === 'over' ? '시간 종료' : '남은 시간');
  const spoken = seconds === null ? '' : ` ${formatSpokenDuration(seconds)}`;
  return (
    <div
      className={`timer-ring timer-ring--${tone} timer-ring--${size}`}
      role="timer"
      aria-label={`${name}${spoken}`}
    >
      <svg className="timer-ring__svg" viewBox="0 0 120 120" aria-hidden="true">
        <circle className="timer-ring__track" cx="60" cy="60" r="52" />
        <circle
          className="timer-ring__fill"
          cx="60"
          cy="60"
          r="52"
          pathLength={100}
          strokeDasharray={`${ratio * 100} 100`}
        />
      </svg>
      <span className="timer-ring__label" aria-hidden="true">
        {name}
      </span>
      <span className="timer-ring__value number" aria-hidden="true">
        {seconds === null ? '--:--' : formatClock(seconds)}
      </span>
    </div>
  );
}
