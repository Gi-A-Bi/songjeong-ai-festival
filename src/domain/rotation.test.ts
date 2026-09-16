import { describe, expect, it } from 'vitest';
import {
  getMissionNoForRound,
  getMissionSchedule,
  getRoundForMission,
  getTeamNoForMission,
  ROUND_NUMBERS,
  TEAM_NUMBERS,
} from './rotation';

describe('팀 번호에 따른 5라운드 미션 순환', () => {
  it('1라운드에는 팀 번호와 같은 미션에서 출발한다', () => {
    expect(TEAM_NUMBERS.map((teamNo) => getMissionNoForRound(teamNo, 1))).toEqual([1, 2, 3, 4, 5]);
  });

  it('다음 라운드에는 다음 미션으로 가고 5번 다음은 1번이다', () => {
    expect(getMissionSchedule(1)).toEqual([1, 2, 3, 4, 5]);
    expect(getMissionSchedule(3)).toEqual([3, 4, 5, 1, 2]);
    expect(getMissionSchedule(5)).toEqual([5, 1, 2, 3, 4]);
  });

  it('같은 라운드에 두 팀이 같은 미션에 겹치지 않는다', () => {
    for (const roundNo of ROUND_NUMBERS) {
      const missions = TEAM_NUMBERS.map((teamNo) => getMissionNoForRound(teamNo, roundNo));
      expect(new Set(missions).size).toBe(5);
    }
  });

  it('한 팀은 5라운드 동안 5개 미션을 한 번씩 한다', () => {
    for (const teamNo of TEAM_NUMBERS) {
      expect([...getMissionSchedule(teamNo)].sort()).toEqual([1, 2, 3, 4, 5]);
    }
  });

  it('미션·라운드로 팀 번호를, 팀·미션으로 라운드를 거꾸로 찾을 수 있다', () => {
    for (const teamNo of TEAM_NUMBERS) {
      for (const roundNo of ROUND_NUMBERS) {
        const missionNo = getMissionNoForRound(teamNo, roundNo);
        expect(getTeamNoForMission(missionNo, roundNo)).toBe(teamNo);
        expect(getRoundForMission(teamNo, missionNo)).toBe(roundNo);
      }
    }
  });
});
