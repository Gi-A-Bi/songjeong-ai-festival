import { describe, expect, it } from 'vitest';
import { getTicketCountForRank, rankByScore } from './rewards';
import { calculateErrorHuntScore } from './scoring';

describe('순위에 따른 뽑기권 수', () => {
  it('1위 3장, 2위 2장, 3위 이하 1장', () => {
    expect(getTicketCountForRank(1)).toBe(3);
    expect(getTicketCountForRank(2)).toBe(2);
    expect([3, 4, 5, 6].map(getTicketCountForRank)).toEqual([1, 1, 1, 1]);
  });

  it('참가 팀이 4~6팀이어도 같은 규칙으로 합계가 정해진다', () => {
    const total = (teams: number) =>
      Array.from({ length: teams }, (_, index) => getTicketCountForRank(index + 1)).reduce(
        (sum, count) => sum + count,
        0,
      );
    expect(total(4)).toBe(7);
    expect(total(5)).toBe(8);
    expect(total(6)).toBe(9);
  });

  it('잘못된 순위는 거부한다', () => {
    expect(() => getTicketCountForRank(0)).toThrow(RangeError);
    expect(() => getTicketCountForRank(1.5)).toThrow(RangeError);
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
