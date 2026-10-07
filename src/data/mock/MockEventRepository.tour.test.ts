import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_ID } from '../../config';
import { isRepositoryError } from '../errors';
import { toTeamId } from './keys';
import { MockEventRepository } from './MockEventRepository';
import { DEMO_TEAM_ID, SAMPLE_STATION_CODES } from './seed';

const EVENT = DEFAULT_EVENT_ID;
const START = 5_000_000;
const MINUTE = 60_000;
/** 샘플 교실의 인증코드로 입장 입력을 만든다. */
const enter = (
  teamId: string,
  stationId: string,
  accessCode = SAMPLE_STATION_CODES[stationId],
) => ({
  eventId: EVENT,
  teamId,
  stationId,
  accessCode,
});

describe('MockEventRepository 팀 이동과 운영 대시보드', () => {
  let clock: number;
  let repository: MockEventRepository;

  beforeEach(() => {
    clock = START;
    repository = new MockEventRepository({ now: () => clock, random: () => 0 });
  });

  /** 한 부스 라운드의 순위를 확정한다. */
  async function finalize(missionId: string, roundNo: 1 | 2 | 3 | 4 | 5) {
    const participants = await repository.listMissionParticipants(EVENT, missionId, 4, roundNo);
    return repository.finalizeRanking({
      eventId: EVENT,
      missionId,
      grade: 4,
      roundNo,
      requestId: `fin-${missionId}-${roundNo}`,
      entries: participants.map((row, index) => ({
        teamId: row.team.id,
        score: 500 - index * 100,
        rank: index + 1,
      })),
    });
  }

  it('인증코드가 맞으면 입장하고, 다시 넣어도 기록은 하나이며, 다른 교실이나 틀린 코드는 거부한다', async () => {
    // 샘플 팀(4학년 2반 3팀)의 2라운드 교실은 과학실(로봇 길찾기)이다. 시청각실은 4라운드에 간다.
    await expect(repository.checkInStation(enter(DEMO_TEAM_ID, 'golden-bell'))).rejects.toSatisfy(
      (error) =>
        isRepositoryError(error, 'not-allowed') && /아직 차례가 아닌 미션/.test(error.message),
    );
    // 틀린 코드는 기록하지 않는다.
    await expect(
      repository.checkInStation(enter(DEMO_TEAM_ID, 'ozobot', '0000')),
    ).rejects.toSatisfy(
      (error) =>
        isRepositoryError(error, 'invalid-input') && /인증코드가 달라요/.test(error.message),
    );
    expect((await repository.getTeamTourStatus(EVENT, DEMO_TEAM_ID)).state?.checkedInAt).toBeNull();

    // 띄어쓰기나 전각 숫자가 섞여도 숫자만 견준다.
    const first = await repository.checkInStation(
      enter(DEMO_TEAM_ID, 'ozobot', ` ${SAMPLE_STATION_CODES.ozobot.split('').join(' ')} `),
    );
    expect(first).toMatchObject({ kind: 'checked_in', roundNo: 2, mission: { id: 'ozobot' } });
    // 과학실은 이미 게임 중이라 늦게 들어온 팀은 바로 진행 중이 된다.
    expect(first.state).toMatchObject({ status: 'active', checkedInAt: START, alertCodes: [] });

    clock += 30_000;
    const again = await repository.checkInStation(enter(DEMO_TEAM_ID, 'ozobot'));
    expect(again.kind).toBe('already_checked_in');
    expect(again.state.checkedInAt).toBe(START);
    // 이미 입장한 팀은 코드가 달라도 그대로 입장한 것으로 본다.
    expect((await repository.checkInStation(enter(DEMO_TEAM_ID, 'ozobot', '0000'))).kind).toBe(
      'already_checked_in',
    );

    // 입장 기록은 활동에 한 번만 남는다.
    await repository.signInTeacher();
    const dashboard = await repository.getOpsDashboard(EVENT, 4);
    expect(
      dashboard.activity.filter(
        (event) => event.type === 'check_in' && event.teamId === DEMO_TEAM_ID,
      ),
    ).toHaveLength(1);
  });

  it('투어 중이 아닌 학년의 팀은 체크인할 수 없다', async () => {
    await expect(repository.checkInStation(enter(toTeamId(5, 1, 1), 'ozobot'))).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'not-allowed'),
    );
  });

  it('교실 인증코드는 교사가 읽고 총괄이 정하며, 겹치거나 네 자리가 아니면 저장하지 않는다', async () => {
    await expect(repository.listStationCodes(EVENT)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
    repository.signInAs('teacher');
    const codes = await repository.listStationCodes(EVENT);
    expect(codes.map((item) => item.missionId)).toEqual([
      'golden-bell',
      'error-hunt',
      'drawing',
      'ozobot',
      'library-check',
    ]);
    expect(codes.find((item) => item.missionId === 'ozobot')?.code).toBe(
      SAMPLE_STATION_CODES.ozobot,
    );
    const next: Record<string, string> = { ...SAMPLE_STATION_CODES, ozobot: '9081' };
    await expect(repository.saveStationCodes(EVENT, next)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );

    repository.signInAs('admin');
    await expect(
      repository.saveStationCodes(EVENT, { ...next, drawing: next['golden-bell'] }),
    ).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'invalid-input') && /같아요/.test(error.message),
    );
    await expect(repository.saveStationCodes(EVENT, { ...next, drawing: '12' })).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'invalid-input') && /3반 교실/.test(error.message),
    );
    const saved = await repository.saveStationCodes(EVENT, next);
    expect(saved.find((item) => item.missionId === 'ozobot')?.code).toBe('9081');

    // 바뀐 코드로만 들어갈 수 있다.
    repository.signInAs('teacher');
    await repository.signOutTeacher();
    await expect(
      repository.checkInStation(enter(DEMO_TEAM_ID, 'ozobot', SAMPLE_STATION_CODES.ozobot)),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'invalid-input'));
    expect((await repository.checkInStation(enter(DEMO_TEAM_ID, 'ozobot', '9081'))).kind).toBe(
      'checked_in',
    );
  });

  it('선생님이 라운드를 열기 전에는 입장할 수 없다', async () => {
    await repository.signInTeacher();
    await finalize('ozobot', 2);
    await repository.closeStationRound({
      eventId: EVENT,
      missionId: 'ozobot',
      grade: 4,
      roundNo: 2,
    });
    // 3팀의 3라운드 교실은 도서관(AI 오류찾기)인데, 도서관은 아직 2라운드를 하고 있다.
    expect((await repository.getTeamTourStatus(EVENT, DEMO_TEAM_ID)).roundNo).toBe(3);
    await expect(repository.checkInStation(enter(DEMO_TEAM_ID, 'library-check'))).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'not-allowed') && /라운드를 열면/.test(error.message),
    );
  });

  it('순위가 나온 뒤 라운드를 종료하기 전에는 다른 교실에 들어갈 수 없고 기록도 남기지 않는다', async () => {
    await repository.signInTeacher();
    await finalize('ozobot', 2);

    // 3팀의 다음(3라운드) 교실은 도서관이지만 아직 2라운드 교실에 있다.
    await expect(repository.checkInStation(enter(DEMO_TEAM_ID, 'library-check'))).rejects.toSatisfy(
      (error) =>
        isRepositoryError(error, 'not-allowed') && /아직 차례가 아닌 미션/.test(error.message),
    );

    // 순위가 나온 교실에 다시 들어오는 것은 이미 입장한 것이다.
    const same = await repository.checkInStation(enter(DEMO_TEAM_ID, 'ozobot'));
    expect(same.kind).toBe('already_checked_in');

    const dashboard = await repository.getOpsDashboard(EVENT, 4);
    expect(
      dashboard.alerts.filter(
        (alert) => alert.team.id === DEMO_TEAM_ID && alert.code === 'wrong_station',
      ),
    ).toEqual([]);
  });

  it('앞 교실이 종료를 누르지 않았어도 순위가 나온 팀은 다음 교실이 열리면 입장한다', async () => {
    await repository.signInTeacher();
    // 과학실(3팀의 2라운드)은 순위만 확정하고 라운드를 종료하지 않았다.
    await finalize('ozobot', 2);
    // 도서관(3팀의 3라운드)은 2라운드를 끝내고 3라운드를 열었다.
    const library = { eventId: EVENT, missionId: 'library-check', grade: 4 as const };
    await repository.startStationRound({ ...library, roundNo: 2 });
    await finalize('library-check', 2);
    await repository.closeStationRound({ ...library, roundNo: 2 });
    await repository.openStationRound({ ...library, roundNo: 3 });
    expect((await repository.getMissionRoundState(EVENT, 'ozobot', 4, 2)).completedAt).toBeNull();

    expect(await repository.getTeamTourStatus(EVENT, DEMO_TEAM_ID)).toMatchObject({
      roundNo: 3,
      expectedMission: { id: 'library-check' },
    });
    const entered = await repository.checkInStation(enter(DEMO_TEAM_ID, 'library-check'));
    expect(entered).toMatchObject({ kind: 'checked_in', roundNo: 3 });

    // 게임을 시작하면 제출할 수 있다.
    await repository.startStationRound({ ...library, roundNo: 3 });
    const saved = await repository.saveSubmission({
      eventId: EVENT,
      missionId: 'library-check',
      teamId: DEMO_TEAM_ID,
      answer: {
        type: 'library_check',
        answers: { q1: { wrongPart: '틀린 부분', correction: '고친 내용' } },
      },
      requestId: 'moved-on',
    });
    expect(saved).toMatchObject({ status: 'submitted', roundNo: 3 });

    // 순위가 나오지 않은 팀은 다음 교실이 열려도 넘어가지 않는다(시청각실 2라운드는 게임 중).
    await repository
      .openStationRound({
        eventId: EVENT,
        missionId: 'error-hunt',
        grade: 4,
        roundNo: 2,
      })
      .catch(() => undefined);
    expect((await repository.getTeamTourStatus(EVENT, toTeamId(4, 1, 5))).roundNo).toBe(2);

    // 대시보드에서도 3팀은 3라운드(도서관)에 있다.
    const dashboard = await repository.getOpsDashboard(EVENT, 4);
    const demo = dashboard.classRows
      .flatMap((row) => row.cells)
      .find((cell) => cell.team.id === DEMO_TEAM_ID);
    expect(demo).toMatchObject({ mission: { id: 'library-check' }, state: { roundNo: 3 } });
  });

  it('이미 지나간 라운드의 교실에는 다시 들어갈 수 없고 기록도 남기지 않는다', async () => {
    // 3팀의 1라운드 교실은 미술실이었고 지금은 2라운드다.
    await expect(repository.checkInStation(enter(DEMO_TEAM_ID, 'drawing'))).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'not-allowed') && /이미 지나간 미션/.test(error.message),
    );
    const status = await repository.getTeamTourStatus(EVENT, DEMO_TEAM_ID);
    expect(status.state?.alertCodes).not.toContain('wrong_station');
  });

  it('라운드를 건너뛰면 게임과 순위 없이 끝나고 팀은 다음 교실로 넘어간다', async () => {
    await repository.signInTeacher();
    const library = { eventId: EVENT, missionId: 'library-check', grade: 4 as const };
    const blocked = (pattern: RegExp) => (error: unknown) =>
      isRepositoryError(error, 'not-allowed') && pattern.test(error.message);

    // 앞 라운드(2라운드)를 끝내기 전에는 3라운드를 건너뛸 수 없다.
    await expect(repository.skipStationRound({ ...library, roundNo: 3 })).rejects.toSatisfy(
      blocked(/앞 라운드를 종료하거나 건너뛴 뒤/),
    );
    clock += MINUTE;
    const skipped = await repository.skipStationRound({ ...library, roundNo: 2 });
    expect(skipped).toMatchObject({
      status: 'completed',
      skipped: true,
      startedAt: null,
      resultFinalizedAt: null,
      completedAt: START + MINUTE,
    });
    // 다시 눌러도 처음 기록 그대로다.
    clock += MINUTE;
    expect((await repository.skipStationRound({ ...library, roundNo: 2 })).completedAt).toBe(
      START + MINUTE,
    );

    // 건너뛴 뒤에는 다음 라운드를 열거나 또 건너뛸 수 있다.
    await repository.skipStationRound({ ...library, roundNo: 3 });
    await expect(repository.openStationRound({ ...library, roundNo: 4 })).resolves.toMatchObject({
      status: 'open',
    });
    const rounds = await repository.getStationRounds(EVENT, 'library-check', 4);
    expect(rounds.map((round) => `${round.status}${round.skipped ? ':skipped' : ''}`)).toEqual([
      'completed',
      'completed:skipped',
      'completed:skipped',
      'open',
      'ready',
    ]);

    // 도서관에 2라운드에 오던 4팀은 미션을 하지 않고 3라운드(시청각실)로 넘어간다.
    const teamId = toTeamId(4, 1, 4);
    expect(await repository.getTeamTourStatus(EVENT, teamId)).toMatchObject({
      roundNo: 3,
      expectedMission: { id: 'golden-bell' },
    });
    const view = await repository.getTeamMissionView(EVENT, teamId, 'library-check');
    expect(view).toMatchObject({ roundStatus: 'closed', booth: { skipped: true } });
    await expect(
      repository.saveSubmission({
        eventId: EVENT,
        missionId: 'library-check',
        teamId,
        answer: {
          type: 'library_check',
          answers: { q1: { wrongPart: '틀린 부분', correction: '고친 내용' } },
        },
        requestId: 'skipped-round',
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));

    // 건너뛴 라운드의 팀은 결과 미입력으로 세지 않는다.
    clock += 30 * MINUTE;
    const dashboard = await repository.getOpsDashboard(EVENT, 4, 2);
    const station = dashboard.stations.find((item) => item.mission.id === 'library-check');
    expect(station?.round.skipped).toBe(true);
    expect(station?.teams.flatMap((cell) => cell.state.alertCodes)).not.toContain('result_missing');
    expect(
      dashboard.activity.some((item) =>
        /AI 오류찾기\(도서관\) 2라운드 · 라운드 건너뛰기/.test(item.message),
      ),
    ).toBe(true);
  });

  it('순위를 확정한 라운드는 건너뛸 수 없고, 게임 중인 라운드는 건너뛸 수 있다', async () => {
    await repository.signInTeacher();
    const bell = {
      eventId: EVENT,
      missionId: 'golden-bell',
      grade: 4 as const,
      roundNo: 2 as const,
    };
    await finalize('golden-bell', 2);
    await expect(repository.skipStationRound(bell)).rejects.toSatisfy(
      (error) =>
        isRepositoryError(error, 'not-allowed') && /건너뛰지 말고 종료/.test(error.message),
    );
    // 미술실은 게임 중이다.
    const drawing = await repository.skipStationRound({ ...bell, missionId: 'drawing' });
    expect(drawing).toMatchObject({ status: 'completed', skipped: true });
    expect(drawing.startedAt).not.toBeNull();
  });

  it('팀이 보는 행사 상태는 건너뛴 라운드를 알려 준다', async () => {
    await repository.signInTeacher();
    await repository.skipStationRound({
      eventId: EVENT,
      missionId: 'library-check',
      grade: 4,
      roundNo: 2,
    });
    const seen: string[] = [];
    const stop = repository.subscribeTeamEvent(
      EVENT,
      toTeamId(4, 1, 4),
      (event) =>
        seen.push(`${event.activeRound}:${event.boothStatus}:${event.skippedRounds.join(',')}`),
      () => undefined,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();
    expect(seen).toEqual(['2:ready:2']);
  });

  it('미션 화면용 정보는 팀이 그 교실에 입장했는지 알려 준다', async () => {
    const waiting = await repository.getTeamMissionView(EVENT, DEMO_TEAM_ID, 'ozobot');
    expect(waiting.checkedIn).toBe(false);
    await repository.checkInStation(enter(DEMO_TEAM_ID, 'ozobot'));
    const entered = await repository.getTeamMissionView(EVENT, DEMO_TEAM_ID, 'ozobot');
    expect(entered.checkedIn).toBe(true);
    // 아직 차례가 아닌 미션은 입장 전이다.
    const later = await repository.getTeamMissionView(EVENT, DEMO_TEAM_ID, 'golden-bell');
    expect(later.checkedIn).toBe(false);
  });

  it('대시보드는 현재 학년·라운드의 팀 위치, 요약, 경고를 보여 준다', async () => {
    await repository.signInTeacher();
    const dashboard = await repository.getOpsDashboard(EVENT, 4);
    expect(dashboard.summary).toMatchObject({
      grade: 4,
      roundNo: 2,
      phase: 'active',
      expectedTeams: 25,
      checkedInTeams: 22,
      completedTeams: 0,
    });
    expect(dashboard.stations).toHaveLength(5);
    expect(dashboard.classRows).toHaveLength(5);
    expect(dashboard.classRows[0].cells.map((cell) => cell.team.teamNo)).toEqual([1, 2, 3, 4, 5]);

    // 게임 중인 부스의 미도착 2팀(2반 3팀, 4반 5팀).
    // 5반 4팀이 갈 도서관은 아직 게임을 시작하지 않아 미도착으로 세지 않는다.
    const codes = dashboard.alerts.map((alert) => `${alert.team.id}:${alert.code}`).sort();
    expect(codes).toEqual([`${toTeamId(4, 2, 3)}:not_arrived`, `${toTeamId(4, 4, 5)}:not_arrived`]);
    expect(dashboard.summary.alertCount).toBe(2);

    // 게임을 시작한 부스의 입장 팀은 진행 중이다.
    const goldenBell = dashboard.stations.find((station) => station.mission.id === 'golden-bell');
    expect(goldenBell?.round).toMatchObject({ roundNo: 2, status: 'active' });
    expect(goldenBell?.round.endsAt).toBe((goldenBell?.round.startedAt ?? 0) + 10 * MINUTE);
    expect(goldenBell?.teams.filter((cell) => cell.state.status === 'active')).toHaveLength(4);
    // 라운드만 연 부스의 입장 팀은 입장 완료다.
    const library = dashboard.stations.find((station) => station.mission.id === 'library-check');
    expect(library?.round).toMatchObject({ roundNo: 2, status: 'open', startedAt: null });
    expect(library?.teams.filter((cell) => cell.state.status === 'checked_in')).toHaveLength(4);
  });

  it('부스마다 라운드를 따로 진행해 대시보드에 부스와 팀이 저마다의 라운드로 보인다', async () => {
    await repository.signInTeacher();
    const ozobot = { eventId: EVENT, missionId: 'ozobot', grade: 4 as const, roundNo: 2 as const };
    await finalize('ozobot', 2);
    await repository.closeStationRound(ozobot);
    await repository.openStationRound({ ...ozobot, roundNo: 3 });

    const dashboard = await repository.getOpsDashboard(EVENT, 4);
    const rounds = Object.fromEntries(
      dashboard.stations.map((station) => [station.mission.id, station.round.roundNo]),
    );
    expect(rounds).toMatchObject({ ozobot: 3, 'golden-bell': 2, 'library-check': 2 });
    expect(dashboard.summary).toMatchObject({ roundNo: 2, phase: 'active' });
    // 과학실에서 2라운드를 끝낸 3팀은 3라운드(도서관)로 이동한다.
    const demo = dashboard.classRows
      .flatMap((row) => row.cells)
      .find((cell) => cell.team.id === DEMO_TEAM_ID);
    expect(demo).toMatchObject({ mission: { id: 'library-check' }, state: { roundNo: 3 } });
  });

  it('게임을 시작하면 입장한 팀만 진행 중이 되고, 다시 눌러도 시작 시각은 그대로다', async () => {
    await repository.signInTeacher();
    // 도서관은 2라운드를 열어 두고 아직 게임을 시작하지 않았다.
    const input = {
      eventId: EVENT,
      missionId: 'library-check',
      grade: 4 as const,
      roundNo: 2 as const,
    };
    const started = await repository.startStationRound(input);
    expect(started).toMatchObject({
      status: 'active',
      startedAt: START,
      endsAt: START + 10 * MINUTE,
    });
    clock += MINUTE;
    expect((await repository.startStationRound(input)).startedAt).toBe(START);

    const participants = await repository.listMissionParticipants(EVENT, 'library-check', 4, 2);
    const byTeam = Object.fromEntries(
      participants.map((row) => [row.team.id, row.movement.status]),
    );
    expect(byTeam[toTeamId(4, 1, 4)]).toBe('active');
    // 아직 오지 않은 팀은 입장 전이다(2분이 지나면 미도착 경고가 뜬다).
    expect(byTeam[toTeamId(4, 5, 4)]).toBe('scheduled');

    // 늦게 입장한 팀은 바로 진행 중이 된다.
    const late = await repository.checkInStation(enter(toTeamId(4, 5, 4), 'library-check'));
    expect(late.state.status).toBe('active');
  });

  it('게임 시간은 총괄이 정한 값으로 게임을 시작할 때 정해진다', async () => {
    repository.signInAs('admin');
    await repository.setGameDuration(EVENT, 8);
    const started = await repository.startStationRound({
      eventId: EVENT,
      missionId: 'library-check',
      grade: 4,
      roundNo: 2,
    });
    expect(started.endsAt).toBe(START + 8 * MINUTE);
    // 이미 시작한 게임은 바뀌지 않는다.
    const running = await repository.getMissionRoundState(EVENT, 'golden-bell', 4, 2);
    expect(running.endsAt).toBe((running.startedAt ?? 0) + 10 * MINUTE);
    await expect(repository.setGameDuration(EVENT, 1)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'invalid-input'),
    );
  });

  it('라운드는 열기 → 게임 시작 → 순위 확정 → 종료 순서로만 진행한다', async () => {
    await repository.signInTeacher();
    const round2 = {
      eventId: EVENT,
      missionId: 'library-check',
      grade: 4 as const,
      roundNo: 2 as const,
    };
    const round3 = { ...round2, roundNo: 3 as const };
    const blocked = (pattern: RegExp) => (error: unknown) =>
      isRepositoryError(error, 'not-allowed') && pattern.test(error.message);

    // 2라운드를 종료하기 전에는 3라운드를 열 수 없다.
    await expect(repository.openStationRound(round3)).rejects.toSatisfy(
      blocked(/앞 라운드를 종료/),
    );
    // 게임을 시작하기 전, 순위를 확정하기 전에는 종료할 수 없다.
    await expect(repository.closeStationRound(round2)).rejects.toSatisfy(
      blocked(/게임을 시작한 뒤/),
    );
    await repository.startStationRound(round2);
    await expect(repository.closeStationRound(round2)).rejects.toSatisfy(blocked(/순위를 확정/));

    await finalize('library-check', 2);
    clock += MINUTE;
    const closed = await repository.closeStationRound(round2);
    expect(closed).toMatchObject({ status: 'completed', completedAt: START + MINUTE });
    // 다시 눌러도 처음 종료한 시각 그대로다.
    clock += MINUTE;
    expect((await repository.closeStationRound(round2)).completedAt).toBe(START + MINUTE);

    // 열지 않은 라운드는 게임을 시작할 수 없다.
    await expect(repository.startStationRound(round3)).rejects.toSatisfy(blocked(/먼저 열어/));
    expect(await repository.openStationRound(round3)).toMatchObject({
      status: 'open',
      openedAt: START + 2 * MINUTE,
    });
    const rounds = await repository.getStationRounds(EVENT, 'library-check', 4);
    expect(rounds.map((round) => round.status)).toEqual([
      'completed',
      'completed',
      'open',
      'ready',
      'ready',
    ]);
  });

  it('진행 학년이 아닌 학년의 부스는 열 수 없다', async () => {
    await repository.signInTeacher();
    await expect(
      repository.openStationRound({ eventId: EVENT, missionId: 'ozobot', grade: 5, roundNo: 1 }),
    ).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'not-allowed') && /진행 학년/.test(error.message),
    );
  });

  it('부스 입장 현황은 부스 상태와 이번 라운드에 올 팀의 상태만 돌려준다', async () => {
    await repository.signInTeacher();
    const lateTeamId = toTeamId(4, 5, 4);
    const before = await repository.getStationArrivals(EVENT, 'library-check', 4, 2);
    expect(before.booth).toMatchObject({ missionId: 'library-check', roundNo: 2, status: 'open' });
    // 2라운드에 도서관으로 오는 팀은 학급마다 4팀이다.
    expect(before.movements.map((movement) => movement.teamNo)).toEqual([4, 4, 4, 4, 4]);
    expect(before.movements.find((item) => item.teamId === lateTeamId)?.checkedInAt).toBeNull();

    await repository.checkInStation(enter(lateTeamId, 'library-check'));
    const after = await repository.getStationArrivals(EVENT, 'library-check', 4, 2);
    expect(after.movements.find((item) => item.teamId === lateTeamId)?.status).toBe('checked_in');
  });

  it('인증코드를 넣지 못한 팀은 교사가 직접 입장 처리할 수 있다', async () => {
    await repository.signInTeacher();
    const state = await repository.markTeamArrived({
      eventId: EVENT,
      teamId: toTeamId(4, 4, 5),
      missionId: 'golden-bell',
      roundNo: 2,
    });
    expect(state.checkedInAt).toBe(START);
    expect(state.alertCodes).toEqual([]);
    await expect(
      repository.markTeamArrived({
        eventId: EVENT,
        teamId: toTeamId(4, 4, 5),
        missionId: 'drawing',
        roundNo: 2,
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'invalid-input'));
  });

  it('결과를 확정하면 팀은 완료, 라운드를 종료하면 이동이 되고 다시 확정해도 카드 보상이 늘지 않는다', async () => {
    await repository.signInTeacher();
    const first = await finalize('golden-bell', 2);
    const retry = await finalize('golden-bell', 2);
    expect(retry.alreadyFinalized).toBe(true);
    expect(retry.awards.map((award) => award.id)).toEqual(first.awards.map((award) => award.id));

    const after = await repository.listMissionParticipants(EVENT, 'golden-bell', 4, 2);
    expect(after.every((row) => row.movement.status === 'completed')).toBe(true);
    // 순위를 확정해도 라운드는 선생님이 종료할 때까지 끝나지 않는다.
    const round = await repository.getMissionRoundState(EVENT, 'golden-bell', 4, 2);
    expect(round).toMatchObject({
      status: 'scoring',
      resultFinalizedAt: START,
      completedAt: null,
    });
    // 순위를 확정한 뒤에는 시간이 남아 있어도 제출을 받지 않는다.
    await expect(
      repository.saveSubmission({
        eventId: EVENT,
        missionId: 'golden-bell',
        teamId: toTeamId(4, 2, 5),
        answer: { type: 'golden_bell', selections: { q1: 1 } },
        requestId: 'after-ranking',
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));

    const dashboard = await repository.getOpsDashboard(EVENT, 4);
    expect(dashboard.summary.completedTeams).toBe(5);
    const types = dashboard.activity.map((event) => event.type);
    expect(types.filter((type) => type === 'result_finalized')).toHaveLength(1);
    // 무작위 배정된 3위 팀의 카드 획득만 기록된다(4·5위는 보상 없음).
    expect(types.filter((type) => type === 'card_earned')).toHaveLength(1);

    await repository.closeStationRound({
      eventId: EVENT,
      missionId: 'golden-bell',
      grade: 4,
      roundNo: 2,
    });
    const moved = await repository.listMissionParticipants(EVENT, 'golden-bell', 4, 2);
    expect(moved.every((row) => row.movement.status === 'moving')).toBe(true);
  });

  it('게임 시간이 끝나고 3분이 지나도 결과가 없으면 결과 미입력 경고가 뜬다', async () => {
    await repository.signInTeacher();
    // 샘플의 2라운드 게임은 2분 30초 전에 시작했다. 10분 게임은 7분 30초 뒤에 끝난다.
    clock += 8 * MINUTE;
    let dashboard = await repository.getOpsDashboard(EVENT, 4);
    const goldenBell = dashboard.stations.find((station) => station.mission.id === 'golden-bell');
    expect(goldenBell?.round.status).toBe('scoring');
    expect(dashboard.summary.phase).toBe('active');
    expect(dashboard.alerts.filter((alert) => alert.code === 'result_missing')).toHaveLength(0);

    clock += 3 * MINUTE;
    dashboard = await repository.getOpsDashboard(EVENT, 4);
    // 게임을 한 네 부스의 팀이다. 게임을 시작하지 않은 도서관은 세지 않는다.
    expect(dashboard.alerts.filter((alert) => alert.code === 'result_missing')).toHaveLength(20);
  });

  it('라운드를 종료한 뒤 넣은 인증코드는 다음 라운드 입장으로 기록된다', async () => {
    await repository.signInTeacher();
    await finalize('ozobot', 2);
    await repository.closeStationRound({
      eventId: EVENT,
      missionId: 'ozobot',
      grade: 4,
      roundNo: 2,
    });
    // 3팀의 3라운드 교실은 도서관(AI 오류찾기). 도서관이 2라운드를 끝내고 3라운드를 열어야 한다.
    const library = { eventId: EVENT, missionId: 'library-check', grade: 4 as const };
    await repository.startStationRound({ ...library, roundNo: 2 });
    await finalize('library-check', 2);
    await repository.closeStationRound({ ...library, roundNo: 2 });
    await repository.openStationRound({ ...library, roundNo: 3 });

    const outcome = await repository.checkInStation(enter(DEMO_TEAM_ID, 'library-check'));
    expect(outcome).toMatchObject({ kind: 'checked_in', roundNo: 3 });
    expect(outcome.state.status).toBe('checked_in');
  });

  it('팀이 보는 행사 상태는 자기 부스의 단계를 따라 바뀐다', async () => {
    await repository.signInTeacher();
    const seen: string[] = [];
    // 4반 4팀의 2라운드 교실은 도서관이다(입장 중).
    const stop = repository.subscribeTeamEvent(
      EVENT,
      toTeamId(4, 4, 4),
      (event) => seen.push(`${event.status}:${event.activeRound}:${event.boothStatus}`),
      () => undefined,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const library = {
      eventId: EVENT,
      missionId: 'library-check',
      grade: 4 as const,
      roundNo: 2 as const,
    };
    await repository.startStationRound(library);
    await finalize('library-check', 2);
    await repository.closeStationRound(library);
    stop();
    expect(seen).toEqual(['ready:1:open', 'active:2:active', 'active:2:scoring', 'ready:2:ready']);

    const view = await repository.getTeamMissionView(EVENT, toTeamId(4, 4, 4), 'library-check');
    expect(view).toMatchObject({
      roundNo: 2,
      roundStatus: 'closed',
      booth: { status: 'completed' },
    });
  });

  it('체크인이 바뀌면 대시보드 구독에 알린다', async () => {
    const revisions: number[] = [];
    const stop = repository.subscribeOps(
      EVENT,
      4,
      (revision) => revisions.push(revision),
      () => undefined,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await repository.checkInStation(enter(DEMO_TEAM_ID, 'ozobot'));
    // 같은 코드를 다시 넣은 것은 상태 변화가 아니라 알리지 않는다.
    await repository.checkInStation(enter(DEMO_TEAM_ID, 'ozobot'));
    stop();
    expect(revisions).toHaveLength(2);
  });

  it('학급 상세에 팀별 위치, 순위, 획득 카드, 예상 힌트 수가 나온다', async () => {
    await repository.signInTeacher();
    const detail = await repository.getClassOpsDetail(EVENT, 'g3-c2');
    expect(detail.teams).toHaveLength(5);
    expect(detail.teams[0].completedCount).toBe(5);
    expect(detail.teams[0].results.every((result) => result.rank !== null)).toBe(true);
    // 1팀은 다섯 미션 가운데 한 번 4위라 카드를 4장 받았다.
    expect(detail.teams[0].earnedTypes).toHaveLength(4);
    // 3학년 2반은 표현 카드만 0/4라 완성 4종, 힌트 4개
    expect(detail.progress.completedCount).toBe(4);
    expect(detail.hintPreview).toBe(4);
  });
});

describe('MockEventRepository 역할별 권한', () => {
  let repository: MockEventRepository;

  beforeEach(() => {
    repository = new MockEventRepository({ now: () => START, random: () => 0 });
  });

  it('교사는 모든 부스를 운영하고 진행 학년과 게임 시간은 바꿀 수 없다', async () => {
    repository.signInAs('teacher');
    // 전체 현황은 읽을 수 있다.
    await expect(repository.getOpsDashboard(EVENT, 4)).resolves.toBeTruthy();
    await expect(
      repository.startStationRound({
        eventId: EVENT,
        missionId: 'library-check',
        grade: 4,
        roundNo: 2,
      }),
    ).resolves.toMatchObject({ status: 'active' });
    await expect(repository.getStationRounds(EVENT, 'drawing', 4)).resolves.toHaveLength(5);
    await expect(repository.setGameDuration(EVENT, 8)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
    await expect(
      repository.openFinal({ eventId: EVENT, grade: 4, force: true, reason: '테스트' }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
  });

  it('교사는 모든 학급의 최종 미션을 진행하고, 교사 등록과 행사 설정은 할 수 없다', async () => {
    repository.signInAs('teacher');
    await expect(
      repository.startClassFinal({ eventId: EVENT, classId: 'g3-c4', requestId: 's1' }),
    ).resolves.toMatchObject({ status: 'active' });
    expect((await repository.getClassFinalView(EVENT, 'g3-c1')).canRunFinal).toBe(true);
    await expect(repository.getTeacherRegistry()).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
    await expect(repository.setActiveGrade(EVENT, 5)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
  });

  it('총괄은 종료하지 않은 부스 라운드가 있으면 진행 학년을 바꿀 수 없다', async () => {
    repository.signInAs('admin');
    await expect(repository.setActiveGrade(EVENT, 5)).rejects.toSatisfy(
      (error) =>
        isRepositoryError(error, 'not-allowed') && /종료하지 않은 부스 라운드/.test(error.message),
    );
    // 같은 학년을 다시 고르는 것은 괜찮다.
    await expect(repository.setActiveGrade(EVENT, 4)).resolves.toMatchObject({ activeGrade: 4 });
  });

  it('로그인하지 않으면 대시보드를 볼 수 없다', async () => {
    await expect(repository.getOpsDashboard(EVENT, 4)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
  });
});
