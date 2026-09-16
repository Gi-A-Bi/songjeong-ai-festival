import type { ReactNode } from 'react';
import type { MissionPhase } from '../domain/types';
import { MISSION_PHASE_LABELS } from '../domain/missionPhase';
import { Icon } from './Icon';
import type { IconName } from './icons';
import './StatusBadge.css';

export type StatusTone =
  'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent';

interface StatusBadgeProps {
  tone: StatusTone;
  icon: IconName;
  children: ReactNode;
  size?: 'md' | 'lg';
}

/** 상태는 색만이 아니라 아이콘과 문구를 함께 보여 준다. */
export function StatusBadge({ tone, icon, children, size = 'md' }: StatusBadgeProps) {
  return (
    <span className={`badge badge--${tone} badge--${size}`}>
      <Icon name={icon} size="sm" />
      <span>{children}</span>
    </span>
  );
}

const PHASE_BADGES: Record<MissionPhase, { tone: StatusTone; icon: IconName }> = {
  waiting: { tone: 'neutral', icon: 'hourglass_top' },
  active: { tone: 'primary', icon: 'play_arrow' },
  submitted: { tone: 'info', icon: 'check_circle' },
  scoring: { tone: 'warning', icon: 'pending' },
  closed: { tone: 'success', icon: 'trophy' },
};

export function MissionPhaseBadge({ phase, size }: { phase: MissionPhase; size?: 'md' | 'lg' }) {
  const badge = PHASE_BADGES[phase];
  return (
    <StatusBadge tone={badge.tone} icon={badge.icon} size={size}>
      {MISSION_PHASE_LABELS[phase]}
    </StatusBadge>
  );
}
