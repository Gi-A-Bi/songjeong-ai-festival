import type { IconName } from '../../../components/icons';
import type { StatusTone } from '../../../components/StatusBadge';
import type { MissionRoundStatus, TeamMissionStatus } from '../../../domain/types';

/** 상태는 색(회색·파랑·주황·초록·빨강)과 함께 항상 아이콘과 한국어 상태명으로 보여 준다. */
export const TEAM_STATUS_BADGES: Record<TeamMissionStatus, { tone: StatusTone; icon: IconName }> = {
  scheduled: { tone: 'neutral', icon: 'schedule' },
  checked_in: { tone: 'info', icon: 'login' },
  active: { tone: 'warning', icon: 'play_arrow' },
  completed: { tone: 'success', icon: 'check_circle' },
  moving: { tone: 'success', icon: 'directions_walk' },
  attention: { tone: 'danger', icon: 'warning' },
};

export const BOOTH_STATUS_BADGES: Record<MissionRoundStatus, { tone: StatusTone; icon: IconName }> =
  {
    ready: { tone: 'neutral', icon: 'hourglass_top' },
    active: { tone: 'warning', icon: 'play_arrow' },
    scoring: { tone: 'warning', icon: 'pending' },
    completed: { tone: 'success', icon: 'task_alt' },
  };
