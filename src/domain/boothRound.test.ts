import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_DURATION_MS, RESULT_GRACE_MS } from '../config';
import {
  canCheckInAtBooth,
  EMPTY_BOOTH,
  getBoothActionBlocker,
  getBoothClock,
  getBoothCurrentRound,
  getBoothStatus,
  getBoothStepIndex,
  getGameClosedAt,
  getLiveRoundStatus,
  getNextBoothChangeAt,
  getTeamCurrentRound,
  scopeEventToTeam,
  toGlobalEvent,
  toRoundStatus,
  type BoothTimes,
} from './boothRound';
import { getGameDurationError } from './gameDuration';
import { getMissionNoForRound } from './rotation';
import type { FestivalEvent, MissionNo, RoundNo } from './types';

const MINUTE = 60_000;
const START = 1_000_000;

function booth(patch: Partial<BoothTimes> = {}): BoothTimes {
  return { ...EMPTY_BOOTH, ...patch };
}

const opened = booth({ openedAt: START });
const playing = booth({ openedAt: START, startedAt: START + MINUTE });
const ranked = booth({ ...playing, resultFinalizedAt: START + 5 * MINUTE });
const closed = booth({ ...ranked, completedAt: START + 6 * MINUTE });
const skipped = booth({ completedAt: START + 2 * MINUTE, skipped: true });

function event(patch: Partial<FestivalEvent> = {}): FestivalEvent {
  return {
    id: 'e1',
    title: '',
    schoolName: '',
    status: 'active',
    activeGrade: 4,
    activeRound: 0,
    roundEndsAt: null,
    roundEndedAt: null,
    boothStatus: null,
    skippedRounds: [],
    gameDurationMs: DEFAULT_GAME_DURATION_MS,
    updatedAt: 0,
    ...patch,
  };
}

/** 3팀이 도는 부스 기록을 라운드 번호로 적는다. */
function pathOf(rounds: Partial<Record<RoundNo, BoothTimes>>) {
  return (missionNo: MissionNo, roundNo: RoundNo) =>
    getMissionNoForRound(3, roundNo) === missionNo ? rounds[roundNo] : undefined;
}

describe('게임 시간', () => {
  it('기본 게임 시간은 10분이다', () => {
    expect(DEFAULT_GAME_DURATION_MS).toBe(10 * MINUTE);
    expect(EMPTY_BOOTH.durationMs).toBe(10 * MINUTE);
  });

  it('게임 시간은 3~30분의 분 단위 숫자만 받는다', () => {
    expect(getGameDurationError(10)).toBeNull();
    expect(getGameDurationError(3)).toBeNull();
    expect(getGameDurationError(30)).toBeNull();
    expect(getGameDurationError(2)).toMatch(/3~30분/);
    expect(getGameDurationError(31)).toMatch(/3~30분/);
    expect(getGameDurationError(7.5)).toMatch(/분 단위/);
    expect(getGameDurationError(Number.NaN)).toMatch(/분 단위/);
  });
});

describe('부스 라운드 단계', () => {
  it('열기 전 → 입장 중 → 게임 중 → 순위 매기는 중 → 라운드 종료로 바뀐다', () => {
    expect(getBoothStatus(undefined, START)).toBe('ready');
    expect(getBoothStatus(booth(), START)).toBe('ready');
    expect(getBoothStatus(opened, START)).toBe('open');
    expect(getBoothStatus(playing, START + 2 * MINUTE)).toBe('active');
    expect(getBoothStatus(ranked, START + 5 * MINUTE)).toBe('scoring');
    expect(getBoothStatus(closed, START + 6 * MINUTE)).toBe('completed');
  });

  it('게임 시간 10분이 지나면 저절로 순위 매기는 단계가 된다', () => {
    const endsAt = START + MINUTE + 10 * MINUTE;
    expect(getBoothStatus(playing, endsAt - 1)).toBe('active');
    expect(getBoothStatus(playing, endsAt)).toBe('scoring');
  });

  it('게임 시간은 게임을 시작할 때 정한 값을 쓴다', () => {
    const short = booth({ ...playing, durationMs: 5 * MINUTE });
    expect(getBoothStatus(short, START + MINUTE + 5 * MINUTE)).toBe('scoring');
  });

  it('게임을 시작하지 않고 순위부터 확정한 부스는 순위 매기는 단계로 본다', () => {
    expect(getBoothStatus(booth({ resultFinalizedAt: START }), START)).toBe('scoring');
  });

  it('화면이 읽은 뒤 시간이 끝나면 화면에서도 순위 매기는 단계로 본다', () => {
    const round = { status: 'active' as const, endsAt: START + 10 * MINUTE };
    expect(getLiveRoundStatus(round, START)).toBe('active');
    expect(getLiveRoundStatus(round, START + 10 * MINUTE)).toBe('scoring');
    expect(getLiveRoundStatus({ status: 'open', endsAt: null }, START)).toBe('open');
  });

  it('학생은 라운드를 연 뒤부터 종료하기 전까지 입장할 수 있다', () => {
    expect(canCheckInAtBooth('ready')).toBe(false);
    expect(canCheckInAtBooth('open')).toBe(true);
    expect(canCheckInAtBooth('active')).toBe(true);
    expect(canCheckInAtBooth('scoring')).toBe(true);
    expect(canCheckInAtBooth('completed')).toBe(false);
  });

  it('학생 화면이 쓰는 라운드 상태로 바꾼다', () => {
    expect(toRoundStatus('ready')).toBe('waiting');
    expect(toRoundStatus('open')).toBe('waiting');
    expect(toRoundStatus('active')).toBe('active');
    expect(toRoundStatus('scoring')).toBe('scoring');
    expect(toRoundStatus('completed')).toBe('closed');
  });

  it('진행 순서에서 지금 할 일을 알려 준다', () => {
    expect(getBoothStepIndex('ready', false)).toBe(0);
    expect(getBoothStepIndex('open', false)).toBe(1);
    expect(getBoothStepIndex('active', false)).toBe(2);
    expect(getBoothStepIndex('scoring', false)).toBe(2);
    expect(getBoothStepIndex('scoring', true)).toBe(3);
    expect(getBoothStepIndex('completed', true)).toBe(4);
  });
});

describe('부스에서 할 수 있는 일', () => {
  const ok = { touring: true, previousCompleted: true, rankingFinalized: false };

  it('앞 라운드를 종료해야 다음 라운드를 열 수 있다', () => {
    expect(getBoothActionBlocker('open', { ...ok, status: 'ready' })).toBeNull();
    expect(
      getBoothActionBlocker('open', { ...ok, status: 'ready', previousCompleted: false }),
    ).toMatch(/앞 라운드를 종료/);
  });

  it('진행 학년이 아니면 시작할 수 없다', () => {
    expect(getBoothActionBlocker('open', { ...ok, status: 'ready', touring: false })).toMatch(
      /진행 학년/,
    );
  });

  it('라운드를 열어야 게임을 시작할 수 있다', () => {
    expect(getBoothActionBlocker('start', { ...ok, status: 'ready' })).toMatch(/먼저 열어/);
    expect(getBoothActionBlocker('start', { ...ok, status: 'open' })).toBeNull();
  });

  it('순위를 확정해야 라운드를 종료할 수 있다', () => {
    expect(getBoothActionBlocker('close', { ...ok, status: 'open' })).toMatch(/게임을 시작한 뒤/);
    expect(getBoothActionBlocker('close', { ...ok, status: 'active' })).toMatch(/순위를 확정/);
    expect(getBoothActionBlocker('close', { ...ok, status: 'scoring' })).toMatch(/순위를 확정/);
    expect(
      getBoothActionBlocker('close', { ...ok, status: 'scoring', rankingFinalized: true }),
    ).toBeNull();
  });

  it('앞 라운드를 끝낸 뒤, 순위를 확정하기 전에는 라운드를 건너뛸 수 있다', () => {
    for (const status of ['ready', 'open', 'active', 'scoring'] as const) {
      expect(getBoothActionBlocker('skip', { ...ok, status })).toBeNull();
    }
    expect(
      getBoothActionBlocker('skip', { ...ok, status: 'ready', previousCompleted: false }),
    ).toMatch(/앞 라운드를 종료하거나 건너뛴 뒤/);
    expect(
      getBoothActionBlocker('skip', { ...ok, status: 'scoring', rankingFinalized: true }),
    ).toMatch(/건너뛰지 말고 종료/);
    expect(getBoothActionBlocker('skip', { ...ok, status: 'ready', touring: false })).toMatch(
      /진행 학년/,
    );
    expect(
      getBoothActionBlocker('skip', { ...ok, status: 'completed', rankingFinalized: false }),
    ).toMatch(/이미 종료/);
  });

  it('종료한 라운드는 다시 진행할 수 없다', () => {
    expect(
      getBoothActionBlocker('start', { ...ok, status: 'completed', rankingFinalized: true }),
    ).toMatch(/이미 종료/);
  });
});

describe('지금 라운드', () => {
  it('부스는 아직 종료하지 않은 첫 라운드를 진행한다', () => {
    expect(getBoothCurrentRound(() => undefined)).toBe(1);
    expect(getBoothCurrentRound((roundNo) => (roundNo === 1 ? closed : undefined))).toBe(2);
    expect(getBoothCurrentRound((roundNo) => (roundNo <= 2 ? closed : playing))).toBe(3);
    expect(getBoothCurrentRound(() => closed)).toBeNull();
  });

  it('건너뛴 라운드는 끝난 라운드로 본다', () => {
    expect(getBoothStatus(skipped, START + 3 * MINUTE)).toBe('completed');
    expect(getBoothCurrentRound((roundNo) => (roundNo <= 2 ? skipped : undefined))).toBe(3);
    expect(getTeamCurrentRound(3, pathOf({ 1: skipped, 2: skipped }))).toBe(3);
  });

  it('순위가 나온 팀은 앞 교실이 종료를 누르지 않았어도 다음 교실이 열리면 넘어간다', () => {
    const rankedAt =
      (...rounds: number[]) =>
      (roundNo: number) =>
        rounds.includes(roundNo);
    // 다음 교실이 아직 라운드를 열지 않았으면 그 라운드에 머문다.
    expect(getTeamCurrentRound(3, pathOf({ 1: ranked }), rankedAt(1))).toBe(1);
    expect(getTeamCurrentRound(3, pathOf({ 1: ranked, 2: booth() }), rankedAt(1))).toBe(1);
    // 다음 교실이 라운드를 열었거나 게임을 시작했으면 넘어간다.
    expect(getTeamCurrentRound(3, pathOf({ 1: ranked, 2: opened }), rankedAt(1))).toBe(2);
    expect(getTeamCurrentRound(3, pathOf({ 1: ranked, 2: playing }), rankedAt(1))).toBe(2);
    // 다음 교실이 건너뛴 라운드면 그다음 라운드까지 본다.
    expect(getTeamCurrentRound(3, pathOf({ 1: ranked, 2: skipped }), rankedAt(1))).toBe(3);
    // 순위가 나오지 않은 팀은 다음 교실이 열려도 넘어가지 않는다.
    expect(getTeamCurrentRound(3, pathOf({ 1: playing, 2: opened }))).toBe(1);
    expect(getTeamCurrentRound(3, pathOf({ 1: playing, 2: opened }), rankedAt(2))).toBe(1);
    // 마지막 라운드는 선생님이 종료해야 끝난다.
    const four = { 1: closed, 2: closed, 3: closed, 4: closed };
    expect(getTeamCurrentRound(3, pathOf({ ...four, 5: ranked }), rankedAt(5))).toBe(5);
    expect(getTeamCurrentRound(3, pathOf({ ...four, 5: closed }), rankedAt(5))).toBeNull();
  });

  it('팀은 자기가 도는 부스가 종료하지 않은 첫 라운드에 있다', () => {
    expect(getTeamCurrentRound(3, pathOf({}))).toBe(1);
    expect(getTeamCurrentRound(3, pathOf({ 1: closed, 2: playing }))).toBe(2);
    expect(
      getTeamCurrentRound(3, pathOf({ 1: closed, 2: closed, 3: closed, 4: closed, 5: closed })),
    ).toBeNull();
  });
});

describe('한 팀이 보는 행사 상태', () => {
  const team = { grade: 4 as const, teamNo: 3 as const };

  it('전체 행사 상태에는 라운드가 없다', () => {
    expect(
      toGlobalEvent(event({ activeRound: 2, roundEndsAt: 5, boothStatus: 'active' })),
    ).toMatchObject({
      status: 'active',
      activeRound: 0,
      roundEndsAt: null,
      boothStatus: null,
    });
    expect(toGlobalEvent(event({ activeGrade: null })).status).toBe('ready');
  });

  it('다른 학년이 진행 중이면 대기 상태다', () => {
    const scoped = scopeEventToTeam(event({ activeGrade: 5 }), team, pathOf({ 1: playing }), START);
    expect(scoped).toMatchObject({ status: 'ready', activeRound: 0, boothStatus: null });
  });

  it('첫 부스가 열리기 전에는 첫 라운드를 기다린다', () => {
    const scoped = scopeEventToTeam(event(), team, pathOf({}), START);
    expect(scoped).toMatchObject({ status: 'ready', activeRound: 0, boothStatus: 'ready' });
  });

  it('부스가 라운드를 열면 입장 중, 게임을 시작하면 그 부스의 종료 시각을 본다', () => {
    const open = scopeEventToTeam(event(), team, pathOf({ 1: opened }), START);
    expect(open).toMatchObject({ status: 'ready', activeRound: 0, boothStatus: 'open' });

    const active = scopeEventToTeam(event(), team, pathOf({ 1: playing }), START + 2 * MINUTE);
    expect(active).toMatchObject({
      status: 'active',
      activeRound: 1,
      boothStatus: 'active',
      roundEndsAt: START + MINUTE + 10 * MINUTE,
    });
  });

  it('순위를 일찍 확정하면 그때 게임이 끝난 것으로 보고 타이머를 멈춘다', () => {
    expect(getGameClosedAt(undefined)).toBeNull();
    expect(getGameClosedAt(opened)).toBeNull();
    expect(getGameClosedAt(playing)).toBe(START + MINUTE + 10 * MINUTE);
    expect(getGameClosedAt(ranked)).toBe(START + 5 * MINUTE);
    // 시간이 끝난 뒤에 확정했으면 게임 시간이 끝난 때다.
    const late = booth({ ...playing, resultFinalizedAt: START + 30 * MINUTE });
    expect(getGameClosedAt(late)).toBe(START + MINUTE + 10 * MINUTE);

    const scoped = scopeEventToTeam(event(), team, pathOf({ 1: ranked }), START + 6 * MINUTE);
    expect(scoped).toMatchObject({
      status: 'active',
      activeRound: 1,
      boothStatus: 'scoring',
      roundEndsAt: START + 5 * MINUTE,
    });
  });

  it('게임 시간이 끝나도 라운드를 종료하기 전까지는 그 라운드에 머문다', () => {
    const scoring = scopeEventToTeam(event(), team, pathOf({ 1: playing }), START + 20 * MINUTE);
    expect(scoring).toMatchObject({ status: 'active', activeRound: 1, boothStatus: 'scoring' });
  });

  it('라운드를 종료하면 다음 부스로 이동한다', () => {
    const moving = scopeEventToTeam(event(), team, pathOf({ 1: closed }), START + 7 * MINUTE);
    expect(moving).toMatchObject({
      status: 'ready',
      activeRound: 1,
      roundEndedAt: closed.completedAt,
      boothStatus: 'ready',
    });
  });

  it('앞 교실이 종료를 누르지 않았어도 다음 교실이 열리면 그 교실로 안내한다', () => {
    const isRanked = (roundNo: number) => roundNo === 1;
    const waiting = scopeEventToTeam(
      event(),
      team,
      pathOf({ 1: ranked }),
      START + 6 * MINUTE,
      isRanked,
    );
    expect(waiting).toMatchObject({ status: 'active', activeRound: 1, boothStatus: 'scoring' });

    const moved = scopeEventToTeam(
      event(),
      team,
      pathOf({ 1: ranked, 2: opened }),
      START + 6 * MINUTE,
      isRanked,
    );
    expect(moved).toMatchObject({ status: 'ready', activeRound: 1, boothStatus: 'open' });

    const playingNext = scopeEventToTeam(
      event(),
      team,
      pathOf({ 1: ranked, 2: playing }),
      START + 6 * MINUTE,
      isRanked,
    );
    expect(playingNext).toMatchObject({ status: 'active', activeRound: 2, boothStatus: 'active' });
  });

  it('팀이 도는 라운드 가운데 건너뛴 라운드를 알려 준다', () => {
    const scoped = scopeEventToTeam(
      event(),
      team,
      pathOf({ 1: skipped, 2: closed, 3: skipped, 4: opened }),
      START + 10 * MINUTE,
    );
    expect(scoped.skippedRounds).toEqual([1, 3]);
    expect(scoped).toMatchObject({ activeRound: 3, boothStatus: 'open' });
    expect(toGlobalEvent(scoped).skippedRounds).toEqual([]);
    // 다른 학년이 진행 중이면 알려 주지 않는다.
    expect(
      scopeEventToTeam(event({ activeGrade: 5 }), team, pathOf({ 1: skipped }), START)
        .skippedRounds,
    ).toEqual([]);
  });

  it('다른 팀이 도는 부스는 이 팀의 상태를 바꾸지 않는다', () => {
    // 3팀의 1라운드 부스는 미션 3이다. 미션 1 부스만 게임 중이면 3팀은 아직 기다린다.
    const others = (missionNo: MissionNo, roundNo: RoundNo) =>
      missionNo === 1 && roundNo === 1 ? playing : undefined;
    expect(scopeEventToTeam(event(), team, others, START + 2 * MINUTE).status).toBe('ready');
  });

  it('다섯 라운드를 모두 끝내면 투어가 끝난다', () => {
    const all = pathOf({ 1: closed, 2: closed, 3: closed, 4: closed, 5: closed });
    expect(scopeEventToTeam(event(), team, all, START + 60 * MINUTE)).toMatchObject({
      status: 'ready',
      activeRound: 5,
      boothStatus: null,
    });
  });
});

describe('시간으로 바뀌는 순간', () => {
  it('게임 중인 부스의 종료 시각 가운데 가장 이른 때를 알려 준다', () => {
    const later = booth({ openedAt: START, startedAt: START + 3 * MINUTE });
    expect(getNextBoothChangeAt([playing, later, opened], START + 2 * MINUTE)).toBe(
      START + MINUTE + 10 * MINUTE,
    );
  });

  it('이미 끝났거나 순위를 확정한 부스는 세지 않는다', () => {
    expect(getNextBoothChangeAt([playing], START + 30 * MINUTE)).toBeNull();
    expect(getNextBoothChangeAt([ranked, closed, opened], START + 2 * MINUTE)).toBeNull();
  });
});

describe('경고 계산에 쓰는 시계', () => {
  it('게임을 시작하기 전에는 시간을 세지 않는다', () => {
    expect(getBoothClock(undefined, START)).toMatchObject({ phase: 'before', closed: false });
    expect(getBoothClock(opened, START + 30 * MINUTE)).toMatchObject({
      phase: 'before',
      activeElapsedMs: 0,
    });
  });

  it('게임 중에는 게임을 시작한 뒤 흐른 시간을 센다', () => {
    expect(getBoothClock(playing, START + 4 * MINUTE)).toMatchObject({
      phase: 'active',
      activeElapsedMs: 3 * MINUTE,
      closed: false,
    });
  });

  it('건너뛴 라운드는 게임을 하지 않았으므로 시간을 세지 않는다', () => {
    expect(getBoothClock(skipped, START + 60 * MINUTE)).toMatchObject({
      phase: 'before',
      closed: true,
      activeElapsedMs: 0,
      endedElapsedMs: 0,
    });
    // 게임을 시작한 뒤에 건너뛰어도 결과 미입력으로 세지 않는다.
    const abandoned = booth({ ...playing, completedAt: START + 3 * MINUTE, skipped: true });
    expect(getBoothClock(abandoned, START + 60 * MINUTE).phase).toBe('before');
  });

  it('게임이 끝나면 끝난 뒤 흐른 시간을 세고, 라운드를 종료하면 이동으로 본다', () => {
    const endsAt = START + MINUTE + 10 * MINUTE;
    expect(getBoothClock(playing, endsAt + 2 * MINUTE)).toMatchObject({
      phase: 'ended',
      endedElapsedMs: 2 * MINUTE,
      resultGraceMs: RESULT_GRACE_MS,
      closed: false,
    });
    expect(getBoothClock(closed, START + 8 * MINUTE)).toMatchObject({
      phase: 'ended',
      closed: true,
    });
  });
});
