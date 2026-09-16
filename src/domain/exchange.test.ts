import { describe, expect, it } from 'vitest';
import { emptyCardCounts } from './cards';
import { previewExchange, validateExchange, type ExchangeDraft } from './exchange';

const fromCounts = { ...emptyCardCounts(), thinking: 2 };
const draft = (patch: Partial<ExchangeDraft>): ExchangeDraft => ({
  fromClassId: 'c1',
  toClassId: 'c2',
  cardType: 'thinking',
  quantity: 1,
  ...patch,
});

describe('보유량을 넘는 교환 차단', () => {
  it('보유량 이하는 허용한다', () => {
    expect(validateExchange(draft({ quantity: 2 }), fromCounts)).toBeNull();
  });

  it('보유량보다 많이 보내면 막는다', () => {
    expect(validateExchange(draft({ quantity: 3 }), fromCounts)).toBe('insufficient-cards');
    expect(validateExchange(draft({ cardType: 'verification' }), fromCounts)).toBe(
      'insufficient-cards',
    );
  });

  it('0장, 음수, 소수, 같은 학급 교환은 막는다', () => {
    expect(validateExchange(draft({ quantity: 0 }), fromCounts)).toBe('invalid-quantity');
    expect(validateExchange(draft({ quantity: -1 }), fromCounts)).toBe('invalid-quantity');
    expect(validateExchange(draft({ quantity: 1.5 }), fromCounts)).toBe('invalid-quantity');
    expect(validateExchange(draft({ toClassId: 'c1' }), fromCounts)).toBe('same-class');
  });

  it('교환 전후 수량을 미리 보여 준다', () => {
    const preview = previewExchange(draft({ quantity: 2 }), fromCounts, emptyCardCounts());
    expect(preview).toEqual({ from: { before: 2, after: 0 }, to: { before: 0, after: 2 } });
  });
});
