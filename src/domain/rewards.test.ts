import { describe, expect, it } from 'vitest';
import { getSelectionModeForRank, OFFER_COUNT_BY_MODE, rankByScore } from './rewards';
import { calculateErrorHuntScore } from './scoring';

describe('순위에 따른 카드 종류 선택권', () => {
  it('1위는 3종 중 선택, 2위는 2종 중 선택, 3위 이하는 자동 배정', () => {
    expect(getSelectionModeForRank(1)).toBe('choose_three');
    expect(getSelectionModeForRank(2)).toBe('choose_two');
    expect([3, 4, 5, 6].map(getSelectionModeForRank)).toEqual([
      'automatic',
      'automatic',
      'automatic',
      'automatic',
    ]);
  });

  it('선택 방식별 후보 개수는 3·2·1개이고, 4~6팀 어디서나 팀마다 조각은 하나다', () => {
    expect([1, 2, 3, 6].map((rank) => OFFER_COUNT_BY_MODE[getSelectionModeForRank(rank)])).toEqual([
      3, 2, 1, 1,
    ]);
  });

  it('잘못된 순위는 거부한다', () => {
    expect(() => getSelectionModeForRank(0)).toThrow(RangeError);
    expect(() => getSelectionModeForRank(1.5)).toThrow(RangeError);
  });
});

describe('자동 순위', () => {
  it('점수가 높은 순서, 동점이면 먼저 제출한 팀이 앞선다', () => {
    const ranked = rankByScore([
      { teamId: 'a', score: 100, submittedAt: 3000 },
      { teamId: 'b', score: 200, submittedAt: 5000 },
      { teamId: 'c', score: 100, submittedAt: 1000 },
      { teamId: 'd', score: 100, submittedAt: null },
    ]);
    expect(ranked.map((entry) => [entry.teamId, entry.rank])).toEqual([
      ['b', 1],
      ['c', 2],
      ['a', 3],
      ['d', 4],
    ]);
  });
});

describe('틀린그림 찾기 점수', () => {
  it('찾은 수×100 − 오답×20, 최저 0점', () => {
    expect(
      calculateErrorHuntScore({ found: 3, total: 4, remainingSeconds: 60, wrongTaps: 2 }),
    ).toBe(300 - 40);
    expect(calculateErrorHuntScore({ found: 0, total: 4, remainingSeconds: 0, wrongTaps: 5 })).toBe(
      0,
    );
  });

  it('남은 초×2 시간 보너스는 모두 찾았을 때만 준다', () => {
    expect(
      calculateErrorHuntScore({ found: 4, total: 4, remainingSeconds: 60, wrongTaps: 2 }),
    ).toBe(400 + 120 - 40);
  });

  it('하나도 찾지 않고 바로 제출하면 모두 찾은 팀보다 점수가 낮다', () => {
    const instant = calculateErrorHuntScore({
      found: 0,
      total: 4,
      remainingSeconds: 470,
      wrongTaps: 0,
    });
    const allFound = calculateErrorHuntScore({
      found: 4,
      total: 4,
      remainingSeconds: 240,
      wrongTaps: 0,
    });
    expect(instant).toBe(0);
    expect(allFound).toBeGreaterThan(instant);
  });
});
