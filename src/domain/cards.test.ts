import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '../lib/random';
import {
  CARD_TYPES,
  CardAwardError,
  claimCardAward,
  computeClassCardProgress,
  createCardAward,
  drawOfferedTypes,
  newlyOpenedPiece,
  reconcileCardProgress,
  reofferCardAward,
  toCardProgress,
} from './cards';
import type { CardAward, CardType } from './types';

const team = { id: 'g4-c2-t3', classId: 'g4-c2' };

function award(rank: number, random: () => number = () => 0): CardAward {
  return createCardAward({
    result: { id: `drawing__g4__r1__${team.id}`, missionId: 'drawing', grade: 4, roundNo: 1, rank },
    team,
    now: 100,
    random,
  });
}

function claimed(cardType: CardType, classId = 'g4-c2') {
  return { classId, status: 'claimed' as const, selectedType: cardType };
}

describe('순위별 카드 보상 후보', () => {
  it('1위 3개, 2위 2개, 3위 이하 1개의 후보를 만든다', () => {
    expect([1, 2, 3, 5].map((rank) => award(rank).offeredTypes.length)).toEqual([3, 2, 1, 1]);
  });

  it('한 보상 안의 후보 종류는 중복되지 않는다', () => {
    const random = createSeededRandom(7);
    for (let trial = 0; trial < 300; trial += 1) {
      const offered = drawOfferedTypes(3, random);
      expect(new Set(offered).size).toBe(3);
      expect(offered.every((cardType) => CARD_TYPES.includes(cardType))).toBe(true);
    }
  });

  it('다섯 종류가 후보에 고르게 나온다', () => {
    const random = createSeededRandom(2026);
    const seen: Record<string, number> = Object.fromEntries(
      CARD_TYPES.map((cardType) => [cardType, 0]),
    );
    for (let trial = 0; trial < 5000; trial += 1) {
      seen[drawOfferedTypes(1, random)[0]] += 1;
    }
    for (const cardType of CARD_TYPES) {
      expect(seen[cardType]).toBeGreaterThan(850);
      expect(seen[cardType]).toBeLessThan(1150);
    }
  });

  it('자동 배정은 만들 때 종류가 정해지고 받은 상태가 된다', () => {
    const automatic = award(4);
    expect(automatic).toMatchObject({
      selectionMode: 'automatic',
      status: 'claimed',
      selectedType: automatic.offeredTypes[0],
      claimedAt: 100,
    });
    expect(award(1)).toMatchObject({ selectionMode: 'choose_three', status: 'pending' });
  });

  it('보상 ID는 순위 결과 ID와 같아 결과 하나당 하나만 생긴다', () => {
    const first = award(1);
    expect(first.id).toBe(first.resultId);
  });
});

describe('카드 보상 받기', () => {
  it('후보 안의 종류만 고를 수 있다', () => {
    const pending = award(2);
    const outside = CARD_TYPES.find((cardType) => !pending.offeredTypes.includes(cardType));
    expect(() => claimCardAward(pending, outside as CardType, 200)).toThrow(CardAwardError);
    const taken = claimCardAward(pending, pending.offeredTypes[1], 200);
    expect(taken).toMatchObject({ status: 'claimed', selectedType: pending.offeredTypes[1] });
  });

  it('이미 받은 보상은 다시 받을 수 없다', () => {
    const pending = award(1);
    const taken = claimCardAward(pending, pending.offeredTypes[0], 200);
    expect(() => claimCardAward(taken, pending.offeredTypes[0], 300)).toThrow(
      expect.objectContaining({ reason: 'already-claimed' }),
    );
    const automatic = award(3);
    expect(() => claimCardAward(automatic, automatic.offeredTypes[0], 300)).toThrow(CardAwardError);
  });
});

describe('순위 수정과 카드 보상', () => {
  it('고르기 전 보상은 새 순위의 후보 수로 맞추고 기존 후보를 유지한다', () => {
    const pending = award(1);
    const toSecond = reofferCardAward(pending, 2, 500, () => 0);
    expect(toSecond.award.offeredTypes).toEqual(pending.offeredTypes.slice(0, 2));
    expect(toSecond.award).toMatchObject({ selectionMode: 'choose_two', status: 'pending' });

    const toThird = reofferCardAward(pending, 3, 500, () => 0);
    expect(toThird.award).toMatchObject({ status: 'claimed', selectedType: 'thinking' });

    const up = reofferCardAward(award(3), 1, 500, () => 0);
    expect(up.keptClaimed).toBe(true);
    expect(up.award.status).toBe('claimed');
    expect(up.award.offeredTypes).toHaveLength(1);
  });

  it('2위에서 1위로 올라가면 겹치지 않는 후보를 하나 더한다', () => {
    const pending = award(2, createSeededRandom(3));
    const result = reofferCardAward(pending, 1, 500, createSeededRandom(4));
    expect(result.award.offeredTypes.slice(0, 2)).toEqual(pending.offeredTypes);
    expect(new Set(result.award.offeredTypes).size).toBe(3);
  });
});

describe('네 조각 카드 성장', () => {
  it('0~4회는 0/4~4/4, 이후는 4/4와 중복 +N으로 계산한다', () => {
    expect([0, 1, 2, 3, 4, 5, 7].map((earned) => toCardProgress('command', earned))).toEqual([
      { cardType: 'command', earned: 0, pieces: 0, duplicates: 0, complete: false },
      { cardType: 'command', earned: 1, pieces: 1, duplicates: 0, complete: false },
      { cardType: 'command', earned: 2, pieces: 2, duplicates: 0, complete: false },
      { cardType: 'command', earned: 3, pieces: 3, duplicates: 0, complete: false },
      { cardType: 'command', earned: 4, pieces: 4, duplicates: 0, complete: true },
      { cardType: 'command', earned: 5, pieces: 4, duplicates: 1, complete: true },
      { cardType: 'command', earned: 7, pieces: 4, duplicates: 3, complete: true },
    ]);
  });

  it('학급 진행도는 받은 보상만 세고 다른 학급·고르기 전 보상은 빼고 센다', () => {
    const progress = computeClassCardProgress('g4-c2', [
      claimed('thinking'),
      claimed('thinking'),
      claimed('thinking', 'g4-c1'),
      { classId: 'g4-c2', status: 'pending', selectedType: null },
    ]);
    expect(progress.cards.thinking).toMatchObject({ earned: 2, pieces: 2 });
    expect(progress.cards.observation.pieces).toBe(0);
  });

  it('카드 종류별로 완성을 판정하고 5종 모두 4/4일 때만 전체 완성이다', () => {
    const counts: [CardType, number][] = [
      ['thinking', 4],
      ['observation', 6],
      ['expression', 3],
      ['command', 4],
      ['verification', 4],
    ];
    const awards = counts.flatMap(([cardType, count]) =>
      Array.from({ length: count }, () => claimed(cardType)),
    );
    const partial = computeClassCardProgress('g4-c2', awards);
    expect(CARD_TYPES.filter((cardType) => partial.cards[cardType].complete)).toEqual([
      'thinking',
      'observation',
      'command',
      'verification',
    ]);
    expect(partial.completedCount).toBe(4);
    expect(partial.allComplete).toBe(false);
    expect(partial.cards.observation.duplicates).toBe(2);

    const full = computeClassCardProgress('g4-c2', [...awards, claimed('expression')]);
    expect(full.completedCount).toBe(5);
    expect(full.allComplete).toBe(true);
  });

  it('새로 받은 종류는 다음 조각 하나만 열고 완성 뒤에는 조각이 열리지 않는다', () => {
    expect(newlyOpenedPiece(toCardProgress('expression', 1), toCardProgress('expression', 2))).toBe(
      2,
    );
    expect(
      newlyOpenedPiece(toCardProgress('expression', 4), toCardProgress('expression', 5)),
    ).toBeNull();
  });

  it('진행도 캐시가 원장과 다르면 원장을 우선한다', () => {
    const ledger = computeClassCardProgress('g4-c2', [claimed('verification')]);
    const cached = computeClassCardProgress('g4-c2', [
      claimed('verification'),
      claimed('thinking'),
    ]);
    expect(reconcileCardProgress(cached, ledger)).toEqual({ progress: ledger, stale: true });
    expect(reconcileCardProgress(ledger, ledger).stale).toBe(false);
  });
});
