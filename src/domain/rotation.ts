import type { MissionNo, RoundNo, TeamNo } from './types';

export const MISSION_COUNT = 5;
export const ROUND_NUMBERS: readonly RoundNo[] = [1, 2, 3, 4, 5];
export const TEAM_NUMBERS: readonly TeamNo[] = [1, 2, 3, 4, 5];

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** 현재 미션 번호 = ((팀 번호 - 1 + 라운드 번호 - 1) mod 5) + 1 */
export function getMissionNoForRound(teamNo: TeamNo, roundNo: RoundNo): MissionNo {
  return (mod(teamNo - 1 + roundNo - 1, MISSION_COUNT) + 1) as MissionNo;
}

/** 특정 라운드에 특정 미션 교실로 오는 팀 번호 */
export function getTeamNoForMission(missionNo: MissionNo, roundNo: RoundNo): TeamNo {
  return (mod(missionNo - roundNo, MISSION_COUNT) + 1) as TeamNo;
}

/** 팀이 특정 미션을 수행하는 라운드 번호 */
export function getRoundForMission(teamNo: TeamNo, missionNo: MissionNo): RoundNo {
  return (mod(missionNo - teamNo, MISSION_COUNT) + 1) as RoundNo;
}

/** 팀의 1~5라운드 미션 순서 */
export function getMissionSchedule(teamNo: TeamNo): MissionNo[] {
  return ROUND_NUMBERS.map((roundNo) => getMissionNoForRound(teamNo, roundNo));
}
