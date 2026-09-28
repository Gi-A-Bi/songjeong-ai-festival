import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_ID } from '../../config';
import { countRehearsalRecords } from '../../domain/rehearsal';
import { isRepositoryError } from '../errors';
import { toTeamId } from './keys';
import { MockEventRepository } from './MockEventRepository';
import { DEMO_TEAM_ID } from './seed';

/*
 * 샘플 데이터
 * - 4학년: 1라운드를 마치고 2라운드를 하는 중이다.
 * - 3학년: 투어를 마치고 최종 미션이 열려 있다.
 */
const EVENT = DEFAULT_EVENT_ID;

describe('MockEventRepository 연습 기록 지우기', () => {
  let repository: MockEventRepository;

  beforeEach(() => {
    repository = new MockEventRepository({ now: () => 5_000_000, random: () => 0 });
    repository.signInAs('admin');
  });

  it('학년에 남은 기록 수를 알려 준다', async () => {
    const summary = await repository.getRehearsalSummary(EVENT, 4);
    expect(summary.grade).toBe(4);
    expect(summary.counts).toEqual({
      // 1라운드 25팀 + 2라운드 게임 중인 부스의 9팀
      submissions: 34,
      results: 25,
      cardAwards: 25,
      // 2라운드 25팀 가운데 아직 오지 않은 2팀을 뺀 기록(잘못 찍은 기록 포함)
      checkIns: 23,
      // 다섯 부스의 1·2라운드
      boothRounds: 10,
      finalClasses: 0,
      // 팀마다 기기 한 대
      devices: 25,
    });
    expect(summary.finalOpened).toBe(false);

    const finished = await repository.getRehearsalSummary(EVENT, 3);
    expect(finished.finalOpened).toBe(true);
    expect(finished.counts.finalClasses).toBe(3);
    expect(finished.counts.boothRounds).toBe(25);

    // 아직 시작하지 않은 학년에는 기록이 없다.
    const untouched = await repository.getRehearsalSummary(EVENT, 5);
    expect(countRehearsalRecords(untouched.counts)).toBe(0);
    expect(untouched.finalOpened).toBe(false);
  });

  it('지우면 그 학년은 처음 상태가 되고 다른 학년은 그대로다', async () => {
    const otherBefore = await repository.getRehearsalSummary(EVENT, 3);
    const after = await repository.resetRehearsal({ eventId: EVENT, grade: 4 });
    expect(countRehearsalRecords(after.counts)).toBe(0);
    expect(await repository.getRehearsalSummary(EVENT, 3)).toEqual(otherBefore);

    // 부스는 모두 1라운드를 열기 전이다.
    const rounds = await repository.getStationRounds(EVENT, 'golden-bell', 4);
    expect(rounds.map((round) => round.status)).toEqual([
      'ready',
      'ready',
      'ready',
      'ready',
      'ready',
    ]);
    const dashboard = await repository.getOpsDashboard(EVENT, 4);
    expect(dashboard.summary).toMatchObject({
      roundNo: 0,
      phase: 'ready',
      checkedInTeams: 0,
      completedTeams: 0,
      alertCount: 0,
    });
    expect(dashboard.activity).toEqual([]);

    // 팀은 첫 라운드부터 다시 시작하고 제출·카드가 없다.
    const tour = await repository.getTeamTourStatus(EVENT, DEMO_TEAM_ID);
    expect(tour).toMatchObject({ roundNo: 1, state: { status: 'scheduled', checkedInAt: null } });
    expect(await repository.listTeamSubmissions(EVENT, DEMO_TEAM_ID)).toEqual([]);
    const reward = await repository.getTeamRewardView(EVENT, DEMO_TEAM_ID);
    expect(reward.awards).toEqual([]);
    expect(reward.progress.completedCount).toBe(0);
    const boards = await repository.listClassCardBoards(EVENT, 4);
    expect(boards.every((board) => board.progress.completedCount === 0)).toBe(true);
    expect(await repository.listClassDevices(EVENT, 'g4-c2')).toEqual([]);

    // 정답 공개 상태도 처음으로 돌아간다.
    expect(await repository.isAnswerRevealed(EVENT, 'golden-bell', 4, 1)).toBe(false);
  });

  it('행사 구조와 미션 문제, 진행 학년, 게임 시간은 남긴다', async () => {
    await repository.setGameDuration(EVENT, 8);
    const missionBefore = await repository.getMission(EVENT, 'golden-bell');
    await repository.resetRehearsal({ eventId: EVENT, grade: 4 });

    expect(await repository.listClasses(EVENT, 4)).toHaveLength(5);
    expect(await repository.listTeams(EVENT, 4)).toHaveLength(25);
    expect(await repository.getMission(EVENT, 'golden-bell')).toEqual(missionBefore);
    expect(await repository.getEvent(EVENT)).toMatchObject({
      activeGrade: 4,
      gameDurationMs: 8 * 60_000,
    });
    expect((await repository.getTeacherRegistry()).accounts.length).toBeGreaterThan(0);
  });

  it('지운 뒤에는 부스가 1라운드부터 다시 진행할 수 있다', async () => {
    await repository.resetRehearsal({ eventId: EVENT, grade: 4 });
    const booth = {
      eventId: EVENT,
      missionId: 'golden-bell',
      grade: 4 as const,
      roundNo: 1 as const,
    };
    await expect(repository.openStationRound(booth)).resolves.toMatchObject({ status: 'open' });
    await expect(repository.startStationRound(booth)).resolves.toMatchObject({
      status: 'active',
    });
    // 1라운드 골든벨에는 각 반 1팀이 온다.
    const saved = await repository.saveSubmission({
      eventId: EVENT,
      missionId: 'golden-bell',
      teamId: toTeamId(4, 1, 1),
      answer: { type: 'golden_bell', selections: { q1: 1 } },
      requestId: 'after-reset',
    });
    expect(saved.status).toBe('submitted');
  });

  it('최종 미션은 제한 시간을 남기고 열기 전으로 돌아간다', async () => {
    const before = await repository.getFinalBoard(EVENT, 3);
    expect(before.session.status).not.toBe('locked');

    const after = await repository.resetRehearsal({ eventId: EVENT, grade: 3 });
    expect(after.finalOpened).toBe(false);
    expect(countRehearsalRecords(after.counts)).toBe(0);

    const board = await repository.getFinalBoard(EVENT, 3);
    expect(board.session).toMatchObject({
      status: 'locked',
      openedAt: null,
      durationLimitSec: before.session.durationLimitSec,
    });
    expect(board.rows.every((row) => row.state.startedAt === null)).toBe(true);
    // 최종 미션 문제는 그대로 있다.
    const sets = await repository.listFinalQuestionSets(EVENT);
    expect(sets.find((item) => item.grade === 3)?.questionCount).toBe(10);
  });

  it('구독 중인 화면에 바뀐 것을 알린다', async () => {
    const ops: number[] = [];
    const teamEvents: string[] = [];
    const stopOps = repository.subscribeOps(
      EVENT,
      4,
      (revision) => ops.push(revision),
      () => undefined,
    );
    const stopTeam = repository.subscribeTeamEvent(
      EVENT,
      DEMO_TEAM_ID,
      (event) => teamEvents.push(`${event.status}:${event.activeRound}:${event.boothStatus}`),
      () => undefined,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(teamEvents).toEqual(['active:2:active']);

    await repository.resetRehearsal({ eventId: EVENT, grade: 4 });
    stopOps();
    stopTeam();
    expect(ops.length).toBeGreaterThan(1);
    expect(teamEvents[teamEvents.length - 1]).toBe('ready:0:ready');
  });

  it('교사는 연습 기록을 보거나 지울 수 없다', async () => {
    repository.signInAs('teacher');
    await expect(repository.getRehearsalSummary(EVENT, 4)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
    await expect(repository.resetRehearsal({ eventId: EVENT, grade: 4 })).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'not-allowed'),
    );
    repository.signInAs('admin');
    expect((await repository.getRehearsalSummary(EVENT, 4)).counts.results).toBe(25);
  });
});

describe('MockEventRepository 건너뛴 라운드와 최종 미션 점검', () => {
  it('모든 라운드를 건너뛰면 결과가 없어도 최종 미션을 열 수 있다', async () => {
    const repository = new MockEventRepository({ now: () => 5_000_000, random: () => 0 });
    repository.signInAs('admin');
    await repository.setActiveGrade(EVENT, 4);
    await repository.resetRehearsal({ eventId: EVENT, grade: 4 });

    const missions = await repository.listMissions(EVENT);
    const before = await repository.getFinalBoard(EVENT, 4);
    expect(before.checklist).toMatchObject({ roundsClosed: false, missingResults: 25 });

    for (const mission of missions) {
      for (const roundNo of [1, 2, 3, 4, 5] as const) {
        await repository.skipStationRound({
          eventId: EVENT,
          missionId: mission.id,
          grade: 4,
          roundNo,
        });
      }
    }
    const after = await repository.getFinalBoard(EVENT, 4);
    expect(after.checklist).toMatchObject({
      roundsClosed: true,
      missingResults: 0,
      pendingAwards: 0,
      blockers: [],
    });
    await expect(
      repository.openFinal({ eventId: EVENT, grade: 4, force: false, reason: '' }),
    ).resolves.toMatchObject({ status: 'open' });
  });
});
