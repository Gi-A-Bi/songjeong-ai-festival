import { useOutletContext } from 'react-router';
import type { FestivalEvent, Team } from '../../domain/types';

export interface TeamContextValue {
  eventId: string;
  team: Team;
  /** 실시간 구독 중인 행사 상태 */
  event: FestivalEvent;
}

export function useTeamContext(): TeamContextValue {
  return useOutletContext<TeamContextValue>();
}
