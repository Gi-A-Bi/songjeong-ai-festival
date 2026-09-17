import { describe, expect, it } from 'vitest';
import { toDeviceCode } from './device';

describe('toDeviceCode', () => {
  it('세션 ID의 끝 네 글자를 대문자로 쓴다', () => {
    expect(toDeviceCode('Xk3vQ9pLm2aB7cD1')).toBe('7CD1');
    expect(toDeviceCode('mock-device-423A')).toBe('423A');
  });

  it('기호는 빼고, 짧은 ID는 0으로 채운다', () => {
    expect(toDeviceCode('a-b_c')).toBe('0ABC');
    expect(toDeviceCode('')).toBe('0000');
  });
});
