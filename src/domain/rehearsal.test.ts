import { describe, expect, it } from 'vitest';
import {
  countRehearsalRecords,
  EMPTY_REHEARSAL_COUNTS,
  getResetConfirmPhrase,
  hasRehearsalRecords,
  isResetConfirmed,
  REHEARSAL_RECORD_KEYS,
  REHEARSAL_RECORD_LABELS,
} from './rehearsal';

describe('연습 기록', () => {
  it('남은 기록 수를 모두 더한다', () => {
    expect(countRehearsalRecords(EMPTY_REHEARSAL_COUNTS)).toBe(0);
    expect(
      countRehearsalRecords({ ...EMPTY_REHEARSAL_COUNTS, submissions: 3, checkIns: 2, devices: 1 }),
    ).toBe(6);
  });

  it('기록이 없어도 최종 미션을 열어 두었으면 되돌릴 것이 있다', () => {
    const empty = { grade: 4 as const, counts: EMPTY_REHEARSAL_COUNTS, finalOpened: false };
    expect(hasRehearsalRecords(empty)).toBe(false);
    expect(hasRehearsalRecords({ ...empty, finalOpened: true })).toBe(true);
    expect(
      hasRehearsalRecords({ ...empty, counts: { ...EMPTY_REHEARSAL_COUNTS, boothRounds: 1 } }),
    ).toBe(true);
  });

  it('모든 기록 종류에 이름과 단위가 있다', () => {
    for (const key of REHEARSAL_RECORD_KEYS) {
      expect(REHEARSAL_RECORD_LABELS[key].label).not.toBe('');
      expect(REHEARSAL_RECORD_LABELS[key].unit).not.toBe('');
    }
  });

  it('확인 창에는 지울 학년을 직접 적어야 한다', () => {
    expect(getResetConfirmPhrase(4)).toBe('4학년');
    expect(isResetConfirmed(4, '4학년')).toBe(true);
    expect(isResetConfirmed(4, ' 4 학년 ')).toBe(true);
    expect(isResetConfirmed(4, '3학년')).toBe(false);
    expect(isResetConfirmed(4, '4')).toBe(false);
    expect(isResetConfirmed(4, '')).toBe(false);
  });
});
