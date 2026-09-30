import { describe, expect, it } from 'vitest';
import {
  createRandomStationCode,
  createRandomStationCodes,
  getStationCodesError,
  isValidStationCode,
  matchesStationCode,
  normalizeStationCode,
} from './stationCode';

const missions = [
  { id: 'golden-bell', room: '시청각실' },
  { id: 'error-hunt', room: '컴퓨터실' },
];

describe('교실 인증코드', () => {
  it('입력에서 숫자만 남기고 네 자리까지 받는다', () => {
    expect(normalizeStationCode(' 1 2-3 4 ')).toBe('1234');
    expect(normalizeStationCode('１２３４５')).toBe('1234');
    expect(normalizeStationCode('ab')).toBe('');
  });

  it('숫자 네 자리만 올바른 코드다', () => {
    expect(isValidStationCode('0912')).toBe(true);
    expect(isValidStationCode('912')).toBe(false);
    expect(isValidStationCode('12a4')).toBe(false);
    expect(isValidStationCode(null)).toBe(false);
  });

  it('학생이 넣은 코드는 숫자만 견준다', () => {
    expect(matchesStationCode('2468', ' 2 4 6 8')).toBe(true);
    expect(matchesStationCode('2468', '2469')).toBe(false);
    expect(matchesStationCode(null, '2468')).toBe(false);
  });

  it('무작위 코드는 네 자리이고 같은 숫자 반복이나 1234는 피하며 교실끼리 겹치지 않는다', () => {
    let seed = 0.1;
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let index = 0; index < 50; index += 1) {
      const code = createRandomStationCode(random);
      expect(code).toMatch(/^\d{4}$/);
      expect(code).not.toMatch(/^(\d)\1+$/);
      expect(code).not.toBe('1234');
    }
    // 같은 값을 되풀이하는 난수라도 교실마다 다른 코드가 나온다.
    const values = [0.13575, 0.13575, 0.24685];
    let at = 0;
    const codes = createRandomStationCodes(['a', 'b'], () => values[at++ % values.length]);
    expect(codes).toEqual({ a: '1357', b: '2468' });
    // 난수가 고장 나도(늘 같은 값) 멈추지 않는다.
    expect(createRandomStationCode(() => 0.1111)).toBe('1111');
  });

  it('저장 전에 자리 수와 겹침을 검사한다', () => {
    expect(
      getStationCodesError({ 'golden-bell': '1357', 'error-hunt': '2468' }, missions),
    ).toBeNull();
    expect(getStationCodesError({ 'golden-bell': '135', 'error-hunt': '2468' }, missions)).toMatch(
      /시청각실/,
    );
    expect(getStationCodesError({ 'golden-bell': '1357', 'error-hunt': '1357' }, missions)).toMatch(
      /같아요/,
    );
    expect(getStationCodesError({ 'golden-bell': '1357' }, missions)).toMatch(/컴퓨터실/);
  });
});
