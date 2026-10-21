import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '../lib/random';
import {
  CARD_TYPES,
  CardAwardError,
  claimCardAward,
  completedCardTypes,
  computeClassCardProgress,
  createCardAward,
  drawOfferedTypes,
  drawOfferedTypesAvoiding,
  newlyOpenedPiece,
  reconcileCardProgress,
  reofferCardAward,
  resolveCardChoice,
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
  it('1위 3개, 2위 2개, 3위 1개의 후보를 만들고 4위부터는 후보가 없다', () => {
    expect([1, 2, 3, 4, 5].map((rank) => award(rank).offeredTypes.length)).toEqual([3, 2, 1, 0, 0]);
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

  it('3위 무작위 배정은 만들 때 종류가 정해지고 받은 상태가 된다', () => {
    const automatic = award(3);
    expect(automatic).toMatchObject({
      selectionMode: 'automatic',
      status: 'claimed',
      selectedType: automatic.offeredTypes[0],
      claimedAt: 100,
    });
    expect(award(1)).toMatchObject({ selectionMode: 'choose_three', status: 'pending' });
  });

  it('4위부터는 카드 없이 끝난 보상 기록만 남아 학급 카드가 열리지 않는다', () => {
    const none = award(4);
    expect(none).toMatchObject({
      selectionMode: 'none',
      status: 'claimed',
      offeredTypes: [],
      selectedType: null,
    });
    expect(computeClassCardProgress(none.classId, [none]).cards.thinking.earned).toBe(0);
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

  it('보상이 없던 팀이 3위 안에 들면 보상이 생기고, 고르기 전 보상은 4위로 내려가면 없어진다', () => {
    const none = award(4);
    const toFirst = reofferCardAward(none, 1, 500, () => 0);
    expect(toFirst.award).toMatchObject({ selectionMode: 'choose_three', status: 'pending' });
    expect(toFirst.award.offeredTypes).toHaveLength(3);
    expect(toFirst.keptClaimed).toBe(false);

    const toThird = reofferCardAward(none, 3, 500, () => 0);
    expect(toThird.award).toMatchObject({ status: 'claimed', selectedType: 'thinking' });

    const down = reofferCardAward(award(2), 5, 500, () => 0);
    expect(down.award).toMatchObject({
      selectionMode: 'none',
      status: 'claimed',
      offeredTypes: [],
      selectedType: null,
    });

    // 이미 받은 카드(3위)는 4위로 내려가도 그대로 둔다.
    const kept = reofferCardAward(award(3), 4, 500, () => 0);
    expect(kept.keptClaimed).toBe(true);
    expect(kept.award.selectedType).not.toBeNull();
  });

  it('2위에서 1위로 올라가면 겹치지 않는 후보를 하나 더한다', () => {
    const pending = award(2, createSeededRandom(3));
    const result = reofferCardAward(pending, 1, 500, createSeededRandom(4));
    expect(result.award.offeredTypes.slice(0, 2)).toEqual(pending.offeredTypes);
    expect(new Set(result.award.offeredTypes).size).toBe(3);
  });
});

describe('학급이 완성한 종류를 피하는 후보', () => {
  function progressOf(counts: Partial<Record<CardType, number>>) {
    const awards = (Object.entries(counts) as [CardType, number][]).flatMap(([cardType, count]) =>
      Array.from({ length: count }, () => claimed(cardType)),
    );
    return computeClassCardProgress('g4-c2', awards);
  }

  it('완성한 종류를 가려낸다', () => {
    expect(completedCardTypes(progressOf({ thinking: 4, observation: 5, expression: 3 }))).toEqual([
      'thinking',
      'observation',
    ]);
  });

  it('완성하지 않은 종류가 충분하면 완성한 종류는 후보에 넣지 않는다', () => {
    const random = createSeededRandom(11);
    for (let trial = 0; trial < 200; trial += 1) {
      const offered = drawOfferedTypesAvoiding(3, random, ['thinking', 'observation']);
      expect(new Set(offered)).toEqual(new Set(['expression', 'command', 'verification']));
    }
  });

  it('완성하지 않은 종류가 모자랄 때만 완성한 종류로 채우고, 완성하지 않은 종류를 앞에 둔다', () => {
    const random = createSeededRandom(5);
    for (let trial = 0; trial < 200; trial += 1) {
      const offered = drawOfferedTypesAvoiding(3, random, [
        'thinking',
        'observation',
        'expression',
      ]);
      expect(new Set(offered.slice(0, 2))).toEqual(new Set(['command', 'verification']));
      expect(['thinking', 'observation', 'expression']).toContain(offered[2]);
      expect(new Set(offered).size).toBe(3);
    }
    // 다섯 종류를 모두 완성했으면 어느 종류든 후보가 된다.
    expect(drawOfferedTypesAvoiding(3, () => 0, [...CARD_TYPES])).toEqual([
      'thinking',
      'observation',
      'expression',
    ]);
  });

  it('이미 후보에 있는 종류(exclude)는 채울 때도 뽑지 않는다', () => {
    const offered = drawOfferedTypesAvoiding(
      2,
      () => 0,
      ['thinking', 'observation'],
      ['expression', 'command'],
    );
    expect(offered).toEqual(['verification', 'thinking']);
  });

  it('순위 확정 때 학급 진행도를 주면 1위 후보와 3위 무작위 배정 모두 완성한 종류를 피한다', () => {
    const progress = progressOf({ thinking: 4, observation: 4 });
    const first = createCardAward({
      result: { id: 'r1', missionId: 'drawing', grade: 4, roundNo: 1, rank: 1 },
      team,
      now: 100,
      random: () => 0,
      progress,
    });
    expect(first.offeredTypes).toEqual(['expression', 'command', 'verification']);
    const third = createCardAward({
      result: { id: 'r3', missionId: 'drawing', grade: 4, roundNo: 1, rank: 3 },
      team,
      now: 100,
      random: () => 0,
      progress,
    });
    expect(third).toMatchObject({ status: 'claimed', selectedType: 'expression' });

    // 완성하지 않은 종류가 하나뿐이면 그 종류를 앞에 두고 완성한 종류로 채운다.
    const almost = progressOf({ thinking: 4, observation: 4, expression: 4, command: 4 });
    const filled = createCardAward({
      result: { id: 'r1', missionId: 'drawing', grade: 4, roundNo: 1, rank: 1 },
      team,
      now: 100,
      random: () => 0,
      progress: almost,
    });
    expect(filled.offeredTypes[0]).toBe('verification');
    expect(filled.offeredTypes).toHaveLength(3);
  });

  it('순위를 고칠 때 후보를 줄이면 완성한 종류부터 빼고, 더하면 완성한 종류를 피한다', () => {
    const pending = award(1); // 후보: 생각·관찰·표현
    const progress = progressOf({ thinking: 4 });
    const toSecond = reofferCardAward(pending, 2, 500, () => 0, progress);
    expect(toSecond.award.offeredTypes).toEqual(['observation', 'expression']);
    const toThird = reofferCardAward(pending, 3, 500, () => 0, progress);
    expect(toThird.award).toMatchObject({ status: 'claimed', selectedType: 'observation' });

    const none = award(4);
    const toFirst = reofferCardAward(none, 1, 500, () => 0, progress);
    expect(toFirst.award.offeredTypes).toEqual(['observation', 'expression', 'command']);

    const second = award(2); // 후보: 생각·관찰
    const up = reofferCardAward(second, 1, 500, () => 0, progress);
    expect(up.award.offeredTypes).toEqual(['observation', 'thinking', 'expression']);
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

describe('완성한 카드를 골랐을 때 바꿔 받기', () => {
  function progressOf(counts: Partial<Record<CardType, number>>) {
    const awards = (Object.entries(counts) as [CardType, number][]).flatMap(([cardType, count]) =>
      Array.from({ length: count }, () => claimed(cardType)),
    );
    return computeClassCardProgress('g4-c2', awards);
  }
  const offered: CardType[] = ['thinking', 'observation', 'expression'];

  it('완성하지 않은 카드를 고르면 그대로 받는다', () => {
    const progress = progressOf({ thinking: 4, observation: 1 });
    expect(resolveCardChoice('observation', offered, progress)).toEqual({
      cardType: 'observation',
      substitutedFor: null,
    });
  });

  it('완성한 카드를 고르면 후보 중 완성에 가장 가까운 카드로 바꿔 받는다', () => {
    const progress = progressOf({ thinking: 4, observation: 1, expression: 3 });
    expect(resolveCardChoice('thinking', offered, progress)).toEqual({
      cardType: 'expression',
      substitutedFor: 'thinking',
    });
  });

  it('조각 수가 같으면 제시 순서가 앞선 후보로 바꾼다', () => {
    const progress = progressOf({ thinking: 4, observation: 2, expression: 2 });
    expect(resolveCardChoice('thinking', offered, progress).cardType).toBe('observation');
    expect(
      resolveCardChoice('thinking', ['expression', 'thinking', 'observation'], progress),
    ).toEqual({ cardType: 'expression', substitutedFor: 'thinking' });
  });

  it('완성한 후보끼리는 건너뛰고 완성하지 않은 후보만 고른다', () => {
    const progress = progressOf({ thinking: 5, observation: 4, expression: 0 });
    expect(resolveCardChoice('observation', offered, progress)).toEqual({
      cardType: 'expression',
      substitutedFor: 'observation',
    });
  });

  it('후보가 모두 완성이면 고른 대로 두어 중복으로 기록된다', () => {
    const progress = progressOf({ thinking: 4, observation: 4, expression: 6 });
    expect(resolveCardChoice('thinking', offered, progress)).toEqual({
      cardType: 'thinking',
      substitutedFor: null,
    });
  });

  it('후보에 없는 종류는 바꾸지 않아 claimCardAward가 거부한다', () => {
    const progress = progressOf({ command: 4, observation: 1 });
    expect(resolveCardChoice('command', offered, progress)).toEqual({
      cardType: 'command',
      substitutedFor: null,
    });
    const pending = award(1);
    expect(() => claimCardAward(pending, 'command', 200)).toThrow(CardAwardError);
  });
});
