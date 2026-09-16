import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_ID } from '../../config';
import { isRepositoryError } from '../errors';
import { MockEventRepository } from './MockEventRepository';
import { toTeamId } from './keys';
import { DEMO_TEAM_ID } from './seed';

const EVENT = DEFAULT_EVENT_ID;

describe('MockEventRepository', () => {
  let repository: MockEventRepository;

  beforeEach(() => {
    repository = new MockEventRepository({ now: () => 1_000_000, random: () => 0 });
  });

  it('3~6학년 학급 수와 학급당 5팀을 만든다', async () => {
    const counts = await Promise.all(
      ([3, 4, 5, 6] as const).map(async (grade) => ({
        classes: (await repository.listClasses(EVENT, grade)).length,
        teams: (await repository.listTeams(EVENT, grade)).length,
      })),
    );
    expect(counts).toEqual([
      { classes: 4, teams: 20 },
      { classes: 5, teams: 25 },
      { classes: 6, teams: 30 },
      { classes: 5, teams: 25 },
    ]);
  });

  it('샘플 팀은 4학년 2반 3팀, 카드 2장과 미사용 뽑기권 3장으로 시작한다', async () => {
    const tickets = await repository.listTeamTickets(EVENT, DEMO_TEAM_ID);
    expect(tickets.filter((item) => item.claimed)).toHaveLength(2);
    const unclaimed = tickets.filter((item) => !item.claimed);
    expect(unclaimed).toHaveLength(3);
    expect(unclaimed.every((item) => item.cardType === null)).toBe(true);
  });

  it('사용한 뽑기권으로 다시 카드를 뽑을 수 없다', async () => {
    const [first] = (await repository.listTeamTickets(EVENT, DEMO_TEAM_ID)).filter(
      (item) => !item.claimed,
    );
    const cardType = await repository.claimTicket(EVENT, DEMO_TEAM_ID, first.id);
    expect(cardType).toBeTruthy();
    await expect(repository.claimTicket(EVENT, DEMO_TEAM_ID, first.id)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'already-claimed'),
    );
  });

  it('순위 확정 시 1위 3장, 2위 2장, 나머지 1장을 만들고 다시 눌러도 늘지 않는다', async () => {
    await repository.signInTeacher();
    const participants = await repository.listMissionParticipants(EVENT, 'golden-bell', 4, 2);
    expect(participants).toHaveLength(5);
    const input = {
      eventId: EVENT,
      missionId: 'golden-bell',
      grade: 4 as const,
      roundNo: 2 as const,
      requestId: 'req-1',
      entries: participants.map((participant, index) => ({
        teamId: participant.team.id,
        score: 500 - index * 100,
        rank: index + 1,
      })),
    };
    const outcome = await repository.finalizeRanking(input);
    expect(participants.map((participant) => outcome.ticketsByTeam[participant.team.id])).toEqual([
      3, 2, 1, 1, 1,
    ]);
    const again = await repository.finalizeRanking({ ...input, requestId: 'req-2' });
    expect(again.alreadyFinalized).toBe(true);
    expect(Object.values(again.ticketsByTeam).reduce((sum, count) => sum + count, 0)).toBe(8);
  });

  it('보유량보다 많은 교환은 막고 교환 후 수량을 갱신한다', async () => {
    await repository.signInTeacher();
    const rows = await repository.listClassCardRows(EVENT, 4);
    const [from, to] = rows;
    const owned = from.counts.thinking;
    const base = {
      eventId: EVENT,
      fromClassId: from.classInfo.id,
      toClassId: to.classInfo.id,
      cardType: 'thinking' as const,
    };

    await expect(
      repository.createExchange({ ...base, requestId: 'ex-over', quantity: owned + 1 }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'insufficient-cards'));

    if (owned > 0) {
      await repository.createExchange({ ...base, requestId: 'ex-ok', quantity: 1 });
      await repository.createExchange({ ...base, requestId: 'ex-ok', quantity: 1 });
      const after = await repository.listClassCardRows(EVENT, 4);
      expect(after[0].counts.thinking).toBe(owned - 1);
      expect(after[1].counts.thinking).toBe(to.counts.thinking + 1);
      expect(await repository.listExchanges(EVENT, 4)).toHaveLength(1);
    }
  });

  it('같은 requestId로 다시 제출해도 제출이 중복되지 않는다', async () => {
    const input = {
      eventId: EVENT,
      missionId: 'ozobot',
      teamId: DEMO_TEAM_ID,
      answer: { type: 'ozobot' as const, ready: true as const },
      requestId: 'submit-1',
    };
    const first = await repository.saveSubmission(input);
    const retry = await repository.saveSubmission(input);
    expect(retry.id).toBe(first.id);
    await expect(repository.saveSubmission({ ...input, requestId: 'submit-2' })).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'not-allowed'),
    );
  });

  it('지금 라운드가 아닌 미션은 제출을 받지 않는다', async () => {
    // 샘플 팀(3팀)의 골든벨은 4라운드 미션이고 지금은 2라운드
    await expect(
      repository.saveSubmission({
        eventId: EVENT,
        missionId: 'golden-bell',
        teamId: DEMO_TEAM_ID,
        answer: { type: 'golden_bell', selections: { q1: 1 } },
        requestId: 'early',
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
    // 진행 중이 아닌 학년의 팀도 받지 않는다.
    await expect(
      repository.saveSubmission({
        eventId: EVENT,
        missionId: 'ozobot',
        teamId: toTeamId(3, 1, 3),
        answer: { type: 'ozobot', ready: true },
        requestId: 'other-grade',
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
  });

  it('교사 화면에는 자동 점수가 채워지고, 재제출을 허용하면 라운드가 끝나도 다시 낼 수 있다', async () => {
    // 2라운드 골든벨은 5팀. 4학년 2반 5팀은 아직 제출하지 않았다.
    const teamId = toTeamId(4, 2, 5);
    await repository.saveSubmission({
      eventId: EVENT,
      missionId: 'golden-bell',
      teamId,
      answer: { type: 'golden_bell', selections: { q1: 1, q2: 2 } },
      requestId: 'gb-1',
    });
    await repository.signInTeacher();
    const rows = await repository.listMissionParticipants(EVENT, 'golden-bell', 4, 2);
    expect(rows.find((row) => row.team.id === teamId)?.submission?.score).toBe(200);

    const notified: number[] = [];
    const stop = repository.subscribeMissionState(
      EVENT,
      'golden-bell',
      4,
      2,
      (state) => notified.push(state.updatedAt),
      () => undefined,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await repository.controlRound(EVENT, 'end');
    await repository.reopenSubmission({ eventId: EVENT, missionId: 'golden-bell', teamId });
    expect(notified.length).toBe(2);
    stop();

    const view = await repository.getTeamMissionView(EVENT, teamId, 'golden-bell');
    expect(view.submission).toMatchObject({ status: 'draft', reopened: true });
    const again = await repository.saveSubmission({
      eventId: EVENT,
      missionId: 'golden-bell',
      teamId,
      answer: { type: 'golden_bell', selections: { q1: 1 } },
      requestId: 'gb-2',
    });
    expect(again.status).toBe('submitted');
  });

  it('확정 전에만 제출을 되돌릴 수 있다', async () => {
    await repository.signInTeacher();
    // 1라운드는 이미 확정된 상태로 시작한다.
    const [row] = await repository.listMissionParticipants(EVENT, 'golden-bell', 4, 1);
    await expect(
      repository.reopenSubmission({
        eventId: EVENT,
        missionId: 'golden-bell',
        teamId: row.team.id,
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
  });

  it('순위를 고치면 뽑기권을 더 주거나 회수하고, 회수한 뽑기권은 쓸 수 없다', async () => {
    await repository.signInTeacher();
    const participants = await repository.listMissionParticipants(EVENT, 'golden-bell', 4, 2);
    const base = {
      eventId: EVENT,
      missionId: 'golden-bell',
      grade: 4 as const,
      roundNo: 2 as const,
    };
    await repository.finalizeRanking({
      ...base,
      requestId: 'fin',
      entries: participants.map((participant, index) => ({
        teamId: participant.team.id,
        score: 100,
        rank: index + 1,
      })),
    });
    const outcome = await repository.reviseRanking({
      ...base,
      requestId: 'rev',
      entries: participants.map((participant, index) => ({
        teamId: participant.team.id,
        score: 100,
        rank: index === 0 ? 3 : index === 2 ? 1 : index + 1,
      })),
    });
    expect(outcome).toMatchObject({ added: 2, revoked: 2, revokedClaimed: 0 });

    const after = await repository.listMissionParticipants(EVENT, 'golden-bell', 4, 2);
    expect(after.map((row) => row.ticketCount)).toEqual([1, 2, 3, 1, 1]);

    const firstTeam = participants[0].team.id;
    const visible = await repository.listTeamTickets(EVENT, firstTeam);
    const revokedId = `golden-bell__g4__r2__${firstTeam}__3`;
    expect(visible.some((ticket) => ticket.id === revokedId)).toBe(false);
    await expect(repository.claimTicket(EVENT, firstTeam, revokedId)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-found'),
    );
  });

  it('그림 파일은 제출과 함께 저장되고 교사만 불러온다', async () => {
    // 2라운드 그리기 미션(3번)은 2팀
    const teamId = toTeamId(4, 2, 2);
    const bytes = new Uint8Array([9, 8, 7]);
    const answer = {
      type: 'drawing' as const,
      strokeCount: 1,
      mimeType: 'image/webp',
      byteSize: 3,
      width: 960,
      height: 540,
    };
    await expect(
      repository.saveSubmission({
        eventId: EVENT,
        missionId: 'drawing',
        teamId,
        answer,
        requestId: 'no-file',
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'invalid-input'));
    await repository.saveSubmission({
      eventId: EVENT,
      missionId: 'drawing',
      teamId,
      answer,
      requestId: 'with-file',
      drawing: {
        promptId: 'draw-sample-1',
        mimeType: 'image/webp',
        width: 960,
        height: 540,
        bytes,
      },
    });
    await expect(repository.listDrawingFiles(EVENT, 'drawing', 4, 2)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
    await repository.signInTeacher();
    const files = await repository.listDrawingFiles(EVENT, 'drawing', 4, 2);
    expect(files.map((file) => [file.teamId, Array.from(file.bytes)])).toEqual([
      [teamId, [9, 8, 7]],
    ]);
  });

  it('교사는 골든벨 문제를 바꿀 수 있고 잘못된 문제는 거부한다', async () => {
    await repository.signInTeacher();
    await expect(
      repository.updateMissionConfig(EVENT, 'golden-bell', { type: 'golden_bell', questions: [] }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'invalid-input'));
    const questions = [
      { id: 'n1', question: '새 문제', choices: ['가', '나'], answerIndex: 1, explanation: '' },
    ];
    await repository.updateMissionConfig(EVENT, 'golden-bell', {
      type: 'golden_bell',
      questions,
    });
    expect((await repository.getMission(EVENT, 'golden-bell')).config).toEqual({
      type: 'golden_bell',
      questions,
    });
  });
});
