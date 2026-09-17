import { useOutletContext } from 'react-router';
import type {
  EventStatus,
  FestivalEvent,
  TeacherProfile,
  TeacherRole,
} from '../../domain/types';
import type { StatusTone } from '../../components/StatusBadge';
import type { IconName } from '../../components/icons';

export interface TeacherContextValue {
  eventId: string;
  event: FestivalEvent;
  teacher: TeacherProfile;
}

export function useTeacherContext(): TeacherContextValue {
  return useOutletContext<TeacherContextValue>();
}

export const EVENT_STATUS_BADGES: Record<
  EventStatus,
  { label: string; tone: StatusTone; icon: IconName }
> = {
  draft: { label: '준비 전', tone: 'neutral', icon: 'edit' },
  ready: { label: '대기', tone: 'info', icon: 'hourglass_top' },
  active: { label: '진행 중', tone: 'primary', icon: 'play_arrow' },
  paused: { label: '일시정지', tone: 'warning', icon: 'pause' },
  final: { label: '최종 미션', tone: 'accent', icon: 'trophy' },
  completed: { label: '종료', tone: 'success', icon: 'task_alt' },
};

export const TEACHER_ROLE_LABELS: Record<TeacherRole, string> = {
  admin: '총괄 운영자',
  station_teacher: '부스 교사',
  homeroom_teacher: '담임교사',
};
