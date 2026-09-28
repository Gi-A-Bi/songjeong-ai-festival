import { describe, expect, it } from 'vitest';
import { getTimerRatio, getTimerTone } from './timerTone';

describe('남은 시간 표시', () => {
  it('시작 전에는 대기, 끝나면 종료로 보여 준다', () => {
    expect(getTimerTone(null)).toBe('idle');
    expect(getTimerTone(0)).toBe('over');
  });

  it('마지막 1분은 주의, 마지막 10초는 긴급이다', () => {
    expect(getTimerTone(61)).toBe('normal');
    expect(getTimerTone(60)).toBe('warning');
    expect(getTimerTone(11)).toBe('warning');
    expect(getTimerTone(10)).toBe('urgent');
    expect(getTimerTone(1)).toBe('urgent');
  });

  it('남은 비율은 0과 1 사이로 맞춘다', () => {
    expect(getTimerRatio(300, 600)).toBe(0.5);
    // 게임 시간을 줄인 뒤에도 앞서 시작한 부스의 남은 시간이 더 길 수 있다.
    expect(getTimerRatio(700, 600)).toBe(1);
    expect(getTimerRatio(0, 600)).toBe(0);
    expect(getTimerRatio(null, 600)).toBe(0);
  });

  it('전체 시간을 모르면 남은 시간이 있는 동안 가득 찬 것으로 본다', () => {
    expect(getTimerRatio(30, null)).toBe(1);
    expect(getTimerRatio(0, null)).toBe(0);
  });
});
