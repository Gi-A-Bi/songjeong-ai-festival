import { describe, expect, it } from 'vitest';
import {
  calculateOzobotScore,
  getMissionGameDurationMs,
  getOzobotMinutes,
  OZOBOT_CHALLENGES,
  ozobotChallengesOf,
  pickOzobotChallenge,
} from './ozobot';
import { calculateAutoScore } from './scoring';

describe('로봇 길찾기 도전 과제', () => {
  it('사진의 카드 8장이 별 1개 2장, 2개 3장, 3개 3장이고 출발과 도착이 다르다', () => {
    expect(OZOBOT_CHALLENGES).toHaveLength(8);
    expect(ozobotChallengesOf(1).map((item) => item.cardNo)).toEqual([4, 5]);
    expect(ozobotChallengesOf(2).map((item) => item.cardNo)).toEqual([6, 7, 9]);
    expect(ozobotChallengesOf(3).map((item) => item.cardNo)).toEqual([11, 12, 15]);
    for (const item of OZOBOT_CHALLENGES) {
      expect(`${item.start.row}${item.start.col}`).not.toBe(`${item.goal.row}${item.goal.col}`);
      expect(
        Object.values(item.tiles).reduce((sum, count) => sum + (count ?? 0), 0),
      ).toBeGreaterThan(0);
    }
    expect(new Set(OZOBOT_CHALLENGES.map((item) => item.id)).size).toBe(8);
  });

  it('별 1개 5점, 2개 10점, 3개 20점이고 같은 카드는 한 번만 센다', () => {
    const solved = [
      { challengeId: 'card-4', level: 1 as const, at: 1 },
      { challengeId: 'card-7', level: 2 as const, at: 2 },
      { challengeId: 'card-15', level: 3 as const, at: 3 },
      { challengeId: 'card-15', level: 3 as const, at: 4 },
    ];
    expect(calculateOzobotScore(solved)).toBe(35);
    expect(calculateAutoScore({ type: 'ozobot', rules: [] }, { type: 'ozobot', solved })).toBe(35);
    // 예전 답안(준비 완료만 알림)은 0점이다.
    expect(calculateAutoScore({ type: 'ozobot', rules: [] }, { type: 'ozobot', ready: true })).toBe(
      0,
    );
  });

  it('난이도를 고르면 아직 성공하지 않은 카드 가운데 하나를 무작위로 주고, 지금 카드는 피한다', () => {
    expect(pickOzobotChallenge(2, [], null, () => 0)?.id).toBe('card-6');
    expect(pickOzobotChallenge(2, [], null, () => 0.99)?.id).toBe('card-9');
    expect(pickOzobotChallenge(2, ['card-6'], null, () => 0)?.id).toBe('card-7');
    expect(pickOzobotChallenge(2, [], 'card-6', () => 0)?.id).toBe('card-7');
    // 남은 카드가 지금 카드 하나뿐이면 그 카드를 준다.
    expect(pickOzobotChallenge(1, ['card-4'], 'card-5', () => 0)?.id).toBe('card-5');
    expect(pickOzobotChallenge(1, ['card-4', 'card-5'])).toBeNull();
  });

  it('로봇 길찾기 부스는 따로 정한 제한 시간(기본 7분)으로 게임을 시작한다', () => {
    const ten = 10 * 60_000;
    expect(getMissionGameDurationMs({ config: { type: 'ozobot', rules: [] } }, ten)).toBe(
      7 * 60_000,
    );
    expect(
      getMissionGameDurationMs({ config: { type: 'ozobot', rules: [], timeLimitMinutes: 5 } }, ten),
    ).toBe(5 * 60_000);
    expect(
      getMissionGameDurationMs({ config: { type: 'library_check', questions: [] } }, ten),
    ).toBe(ten);
    expect(getOzobotMinutes({ timeLimitMinutes: 0 })).toBe(7);
  });
});
