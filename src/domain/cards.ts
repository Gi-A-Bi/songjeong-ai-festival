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

/** 사용한(claimedAt이 있는) 뽑기권만 카드로 센다. */
export function countClaimedCards(tickets: readonly Pick<DrawTicket, 'cardType' | 'claimedAt'>[]) {
  const counts = emptyCardCounts();
  for (const ticket of tickets) {
    if (ticket.claimedAt !== null) counts[ticket.cardType] += 1;
  }
  return counts;
}

/** 학급 카드 수 = 학급 팀들이 획득한 카드 + 받은 교환 - 보낸 교환 */
export function computeClassCardCounts(
  classId: string,
  classTickets: readonly Pick<DrawTicket, 'cardType' | 'claimedAt' | 'classId'>[],
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
