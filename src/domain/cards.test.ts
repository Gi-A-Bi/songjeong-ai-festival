import { describe, expect, it } from 'vitest';
import {
  claimTicket,
  computeClassCardCounts,
  drawCardType,
  emptyCardCounts,
  getMissingCardTypes,
  isCollectionComplete,
  nextTicketIndexes,
  planTicketAdjustment,
  previewTicketChange,
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
    revokedAt: null,
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

describe('순위 수정 때 뽑기권 맞추기', () => {
  const tickets = [
    { id: 'r1__1', claimedAt: 10, revokedAt: null },
    { id: 'r1__2', claimedAt: null, revokedAt: null },
    { id: 'r1__3', claimedAt: null, revokedAt: null },
  ];

  it('모자라면 새로 만들 수를 알려 주고 번호는 기존 다음부터 쓴다', () => {
    expect(planTicketAdjustment(tickets.slice(0, 1), 3)).toEqual({
      createCount: 2,
      revokeIds: [],
      revokedClaimed: 0,
    });
    expect(nextTicketIndexes(['r1__1', 'r1__4'], 2)).toEqual([5, 6]);
  });

  it('남으면 안 뽑은 뽑기권부터, 번호가 큰 것부터 회수한다', () => {
    expect(planTicketAdjustment(tickets, 2)).toEqual({
      createCount: 0,
      revokeIds: ['r1__3'],
      revokedClaimed: 0,
    });
    expect(planTicketAdjustment(tickets, 0)).toEqual({
      createCount: 0,
      revokeIds: ['r1__3', 'r1__2', 'r1__1'],
      revokedClaimed: 1,
    });
  });

  it('이미 회수한 뽑기권은 세지 않는다', () => {
    const withRevoked = [...tickets, { id: 'r1__4', claimedAt: null, revokedAt: 5 }];
    expect(planTicketAdjustment(withRevoked, 3).createCount).toBe(0);
    expect(planTicketAdjustment(withRevoked, 3).revokeIds).toEqual([]);
  });

  it('회수한 카드는 학급 카드 수에서 빠진다', () => {
    const counts = computeClassCardCounts(
      'c1',
      [{ ...ticket('1', 'thinking', true), revokedAt: 99 }, ticket('2', 'thinking', true)],
      [],
    );
    expect(counts.thinking).toBe(1);
  });

  it('미리보기: 사용 수만으로 회수될 뽑은 카드 수를 계산한다', () => {
    expect(previewTicketChange(3, 2, 1)).toEqual({ added: 0, revoked: 2, revokedClaimed: 1 });
    expect(previewTicketChange(1, 1, 3)).toEqual({ added: 2, revoked: 0, revokedClaimed: 0 });
  });
});
