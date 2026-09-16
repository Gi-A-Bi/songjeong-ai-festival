import { describe, expect, it } from 'vitest';
import {
  claimTicket,
  computeClassCardCounts,
  drawCardType,
  emptyCardCounts,
  getMissingCardTypes,
  isCollectionComplete,
  TicketAlreadyClaimedError,
} from './cards';
import type { CardType, DrawTicket } from './types';

function ticket(id: string, cardType: CardType, claimed: boolean, classId = 'c1'): DrawTicket {
  return {
    id,
    teamId: 't1',
    classId,
    sourceResultId: 'r1',
    cardType,
    claimedAt: claimed ? 1 : null,
    createdAt: 0,
  };
}

describe('카드 5종 완성 판정', () => {
  it('5종을 각각 1장 이상 가지면 완성이다', () => {
    const counts = { thinking: 1, observation: 2, expression: 1, command: 3, verification: 1 };
    expect(isCollectionComplete(counts)).toBe(true);
  });

  it('한 종류라도 없으면 미완성이고 없는 카드를 알려 준다', () => {
    const counts = { ...emptyCardCounts(), thinking: 4, observation: 1, expression: 1, command: 1 };
    expect(isCollectionComplete(counts)).toBe(false);
    expect(getMissingCardTypes(counts)).toEqual(['verification']);
  });

  it('학급 카드 수는 사용한 뽑기권과 교환 기록의 합이다', () => {
    const tickets = [
      ticket('1', 'thinking', true),
      ticket('2', 'thinking', true),
      ticket('3', 'verification', false),
      ticket('4', 'command', true, 'c2'),
    ];
    const counts = computeClassCardCounts('c1', tickets, [
      { fromClassId: 'c1', toClassId: 'c2', cardType: 'thinking', quantity: 1 },
      { fromClassId: 'c2', toClassId: 'c1', cardType: 'command', quantity: 1 },
    ]);
    expect(counts).toEqual({ ...emptyCardCounts(), thinking: 1, command: 1 });
  });
});

describe('사용한 뽑기권 재사용 차단', () => {
  it('처음 사용하면 claimedAt이 기록되고, 다시 사용하면 거부한다', () => {
    const first = claimTicket(ticket('1', 'observation', false), 1234);
    expect(first.claimedAt).toBe(1234);
    expect(() => claimTicket(first, 5678)).toThrow(TicketAlreadyClaimedError);
  });
});

describe('카드 종류 추첨', () => {
  it('난수 범위 전체에서 5종 중 하나를 고른다', () => {
    expect(drawCardType(() => 0)).toBe('thinking');
    expect(drawCardType(() => 0.999999)).toBe('verification');
    expect(drawCardType(() => 0.4)).toBe('expression');
  });
});
