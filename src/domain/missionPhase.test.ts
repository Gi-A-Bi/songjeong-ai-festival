import { describe, expect, it } from 'vitest';
import {
  getMissionPhase,
  getSubmissionBlocker,
  getWaitingReason,
  isMissionContentHidden,
} from './missionPhase';
import type { FestivalEvent } from './types';

type TeamEvent = Pick<FestivalEvent, 'status' | 'activeGrade' | 'activeRound' | 'boothStatus'>;

/** 팀이 2라운드 부스에서 게임 중일 때 그 팀이 보는 행사 상태 */
const playingRound2: TeamEvent = {
  status: 'active',
  activeGrade: 4,
  activeRound: 2,
  boothStatus: 'active',
};

/** 1라운드를 끝내고 2라운드 부스로 이동하는 중 */
const movingToRound2: TeamEvent = {
  status: 'ready',
  activeGrade: 4,
  activeRound: 1,
  boothStatus: 'ready',
};

const base = {
  event: playingRound2,
  grade: 4 as const,
  missionRound: 2 as const,
  roundStatus: 'active' as const,
  submission: null,
  finalized: false,
};

describe('미션 상태', () => {
  it('지금 게임 중인 라운드의 미션만 제출할 수 있다', () => {
    expect(getMissionPhase(base)).toBe('active');
    expect(getMissionPhase({ ...base, missionRound: 4, roundStatus: 'waiting' })).toBe('waiting');
    expect(getMissionPhase({ ...base, missionRound: 1, roundStatus: 'closed' })).toBe('waiting');
  });

  it('부스가 게임을 시작하기 전에는 제출할 수 없다', () => {
    expect(getMissionPhase({ ...base, event: movingToRound2, roundStatus: 'waiting' })).toBe(
      'waiting',
    );
    expect(
      getMissionPhase({
        ...base,
        event: { ...movingToRound2, boothStatus: 'open' },
        roundStatus: 'waiting',
      }),
    ).toBe('waiting');
  });

  it('게임 시간이 끝나면 미션 정보를 다시 읽기 전에도 제출이 닫힌다', () => {
    const timeUp = { ...playingRound2, boothStatus: 'scoring' as const };
    expect(getMissionPhase({ ...base, event: timeUp })).toBe('waiting');
    expect(
      getMissionPhase({
        ...base,
        event: timeUp,
        submission: { status: 'submitted', reopened: false },
      }),
    ).toBe('scoring');
  });

  it('다른 학년이 진행 중이면 제출할 수 없다', () => {
    expect(getMissionPhase({ ...base, grade: 3 })).toBe('waiting');
  });

  it('교사가 재제출을 허용하면 라운드가 끝났어도 제출할 수 있다', () => {
    expect(
      getMissionPhase({
        ...base,
        event: movingToRound2,
        missionRound: 1,
        roundStatus: 'closed',
        submission: { status: 'draft', reopened: true },
      }),
    ).toBe('active');
  });

  it('제출 뒤 게임이 끝나면 채점 중, 순위가 확정되면 확정', () => {
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
    expect(getWaitingReason({ ...base, roundStatus: 'scoring' })).toBe('missed');
    expect(getWaitingReason({ ...base, event: { ...playingRound2, boothStatus: 'scoring' } })).toBe(
      'missed',
    );
    expect(getWaitingReason({ ...base, grade: 5 })).toBe('idle');
  });

  it('부스에 들어가기 전에는 선생님이 라운드를 열었는지 알려 준다', () => {
    const waiting = { ...base, roundStatus: 'waiting' as const };
    expect(getWaitingReason({ ...waiting, event: movingToRound2 })).toBe('not-opened');
    expect(
      getWaitingReason({ ...waiting, event: { ...movingToRound2, boothStatus: 'open' } }),
    ).toBe('opened');
    // 이동 중에는 다음 라운드가 지금 차례다.
    expect(getWaitingReason({ ...waiting, event: movingToRound2, missionRound: 3 })).toBe(
      'upcoming',
    );
  });
});

describe('저장소 제출 검사', () => {
  it('부스가 게임 중일 때만 받는다', () => {
    const gate = { touring: true, reopened: false };
    expect(getSubmissionBlocker({ ...gate, boothStatus: 'active' })).toBeNull();
    expect(getSubmissionBlocker({ ...gate, boothStatus: 'ready' })).toMatch(/게임을 시작하면/);
    expect(getSubmissionBlocker({ ...gate, boothStatus: 'open' })).toMatch(/게임을 시작하면/);
    expect(getSubmissionBlocker({ ...gate, boothStatus: 'scoring' })).toMatch(
      /게임 시간이 끝났어요/,
    );
    expect(getSubmissionBlocker({ ...gate, boothStatus: 'completed' })).toMatch(
      /게임 시간이 끝났어요/,
    );
  });

  it('진행 학년이 아니면 막고, 재제출 허용이면 통과시킨다', () => {
    expect(
      getSubmissionBlocker({ touring: false, boothStatus: 'active', reopened: false }),
    ).toMatch(/미션 투어 시간이 아니에요/);
    expect(
      getSubmissionBlocker({ touring: false, boothStatus: 'completed', reopened: true }),
    ).toBeNull();
  });
});

describe('게임 시작 전 문제 가리기', () => {
  it('기다리는 동안에는 가리고, 시간이 끝난 미션과 게임 중에는 보여 준다', () => {
    expect(isMissionContentHidden('waiting', 'not-opened')).toBe(true);
    expect(isMissionContentHidden('waiting', 'opened')).toBe(true);
    expect(isMissionContentHidden('waiting', 'upcoming')).toBe(true);
    expect(isMissionContentHidden('waiting', 'idle')).toBe(true);
    expect(isMissionContentHidden('waiting', 'missed')).toBe(false);
    expect(isMissionContentHidden('active', 'opened')).toBe(false);
    expect(isMissionContentHidden('submitted', 'opened')).toBe(false);
  });
});
