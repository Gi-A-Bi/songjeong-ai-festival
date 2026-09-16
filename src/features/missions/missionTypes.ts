import type { TeamMissionView } from '../../data/EventRepository';
import type { FestivalEvent, MissionPhase } from '../../domain/types';

/** 다섯 미션 화면이 공통으로 받는 값 */
export interface MissionScreenProps {
  eventId: string;
  view: TeamMissionView;
  event: FestivalEvent;
  phase: MissionPhase;
  /** 제출이 끝나면 미션 정보를 다시 불러온다. */
  onSubmitted: () => void;
}
