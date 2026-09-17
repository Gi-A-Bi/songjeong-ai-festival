import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_ID } from '../../config';
import { isRepositoryError } from '../errors';
import { toTeamId } from './keys';
import { MockEventRepository } from './MockEventRepository';
import { DEMO_TEAM_ID } from './seed';

const EVENT = DEFAULT_EVENT_ID;
const START = 5_000_000;
const MINUTE = 60_000;

describe('MockEventRepository 팀 이동과 운영 대시보드', () => {
  let clock: number;
  let repository: MockEventRepository;

  beforeEach(() => {
    clock = START;
    repository = new MockEventRepository({ now: () => clock, random: () => 0 });
  });

  it('예정 교실 QR은 입장, 다시 찍으면 그대로, 다른 교실은 오입장 안내를 준다', async () => {
    // 샘플 팀(4학년 2반 3팀)의 2라운드 교실은 과학실(로봇 길찾기)이다.
    const wrong = await repository.checkInStation({
      eventId: EVENT,
      teamId: DEMO_TEAM_ID,
      stationId: 'drawing',
    });
    expect(wrong.kind).toBe('wrong_station');
    expect(wrong.expectedMission.id).toBe('ozobot');
    expect(wrong.state).toMatchObject({ status: 'attention', checkedInAt: null });
    expect(wrong.state.alertCodes).toContain('wrong_station');

    const first = await repository.checkInStation({
      eventId: EVENT,
      teamId: DEMO_TEAM_ID,
      stationId: 'ozobot',
    });
    expect(first).toMatchObject({ kind: 'checked_in', roundNo: 2 });
    expect(first.state).toMatchObject({ status: 'checked_in', checkedInAt: START, alertCodes: [] });

    clock += 30_000;
    const again = await repository.checkInStation({
      eventId: EVENT,
      teamId: DEMO_TEAM_ID,
      stationId: 'ozobot',
    });
    expect(again.kind).toBe('already_checked_in');
    expect(again.state.checkedInAt).toBe(START);

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
    await expect(
      repository.checkInStation({ eventId: EVENT, teamId: toTeamId(5, 1, 1), stationId: 'ozobot' }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
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

    // 미도착 2팀(2반 3팀, 4반 5팀)과 잘못된 교실 1팀(5반 4팀)
    const codes = dashboard.alerts.map((alert) => `${alert.team.id}:${alert.code}`).sort();
    expect(codes).toEqual([
      `${toTeamId(4, 2, 3)}:not_arrived`,
      `${toTeamId(4, 4, 5)}:not_arrived`,
      `${toTeamId(4, 5, 4)}:not_arrived`,
      `${toTeamId(4, 5, 4)}:wrong_station`,
    ]);
    expect(dashboard.summary.alertCount).toBe(4);

    // 시작한 부스의 입장 팀은 진행 중이다.
    const goldenBell = dashboard.stations.find((station) => station.mission.id === 'golden-bell');
    expect(goldenBell?.round.status).toBe('active');
    expect(goldenBell?.teams.filter((cell) => cell.state.status === 'active')).toHaveLength(4);
    const ozobot = dashboard.stations.find((station) => station.mission.id === 'ozobot');
    expect(ozobot?.round.status).toBe('ready');
    expect(ozobot?.teams.filter((cell) => cell.state.status === 'checked_in')).toHaveLength(4);
  });

  it('부스 교사가 미션을 시작하면 입장한 팀만 진행 중이 되고, 다시 눌러도 시작 시각은 그대로다', async () => {
    await repository.signInTeacher();
    const input = { eventId: EVENT, missionId: 'ozobot', grade: 4 as const, roundNo: 2 as const };
    const started = await repository.startStationRound(input);
    expect(started).toMatchObject({ status: 'active', startedAt: START });
    clock += MINUTE;
    expect((await repository.startStationRound(input)).startedAt).toBe(START);

    const participants = await repository.listMissionParticipants(EVENT, 'ozobot', 4, 2);
    const byTeam = Object.fromEntries(
      participants.map((row) => [row.team.id, row.movement.status]),
    );
    expect(byTeam[toTeamId(4, 1, 3)]).toBe('active');
    expect(byTeam[DEMO_TEAM_ID]).toBe('attention');

    // 늦게 입장한 팀은 바로 진행 중이 된다.
    const late = await repository.checkInStation({
      eventId: EVENT,
      teamId: DEMO_TEAM_ID,
      stationId: 'ozobot',
    });
    expect(late.state.status).toBe('active');
  });

  it('부스 입장 현황은 부스 상태와 이번 라운드에 올 팀의 상태만 돌려준다', async () => {
    await repository.signInTeacher();
    const before = await repository.getStationArrivals(EVENT, 'ozobot', 4, 2);
    expect(before.booth).toMatchObject({ missionId: 'ozobot', roundNo: 2, status: 'ready' });
    // 2라운드에 과학실로 오는 팀은 학급마다 3팀이다.
    expect(before.movements.map((movement) => movement.teamNo)).toEqual([3, 3, 3, 3, 3]);
    expect(before.movements.find((item) => item.teamId === DEMO_TEAM_ID)?.checkedInAt).toBeNull();

    await repository.checkInStation({ eventId: EVENT, teamId: DEMO_TEAM_ID, stationId: 'ozobot' });
    const after = await repository.getStationArrivals(EVENT, 'ozobot', 4, 2);
    expect(after.movements.find((item) => item.teamId === DEMO_TEAM_ID)?.status).toBe('checked_in');
  });

  it('QR을 찍지 못한 팀은 교사가 직접 입장 처리할 수 있다', async () => {
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

  it('결과를 확정하면 팀은 완료, 부스는 결과 확정이 되고 다시 확정해도 카드 보상이 늘지 않는다', async () => {
    await repository.signInTeacher();
    const participants = await repository.listMissionParticipants(EVENT, 'golden-bell', 4, 2);
    const input = {
      eventId: EVENT,
      missionId: 'golden-bell',
      grade: 4 as const,
      roundNo: 2 as const,
      requestId: 'fin-1',
      entries: participants.map((row, index) => ({
        teamId: row.team.id,
        score: 500 - index * 100,
        rank: index + 1,
      })),
    };
    const first = await repository.finalizeRanking(input);
    const retry = await repository.finalizeRanking({ ...input, requestId: 'fin-2' });
    expect(retry.alreadyFinalized).toBe(true);
    expect(retry.awards.map((award) => award.id)).toEqual(first.awards.map((award) => award.id));

    const after = await repository.listMissionParticipants(EVENT, 'golden-bell', 4, 2);
    expect(after.every((row) => row.movement.status === 'completed')).toBe(true);
    const round = await repository.getMissionRoundState(EVENT, 'golden-bell', 4, 2);
    expect(round).toMatchObject({ status: 'completed', resultFinalizedAt: START });

    const dashboard = await repository.getOpsDashboard(EVENT, 4);
    expect(dashboard.summary.completedTeams).toBe(5);
    const types = dashboard.activity.map((event) => event.type);
    expect(types.filter((type) => type === 'result_finalized')).toHaveLength(1);
    // 자동 배정된 3팀의 카드 획득이 기록된다.
    expect(types.filter((type) => type === 'card_earned')).toHaveLength(3);
  });

  it('라운드가 끝나고 이동 시간이 지나도 결과가 없으면 결과 미입력 경고가 뜬다', async () => {
    await repository.signInTeacher();
    await repository.controlRound(EVENT, 'end');
    clock += MINUTE;
    let dashboard = await repository.getOpsDashboard(EVENT, 4, 2);
    expect(dashboard.summary.phase).toBe('moving');
    expect(dashboard.alerts.filter((alert) => alert.code === 'result_missing')).toHaveLength(0);

    clock += MINUTE;
    dashboard = await repository.getOpsDashboard(EVENT, 4, 2);
    expect(dashboard.alerts.filter((alert) => alert.code === 'result_missing')).toHaveLength(25);

    // 이동 시간에는 기본으로 다음 라운드(입장 확인용)를 보여 주고 직전 라운드 미입력도 함께 알린다.
    const next = await repository.getOpsDashboard(EVENT, 4);
    expect(next.summary.roundNo).toBe(3);
    expect(next.summary.checkedInTeams).toBe(0);
    expect(next.alerts.some((alert) => alert.code === 'result_missing')).toBe(true);
  });

  it('이동 시간에 찍은 QR은 다음 라운드 입장으로 기록된다', async () => {
    await repository.signInTeacher();
    await repository.controlRound(EVENT, 'end');
    // 3팀의 3라운드 교실은 도서관(AI 오류찾기)
    const outcome = await repository.checkInStation({
      eventId: EVENT,
      teamId: DEMO_TEAM_ID,
      stationId: 'library-check',
    });
    expect(outcome).toMatchObject({ kind: 'checked_in', roundNo: 3 });
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
    await repository.checkInStation({ eventId: EVENT, teamId: DEMO_TEAM_ID, stationId: 'ozobot' });
    // 같은 QR을 다시 찍은 것은 상태 변화가 아니라 알리지 않는다.
    await repository.checkInStation({ eventId: EVENT, teamId: DEMO_TEAM_ID, stationId: 'ozobot' });
    stop();
    expect(revisions).toHaveLength(2);
  });

  it('학급 상세에 팀별 위치, 순위, 획득 카드, 예상 힌트 수가 나온다', async () => {
    await repository.signInTeacher();
    const detail = await repository.getClassOpsDetail(EVENT, 'g3-c2');
    expect(detail.teams).toHaveLength(5);
    expect(detail.teams[0].completedCount).toBe(5);
    expect(detail.teams[0].results.every((result) => result.rank !== null)).toBe(true);
    expect(detail.teams[0].earnedTypes).toHaveLength(5);
    // 3학년 2반은 표현 카드만 3/4라 완성 4종, 힌트 4개
    expect(detail.progress.completedCount).toBe(4);
    expect(detail.hintPreview).toBe(4);
  });
});

describe('MockEventRepository 역할별 권한', () => {
  let repository: MockEventRepository;

  beforeEach(() => {
    repository = new MockEventRepository({ now: () => START, random: () => 0 });
  });

  it('부스 교사는 담당 미션만 운영하고 라운드 제어는 할 수 없다', async () => {
    repository.signInAs('station_teacher', { missionId: 'ozobot' });
    // 전체 현황은 읽을 수 있다.
    await expect(repository.getOpsDashboard(EVENT, 4)).resolves.toBeTruthy();
    await expect(
      repository.startStationRound({ eventId: EVENT, missionId: 'ozobot', grade: 4, roundNo: 2 }),
    ).resolves.toMatchObject({ status: 'active' });
    await expect(
      repository.startStationRound({ eventId: EVENT, missionId: 'drawing', grade: 4, roundNo: 2 }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
    await expect(repository.controlRound(EVENT, 'end')).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
    await expect(
      repository.openFinal({ eventId: EVENT, grade: 4, force: true, reason: '테스트' }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
  });

  it('담임교사는 담당 학급의 최종 미션만 진행하고 부스 결과는 고칠 수 없다', async () => {
    repository.signInAs('homeroom_teacher', { classId: 'g3-c4' });
    await expect(
      repository.startClassFinal({ eventId: EVENT, classId: 'g3-c4', requestId: 's1' }),
    ).resolves.toMatchObject({ status: 'active' });
    await expect(
      repository.startClassFinal({ eventId: EVENT, classId: 'g3-c1', requestId: 's2' }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
    await expect(
      repository.startStationRound({ eventId: EVENT, missionId: 'ozobot', grade: 4, roundNo: 2 }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
  });

  it('로그인하지 않으면 대시보드를 볼 수 없다', async () => {
    await expect(repository.getOpsDashboard(EVENT, 4)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
  });
});
