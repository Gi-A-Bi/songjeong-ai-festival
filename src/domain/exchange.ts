import type { CardCounts, CardType } from './types';

export interface ExchangeDraft {
  fromClassId: string;
  toClassId: string;
  cardType: CardType;
  quantity: number;
}

export type ExchangeValidationError =
  'missing-class' | 'same-class' | 'invalid-quantity' | 'insufficient-cards';

export const EXCHANGE_ERROR_MESSAGES: Record<ExchangeValidationError, string> = {
  'missing-class': '보내는 학급과 받는 학급을 모두 골라 주세요.',
  'same-class': '같은 학급끼리는 교환할 수 없어요.',
  'invalid-quantity': '수량은 1장 이상의 정수로 입력해 주세요.',
  'insufficient-cards': '보내는 학급이 가진 카드보다 많이 보낼 수 없어요.',
};

/** 교환 가능 여부를 검사한다. 문제가 없으면 null을 돌려준다. */
export function validateExchange(
  draft: ExchangeDraft,
  fromCounts: CardCounts,
): ExchangeValidationError | null {
  if (!draft.fromClassId || !draft.toClassId) return 'missing-class';
  if (draft.fromClassId === draft.toClassId) return 'same-class';
  if (!Number.isInteger(draft.quantity) || draft.quantity < 1) return 'invalid-quantity';
  if (draft.quantity > fromCounts[draft.cardType]) return 'insufficient-cards';
  return null;
}

/** 교환 전후 수량 미리보기 */
export function previewExchange(
  draft: ExchangeDraft,
  fromCounts: CardCounts,
  toCounts: CardCounts,
) {
  const quantity = Number.isInteger(draft.quantity) && draft.quantity > 0 ? draft.quantity : 0;
  return {
    from: { before: fromCounts[draft.cardType], after: fromCounts[draft.cardType] - quantity },
    to: { before: toCounts[draft.cardType], after: toCounts[draft.cardType] + quantity },
  };
}
