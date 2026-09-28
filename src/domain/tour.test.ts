import { describe, expect, it } from 'vitest';
import { CHECK_IN_GRACE_MS, DEFAULT_GAME_DURATION_MS } from '../config';
import { EMPTY_BOOTH, type RoundClock } from './boothRound';
import { getMissionNoForRound, ROUND_NUMBERS, TEAM_NUMBERS } from './rotation';
import {
  applyCheckIn,
  applyResultFinalized,
  applyStationStart,
  emptyTeamMissionRecord,
  getCheckInRound,
  getTeamAlerts,
  getTourPhase,
  presentMissionRound,
  presentTeamMissionState,
  summarizeTeamStates,
  teamMissionStateId,
} from './tour';
import type { FestivalEvent } from './types';

const MINUTE = 60_000;

function record() {
  return emptyTeamMissionRecord({
    grade: 4,
    classId: 'g4-c2',
    teamId: 'g4-c2-t3',
    teamNo: 3,
    roundNo: 2,
    expectedMissionId: 'ozobot',
  });
}

function clock(patch: Partial<RoundClock> = {}): RoundClock {
  return {
    phase: 'active',
    closed: false,
    activeElapsedMs: 0,
    endedElapsedMs: 0,
    resultGraceMs: 2 * MINUTE,
    ...patch,
  };
}

/** 한 팀이 보는 행사 상태. 기본은 2라운드 부스에서 게임 중이다. */
function event(patch: Partial<FestivalEvent> = {}): FestivalEvent {
  return {
    id: 'e1',
    title: '',
    schoolName: '',
    status: 'active',
    activeGrade: 4,
    activeRound: 2,
    roundEndsAt: 10 * MINUTE,
    roundEndedAt: null,
    boothStatus: 'active',
    skippedRounds: [],
    gameDurationMs: DEFAULT_GAME_DURATION_MS,
    updatedAt: 0,
    ...patch,
  };
}

describe('예상 미션 계산', () => {
  it('팀 번호와 라운드로 미션 번호를 정하고, 한 라운드에 다섯 팀이 겹치지 않는다', () => {
    expect(getMissionNoForRound(3, 2)).toBe(4);
    expect(getMissionNoForRound(5, 2)).toBe(1);
    for (const roundNo of ROUND_NUMBERS) {
      const missions = TEAM_NUMBERS.map((teamNo) => getMissionNoForRound(teamNo, roundNo));
      expect(new Set(missions).size).toBe(5);
    }
  });

  it('팀 이동 기록 ID는 학급·팀·라운드로 고정이다', () => {
    expect(teamMissionStateId('g4-c2', 3, 2)).toBe('g4-c2_3_2');
    expect(record().id).toBe('g4-c2_3_2');
  });
});

describe('QR 체크인', () => {
  it('예정 교실 QR을 찍으면 입장하고, 다시 찍어도 기록은 그대로다', () => {
    const first = applyCheckIn(record(), 'ozobot', 1000);
    expect(first.kind).toBe('checked_in');
    expect(first.record).toMatchObject({ checkedInAt: 1000, actualMissionId: 'ozobot' });

    const again = applyCheckIn(first.record, 'ozobot', 5000);
    expect(again.kind).toBe('already_checked_in');
    expect(again.record).toBe(first.record);
  });

  it('다른 교실 QR을 찍으면 입장 처리하지 않고 오입장 경고만 남긴다', () => {
    const wrong = applyCheckIn(record(), 'drawing', 1000);
    expect(wrong.kind).toBe('wrong_station');
    expect(wrong.record).toMatchObject({ checkedInAt: null, wrongStationId: 'drawing' });
    expect(getTeamAlerts(wrong.record, clock())).toEqual(['wrong_station']);
    expect(presentTeamMissionState(wrong.record, clock()).status).toBe('attention');

    // 올바른 교실에 입장하면 경고가 풀린다.
    const fixed = applyCheckIn(wrong.record, 'ozobot', 2000);
    expect(fixed.kind).toBe('checked_in');
    expect(getTeamAlerts(fixed.record, clock())).toEqual([]);
  });

  it('이미 입장한 팀이 다른 QR을 찍어도 위치 기록은 바뀌지 않는다', () => {
    const checkedIn = applyCheckIn(record(), 'ozobot', 1000).record;
    const wrong = applyCheckIn(checkedIn, 'drawing', 2000);
    expect(wrong.kind).toBe('wrong_station');
    expect(wrong.record).toBe(checkedIn);
  });

  it('부스에 들어가기 전에는 다음 라운드 교실로 간다', () => {
    expect(getCheckInRound(event(), 4)).toBe(2);
    expect(getCheckInRound(event({ status: 'ready', roundEndedAt: 1 }), 4)).toBe(3);
    expect(getCheckInRound(event({ status: 'ready', activeRound: 0 }), 4)).toBe(1);
    expect(getCheckInRound(event({ status: 'ready', activeRound: 5 }), 4)).toBeNull();
    expect(getCheckInRound(event(), 3)).toBeNull();
  });
});

describe('팀 상태 흐름', () => {
  it('scheduled → checked_in → active → completed → moving 순서로 바뀐다', () => {
    const scheduled = record();
    expect(presentTeamMissionState(scheduled, clock()).status).toBe('scheduled');

    const checkedIn = applyCheckIn(scheduled, 'ozobot', 1000).record;
    expect(presentTeamMissionState(checkedIn, clock()).status).toBe('checked_in');

    const active = applyStationStart(checkedIn, 2000);
    expect(active.startedAt).toBe(2000);
    expect(presentTeamMissionState(active, clock()).status).toBe('active');

    // 순위를 확정하면 완료, 선생님이 라운드를 종료해야 이동한다.
    const completed = applyResultFinalized(active, 'r1', 3000);
    expect(presentTeamMissionState(completed, clock()).status).toBe('completed');
    expect(presentTeamMissionState(completed, clock({ phase: 'ended' })).status).toBe('completed');
    expect(presentTeamMissionState(completed, clock({ phase: 'ended', closed: true })).status).toBe(
      'moving',
    );
  });

  it('부스가 미션을 시작해도 입장하지 않은 팀은 진행 중이 되지 않는다', () => {
    const scheduled = record();
    expect(applyStationStart(scheduled, 2000)).toBe(scheduled);
    // 이미 시작한 부스에 늦게 들어오면 바로 진행 중이다.
    expect(applyCheckIn(scheduled, 'ozobot', 3000, true).record.startedAt).toBe(3000);
  });

  it('결과 확정은 같은 결과로 다시 불러도 그대로다', () => {
    const done = applyResultFinalized(record(), 'r1', 3000);
    expect(applyResultFinalized(done, 'r1', 9000)).toBe(done);
    expect(done.completedAt).toBe(3000);
  });
});

describe('경고 계산', () => {
  it('게임 시작 후 2분이 지나도 체크인하지 않으면 미도착이다', () => {
    expect(getTeamAlerts(record(), clock({ activeElapsedMs: CHECK_IN_GRACE_MS - 1 }))).toEqual([]);
    expect(getTeamAlerts(record(), clock({ activeElapsedMs: CHECK_IN_GRACE_MS }))).toEqual([
      'not_arrived',
    ]);
    const checkedIn = applyCheckIn(record(), 'ozobot', 1000).record;
    expect(getTeamAlerts(checkedIn, clock({ activeElapsedMs: 5 * MINUTE }))).toEqual([]);
  });

  it('게임이 끝나고 기다리는 시간이 지나도 결과가 없으면 결과 미입력이다', () => {
    const checkedIn = applyCheckIn(record(), 'ozobot', 1000).record;
    const waiting = clock({ phase: 'ended', endedElapsedMs: MINUTE });
    expect(getTeamAlerts(checkedIn, waiting)).toEqual([]);
    expect(presentTeamMissionState(checkedIn, waiting).status).toBe('active');

    const late = clock({ phase: 'ended', endedElapsedMs: 2 * MINUTE });
    expect(getTeamAlerts(checkedIn, late)).toEqual(['result_missing']);
    expect(getTeamAlerts(applyResultFinalized(checkedIn, 'r1', 1), late)).toEqual([]);
  });

  it('게임을 시작하기 전에는 입장하지 않아도 미도착이 아니다', () => {
    expect(getTeamAlerts(record(), clock({ phase: 'before' }))).toEqual([]);
  });
});

describe('대시보드 요약', () => {
  it('입장·완료 팀 수와 경고 수를 센다', () => {
    const states = [
      presentTeamMissionState(record(), clock({ activeElapsedMs: 3 * MINUTE })),
      presentTeamMissionState(applyCheckIn(record(), 'ozobot', 1).record, clock()),
      presentTeamMissionState(applyResultFinalized(record(), 'r1', 1), clock()),
    ];
    expect(summarizeTeamStates(states)).toEqual({
      expectedTeams: 3,
      checkedInTeams: 2,
      completedTeams: 1,
      alertCount: 1,
    });
  });

  it('학년 진행 상태는 모든 부스의 단계를 모아 준비, 진행 중, 이동 중, 종료로 표시한다', () => {
    expect(getTourPhase([])).toBe('ready');
    expect(getTourPhase(['ready', 'ready'])).toBe('ready');
    expect(getTourPhase(['completed', 'open', 'ready'])).toBe('active');
    expect(getTourPhase(['completed', 'scoring'])).toBe('active');
    expect(getTourPhase(['completed', 'ready'])).toBe('moving');
    expect(getTourPhase(['completed', 'completed'])).toBe('ended');
  });

  it('부스 기록에 지금 단계와 게임 종료 시각을 붙여 화면에 보낸다', () => {
    const key = { id: 'ozobot_g4_r2', grade: 4 as const, missionId: 'ozobot', roundNo: 2 as const };
    expect(presentMissionRound(key, undefined, null, 0)).toMatchObject({
      ...key,
      status: 'ready',
      openedAt: null,
      endsAt: null,
    });
    const playing = { ...EMPTY_BOOTH, openedAt: 1000, startedAt: 2000 };
    expect(presentMissionRound(key, playing, 'teacher-1', 3000)).toMatchObject({
      status: 'active',
      startedAt: 2000,
      endsAt: 2000 + DEFAULT_GAME_DURATION_MS,
      updatedBy: 'teacher-1',
    });
    expect(presentMissionRound(key, playing, null, 2000 + DEFAULT_GAME_DURATION_MS).status).toBe(
      'scoring',
    );
  });
});
