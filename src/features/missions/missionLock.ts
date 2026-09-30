import type { TeamMissionView } from '../../data/EventRepository';
import {
  getMissionLockReason,
  getWaitingReason,
  type MissionLockReason,
} from '../../domain/missionPhase';
import type { FestivalEvent, MissionPhase } from '../../domain/types';

/** 가림막 제목. subject는 조사까지 붙인 말이다("문제가", "그림이"). */
export function missionLockTitle(reason: MissionLockReason, subject: string): string {
  return reason === 'not-entered'
    ? `인증코드를 넣고 입장하면 ${subject} 나타나요`
    : `게임이 시작되면 ${subject} 나타나요`;
}

/** 미션 화면이 지금 문제를 가려야 하는지와 그 이유 */
export function getMissionLock(
  view: Pick<TeamMissionView, 'team' | 'roundNo' | 'roundStatus' | 'checkedIn'>,
  event: FestivalEvent,
  phase: MissionPhase,
): MissionLockReason | null {
  return getMissionLockReason(
    phase,
    getWaitingReason({
      event,
      grade: view.team.grade,
      missionRound: view.roundNo,
      roundStatus: view.roundStatus,
    }),
    view.checkedIn,
  );
}
