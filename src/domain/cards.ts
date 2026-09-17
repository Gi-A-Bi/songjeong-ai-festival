import { getSelectionModeForRank, OFFER_COUNT_BY_MODE } from './rewards';
import type {
  CardAward,
  CardPieceCount,
  CardProgress,
  CardType,
  ClassCardProgress,
  MissionResult,
  Team,
} from './types';

export const CARD_TYPES: readonly CardType[] = [
  'thinking',
  'observation',
  'expression',
  'command',
  'verification',
];

/** 카드 한 장을 완성하는 조각 수 */
export const CARD_PIECES = 4;

/** 조각 공개 순서: 왼쪽 위 → 오른쪽 위 → 왼쪽 아래 → 오른쪽 아래 */
export const PIECE_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

/**
 * 다섯 종류에서 서로 다른 종류를 같은 확률로 count개 고른다.
 * 앞에서부터 섞는 Fisher–Yates라 어느 종류든 뽑힐 확률이 같다.
 */
export function drawOfferedTypes(
  count: number,
  random: () => number,
  exclude: readonly CardType[] = [],
): CardType[] {
  const pool = CARD_TYPES.filter((cardType) => !exclude.includes(cardType));
  const size = Math.max(0, Math.min(count, pool.length));
  for (let index = 0; index < size; index += 1) {
    const pick =
      index + Math.min(pool.length - index - 1, Math.floor(random() * (pool.length - index)));
    [pool[index], pool[pick]] = [pool[pick], pool[index]];
  }
  return pool.slice(0, size);
}

export class CardAwardError extends Error {
  readonly reason: 'already-claimed' | 'not-offered';

  constructor(reason: 'already-claimed' | 'not-offered', awardId: string) {
    super(
      reason === 'already-claimed'
        ? `이미 받은 카드 보상입니다: ${awardId}`
        : `제시되지 않은 카드 종류입니다: ${awardId}`,
    );
    this.name = 'CardAwardError';
    this.reason = reason;
  }
}

interface CreateCardAwardInput {
  result: Pick<MissionResult, 'id' | 'missionId' | 'grade' | 'roundNo' | 'rank'>;
  team: Pick<Team, 'id' | 'classId'>;
  now: number;
  random: () => number;
}

/**
 * 순위 결과 하나로 카드 보상 하나를 만든다. ID는 결과 ID와 같아 중복 생성되지 않는다.
 * 자동 배정(3위 이하)은 만들 때 바로 종류를 정하고 받은 상태가 된다.
 */
export function createCardAward({ result, team, now, random }: CreateCardAwardInput): CardAward {
  const selectionMode = getSelectionModeForRank(result.rank);
  const offeredTypes = drawOfferedTypes(OFFER_COUNT_BY_MODE[selectionMode], random);
  const automatic = selectionMode === 'automatic';
  return {
    id: result.id,
    resultId: result.id,
    grade: result.grade,
    classId: team.classId,
    teamId: team.id,
    missionId: result.missionId,
    roundNo: result.roundNo,
    rank: result.rank,
    selectionMode,
    offeredTypes,
    selectedType: automatic ? offeredTypes[0] : null,
    status: automatic ? 'claimed' : 'pending',
    createdAt: now,
    claimedAt: automatic ? now : null,
  };
}

/** 학생이 제시된 후보 중 하나를 골라 보상을 받는다. 받은 보상과 후보 밖 종류는 거부한다. */
export function claimCardAward(award: CardAward, selectedType: CardType, now: number): CardAward {
  if (award.status !== 'pending') throw new CardAwardError('already-claimed', award.id);
  if (!award.offeredTypes.includes(selectedType)) {
    throw new CardAwardError('not-offered', award.id);
  }
  return { ...award, selectedType, status: 'claimed', claimedAt: now };
}

export interface ReofferResult {
  award: CardAward;
  /** 후보나 선택 방식이 바뀌었는지 */
  changed: boolean;
  /** 이미 받은 보상이라 순위가 바뀌어도 그대로 둔 경우 */
  keptClaimed: boolean;
}

/**
 * 교사가 순위를 고쳤을 때 보상을 새 순위에 맞춘다.
 * 이미 받은 보상은 학급 카드가 열린 뒤라 바꾸지 않는다.
 * 아직 고르지 않은 보상은 기존 후보를 최대한 유지하며 개수만 맞춘다.
 */
export function reofferCardAward(
  award: CardAward,
  rank: number,
  now: number,
  random: () => number,
): ReofferResult {
  const selectionMode = getSelectionModeForRank(rank);
  if (award.status === 'claimed') {
    const changed = award.rank !== rank;
    return {
      award: changed ? { ...award, rank } : award,
      changed,
      keptClaimed: changed && award.selectionMode !== selectionMode,
    };
  }
  if (award.selectionMode === selectionMode) {
    return { award: { ...award, rank }, changed: award.rank !== rank, keptClaimed: false };
  }
  const count = OFFER_COUNT_BY_MODE[selectionMode];
  const kept = award.offeredTypes.slice(0, count);
  const offeredTypes = [...kept, ...drawOfferedTypes(count - kept.length, random, kept)];
  const automatic = selectionMode === 'automatic';
  return {
    award: {
      ...award,
      rank,
      selectionMode,
      offeredTypes,
      selectedType: automatic ? offeredTypes[0] : null,
      status: automatic ? 'claimed' : 'pending',
      claimedAt: automatic ? now : null,
    },
    changed: true,
    keptClaimed: false,
  };
}

/** 한 종류를 earned번 받았을 때의 조각 진행도 */
export function toCardProgress(cardType: CardType, earned: number): CardProgress {
  const safe = Math.max(0, Math.floor(earned));
  const pieces = Math.min(CARD_PIECES, safe) as CardPieceCount;
  return {
    cardType,
    earned: safe,
    pieces,
    duplicates: Math.max(0, safe - CARD_PIECES),
    complete: pieces === CARD_PIECES,
  };
}

/** 학급 카드 진행도는 받은(claimed) 보상의 selectedType만 세어 계산한다. */
export function computeClassCardProgress(
  classId: string,
  awards: readonly Pick<CardAward, 'classId' | 'status' | 'selectedType'>[],
): ClassCardProgress {
  const earned = Object.fromEntries(CARD_TYPES.map((cardType) => [cardType, 0])) as Record<
    CardType,
    number
  >;
  for (const award of awards) {
    if (award.classId === classId && award.status === 'claimed' && award.selectedType) {
      earned[award.selectedType] += 1;
    }
  }
  const cards = Object.fromEntries(
    CARD_TYPES.map((cardType) => [cardType, toCardProgress(cardType, earned[cardType])]),
  ) as Record<CardType, CardProgress>;
  const completedCount = CARD_TYPES.filter((cardType) => cards[cardType].complete).length;
  return {
    classId,
    cards,
    completedCount,
    allComplete: completedCount === CARD_TYPES.length,
  };
}

/** 받기 전후 진행도를 비교해 이번에 열린 조각 번호(1~4)를 돌려준다. 이미 완성이면 null */
export function newlyOpenedPiece(before: CardProgress, after: CardProgress): number | null {
  return after.pieces > before.pieces ? after.pieces : null;
}

/**
 * 진행도 캐시와 원장 계산값을 맞춘다. 서로 다르면 원장을 우선한다.
 * stale이 true면 캐시를 원장 값으로 바꿔 써야 한다.
 */
export function reconcileCardProgress(
  cached: ClassCardProgress | undefined,
  ledger: ClassCardProgress,
): { progress: ClassCardProgress; stale: boolean } {
  const stale =
    !cached ||
    CARD_TYPES.some((cardType) => cached.cards[cardType]?.earned !== ledger.cards[cardType].earned);
  return { progress: ledger, stale };
}
