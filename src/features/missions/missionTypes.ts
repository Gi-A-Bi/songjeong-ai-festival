import type { ReactNode } from 'react';
import type { TeamMissionView } from '../../data/EventRepository';
import type { FestivalEvent, MissionPhase } from '../../domain/types';

/** 다섯 미션 화면이 공통으로 받는 값 */
export interface MissionScreenProps {
  eventId: string;
  view: TeamMissionView;
  event: FestivalEvent;
  phase: MissionPhase;
  /** 아직 입장하지 않았을 때 보여 주는 인증코드 입력. 없으면 null */
  gate: ReactNode;
  /** 제출이 끝나면 미션 정보를 다시 불러온다. */
  onSubmitted: () => void;
}
