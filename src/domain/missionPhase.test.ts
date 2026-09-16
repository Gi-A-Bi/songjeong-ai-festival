import { describe, expect, it } from 'vitest';
import { getMissionPhase, getSubmissionBlocker, getWaitingReason } from './missionPhase';
import type { FestivalEvent } from './types';

const activeRound2: Pick<FestivalEvent, 'status' | 'activeGrade' | 'activeRound'> = {
  status: 'active',
  activeGrade: 4,
  activeRound: 2,
};

const base = {
  event: activeRound2,
  grade: 4 as const,
  missionRound: 2 as const,
  roundStatus: 'active' as const,
  submission: null,
  finalized: false,
};

describe('미션 상태', () => {
  it('지금 진행 중인 라운드의 미션만 제출할 수 있다', () => {
    expect(getMissionPhase(base)).toBe('active');
    expect(getMissionPhase({ ...base, missionRound: 4, roundStatus: 'waiting' })).toBe('waiting');
    expect(getMissionPhase({ ...base, missionRound: 1, roundStatus: 'closed' })).toBe('waiting');
  });

  it('다른 학년이 진행 중이면 제출할 수 없다', () => {
    expect(getMissionPhase({ ...base, grade: 3 })).toBe('waiting');
  });

  it('교사가 재제출을 허용하면 라운드가 끝났어도 제출할 수 있다', () => {
    expect(
      getMissionPhase({
        ...base,
        event: { ...activeRound2, status: 'ready' },
        missionRound: 1,
        roundStatus: 'closed',
        submission: { status: 'draft', reopened: true },
      }),
    ).toBe('active');
  });

  it('제출 뒤 라운드가 끝나면 채점 중, 순위가 확정되면 확정', () => {
    const submitted = { status: 'submitted' as const, reopened: false };
    expect(getMissionPhase({ ...base, submission: submitted })).toBe('submitted');
    expect(getMissionPhase({ ...base, submission: submitted, roundStatus: 'scoring' })).toBe(
      'scoring',
    );
    expect(getMissionPhase({ ...base, submission: submitted, finalized: true })).toBe('closed');
  });

  it('대기 이유를 알려 준다', () => {
    expect(getWaitingReason({ ...base, missionRound: 4, roundStatus: 'waiting' })).toBe('upcoming');
    expect(getWaitingReason({ ...base, missionRound: 1, roundStatus: 'closed' })).toBe('missed');
    expect(getWaitingReason({ ...base, event: { ...activeRound2, status: 'paused' } })).toBe(
      'paused',
    );
    expect(
      getWaitingReason({
        ...base,
        event: { ...activeRound2, status: 'ready' },
        roundStatus: 'scoring',
      }),
    ).toBe('missed');
    expect(getWaitingReason({ ...base, grade: 5 })).toBe('not-started');
  });
});

describe('저장소 제출 검사', () => {
  it('지금 라운드가 아니거나 멈췄으면 막고, 재제출 허용이면 통과시킨다', () => {
    expect(
      getSubmissionBlocker({ event: activeRound2, grade: 4, roundNo: 2, reopened: false }),
    ).toBe(null);
    expect(
      getSubmissionBlocker({ event: activeRound2, grade: 4, roundNo: 3, reopened: false }),
    ).toMatch(/지금 라운드의 미션이 아니에요/);
    expect(
      getSubmissionBlocker({
        event: { ...activeRound2, status: 'paused' },
        grade: 4,
        roundNo: 2,
        reopened: false,
      }),
    ).toMatch(/멈췄어요/);
    expect(
      getSubmissionBlocker({
        event: { ...activeRound2, status: 'ready' },
        grade: 4,
        roundNo: 1,
        reopened: true,
      }),
    ).toBe(null);
  });
});
