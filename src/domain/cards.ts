import type { CardCounts, CardType, DrawTicket, Exchange } from './types';

export const CARD_TYPES: readonly CardType[] = [
  'thinking',
  'observation',
  'expression',
  'command',
  'verification',
];

/** 카드 종류를 같은 확률(각 20%)로 고른다. 뽑기권을 만들 때 미리 정한다. */
export function drawCardType(random: () => number): CardType {
  const index = Math.min(CARD_TYPES.length - 1, Math.floor(random() * CARD_TYPES.length));
  return CARD_TYPES[index];
}

export function emptyCardCounts(): CardCounts {
  return { thinking: 0, observation: 0, expression: 0, command: 0, verification: 0 };
}

type TicketLedgerFields = Pick<DrawTicket, 'cardType' | 'claimedAt'> & {
  revokedAt?: number | null;
};

/** 회수되지 않은 뽑기권 */
export function isActiveTicket(ticket: { revokedAt?: number | null }): boolean {
  return ticket.revokedAt === null || ticket.revokedAt === undefined;
}

/** 사용한(claimedAt이 있는) 뽑기권만 카드로 센다. 교사가 회수한 뽑기권은 빼고 센다. */
export function countClaimedCards(tickets: readonly TicketLedgerFields[]) {
  const counts = emptyCardCounts();
  for (const ticket of tickets) {
    if (ticket.claimedAt !== null && isActiveTicket(ticket)) counts[ticket.cardType] += 1;
  }
  return counts;
}

/** 학급 카드 수 = 학급 팀들이 획득한 카드 + 받은 교환 - 보낸 교환 */
export function computeClassCardCounts(
  classId: string,
  classTickets: readonly (TicketLedgerFields & Pick<DrawTicket, 'classId'>)[],
  exchanges: readonly Pick<Exchange, 'fromClassId' | 'toClassId' | 'cardType' | 'quantity'>[],
): CardCounts {
  const counts = countClaimedCards(classTickets.filter((ticket) => ticket.classId === classId));
  for (const exchange of exchanges) {
    if (exchange.toClassId === classId) counts[exchange.cardType] += exchange.quantity;
    if (exchange.fromClassId === classId) counts[exchange.cardType] -= exchange.quantity;
  }
  return counts;
}

/** 5종 카드를 각각 1장 이상 가지고 있으면 컬렉션 완성 */
export function isCollectionComplete(counts: CardCounts): boolean {
  return CARD_TYPES.every((cardType) => counts[cardType] >= 1);
}

export function getMissingCardTypes(counts: CardCounts): CardType[] {
  return CARD_TYPES.filter((cardType) => counts[cardType] < 1);
}

export function totalCards(counts: CardCounts): number {
  return CARD_TYPES.reduce((sum, cardType) => sum + counts[cardType], 0);
}

export class TicketAlreadyClaimedError extends Error {
  constructor(ticketId: string) {
    super(`이미 사용한 뽑기권입니다: ${ticketId}`);
    this.name = 'TicketAlreadyClaimedError';
  }
}

/** 뽑기권은 claimedAt이 null일 때만 한 번 사용할 수 있다. */
export function claimTicket<T extends Pick<DrawTicket, 'id' | 'claimedAt'>>(
  ticket: T,
  now: number,
): T {
  if (ticket.claimedAt !== null) throw new TicketAlreadyClaimedError(ticket.id);
  return { ...ticket, claimedAt: now };
}

export interface TicketAdjustmentPlan {
  /** 새로 만들 뽑기권 수 */
  createCount: number;
  /** 회수할 뽑기권 ID. 안 뽑은 것부터, 최근 것부터 고른다. */
  revokeIds: string[];
  /** 회수 대상 중 이미 카드를 뽑은 수 */
  revokedClaimed: number;
}

/**
 * 순위를 고쳤을 때 뽑기권 수를 목표에 맞추는 방법을 정한다.
 * 기록은 지우지 않고, 모자라면 새로 만들고 남으면 회수 표시만 한다.
 */
export function planTicketAdjustment(
  tickets: readonly (Pick<DrawTicket, 'id' | 'claimedAt'> & { revokedAt?: number | null })[],
  target: number,
): TicketAdjustmentPlan {
  const active = tickets.filter(isActiveTicket);
  if (active.length <= target) {
    return { createCount: target - active.length, revokeIds: [], revokedClaimed: 0 };
  }
  const order = [...active].sort((a, b) => {
    const aClaimed = a.claimedAt !== null;
    const bClaimed = b.claimedAt !== null;
    if (aClaimed !== bClaimed) return aClaimed ? 1 : -1;
    if (aClaimed && bClaimed) return (b.claimedAt ?? 0) - (a.claimedAt ?? 0);
    return ticketIndex(b.id) - ticketIndex(a.id);
  });
  const revoke = order.slice(0, active.length - target);
  return {
    createCount: 0,
    revokeIds: revoke.map((ticket) => ticket.id),
    revokedClaimed: revoke.filter((ticket) => ticket.claimedAt !== null).length,
  };
}

/** 뽑기권 ID `${resultId}__${번호}`의 번호. 형식이 다르면 0 */
export function ticketIndex(ticketId: string): number {
  const match = /__(\d+)$/.exec(ticketId);
  return match ? Number(match[1]) : 0;
}

/** 같은 순위 결과에서 새로 만들 뽑기권 번호들 */
export function nextTicketIndexes(ticketIds: readonly string[], count: number): number[] {
  const start = ticketIds.reduce((max, id) => Math.max(max, ticketIndex(id)), 0) + 1;
  return Array.from({ length: count }, (_, offset) => start + offset);
}

/** 확정 화면 미리보기: 사용 수만 알 때 뽑기권 변화 */
export function previewTicketChange(active: number, claimed: number, target: number) {
  if (active <= target) return { added: target - active, revoked: 0, revokedClaimed: 0 };
  const revoked = active - target;
  const unclaimed = Math.max(0, active - claimed);
  return { added: 0, revoked, revokedClaimed: Math.max(0, revoked - unclaimed) };
}
