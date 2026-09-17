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

  it('샘플 팀은 4학년 2반 3팀, 1라운드 1위 카드 보상을 아직 고르지 않은 상태로 시작한다', async () => {
    const view = await repository.getTeamRewardView(EVENT, DEMO_TEAM_ID);
    expect(view.classInfo.displayName).toBe('4학년 2반');
    expect(view.awards).toHaveLength(1);
    expect(view.awards[0]).toMatchObject({
      status: 'pending',
      selectionMode: 'choose_three',
      selectedType: null,
      sourceLabel: '1라운드 AI 설명대로 그려라 1위',
    });
    expect(view.progress.cards.thinking.pieces).toBe(2);
  });

  it('순위 확정 시 결과 하나당 카드 보상 하나를 만들고 1위 3개·2위 2개·나머지 1개 후보를 준다', async () => {
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
    expect(outcome.awards.map((award) => award.offeredTypes.length)).toEqual([3, 2, 1, 1, 1]);
    expect(outcome.awards.map((award) => award.status)).toEqual([
      'pending',
      'pending',
      'claimed',
      'claimed',
      'claimed',
    ]);
    for (const award of outcome.awards) {
      expect(new Set(award.offeredTypes).size).toBe(award.offeredTypes.length);
    }

    // 다시 누르거나(다른 requestId) 새로고침 뒤 다시 확정해도 보상은 늘지 않는다.
    const again = await repository.finalizeRanking({ ...input, requestId: 'req-2' });
    expect(again.alreadyFinalized).toBe(true);
    expect(again.awards.map((award) => award.id)).toEqual(outcome.awards.map((award) => award.id));
    const rows = await repository.listMissionParticipants(EVENT, 'golden-bell', 4, 2);
    expect(rows.map((row) => row.award?.id)).toEqual(outcome.awards.map((award) => award.id));
  });

  it('학생은 후보 밖 종류를 고를 수 없고, 같은 보상은 한 번만 받는다', async () => {
    const [pending] = (await repository.getTeamRewardView(EVENT, DEMO_TEAM_ID)).awards;
    const claim = {
      eventId: EVENT,
      teamId: DEMO_TEAM_ID,
      awardId: pending.id,
      requestId: 'claim-1',
    };
    await expect(
      repository.claimCardAward({ ...claim, selectedType: 'verification' }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'invalid-input'));
    // 다른 팀이 이 보상을 받을 수 없다.
    await expect(
      repository.claimCardAward({
        ...claim,
        teamId: toTeamId(4, 2, 1),
        selectedType: 'thinking',
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-found'));

    const outcome = await repository.claimCardAward({ ...claim, selectedType: 'thinking' });
    expect(outcome.before).toMatchObject({ pieces: 2 });
    expect(outcome.after).toMatchObject({ pieces: 3, complete: false });
    expect(outcome.award.status).toBe('claimed');

    // 같은 요청의 재시도는 같은 결과, 새 요청은 거부
    const retry = await repository.claimCardAward({ ...claim, selectedType: 'thinking' });
    expect(retry.after.earned).toBe(3);
    await expect(
      repository.claimCardAward({ ...claim, requestId: 'claim-2', selectedType: 'expression' }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'already-claimed'));

    const view = await repository.getTeamRewardView(EVENT, DEMO_TEAM_ID);
    expect(view.progress.cards.thinking.earned).toBe(3);
    expect(view.progress.cards.expression.earned).toBe(1);
  });

  it('학급 카드 진행도는 받은 보상 원장으로 계산한다', async () => {
    const boards = await repository.listClassCardBoards(EVENT, 3);
    const byClass = Object.fromEntries(
      boards.map((board) => [board.classInfo.classNo, board.progress]),
    );
    expect(byClass[1].allComplete).toBe(true);
    expect(byClass[1].cards.command).toMatchObject({ pieces: 4, duplicates: 1 });
    expect(byClass[2].cards.expression).toMatchObject({ pieces: 3, complete: false });
    expect(byClass[4].cards.verification.pieces).toBe(0);
    expect(byClass[4].cards.thinking.duplicates).toBe(4);

    await repository.signInTeacher();
    const detail = await repository.getTeacherClassCards(EVENT, 'g3-c1');
    expect(detail.awards).toHaveLength(25);
    expect(detail.teams.map((team) => team.teamNo)).toEqual([1, 2, 3, 4, 5]);
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

  it('부스 제출 구독은 그 부스의 제출과 재제출 허용만 알린다', async () => {
    await repository.signInTeacher();
    const notified: number[] = [];
    const others: number[] = [];
    const stop = repository.subscribeStationSubmissions(
      EVENT,
      'golden-bell',
      4,
      2,
      (revision) => notified.push(revision),
      () => undefined,
    );
    const stopOther = repository.subscribeStationSubmissions(
      EVENT,
      'ozobot',
      4,
      2,
      (revision) => others.push(revision),
      () => undefined,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    // 구독이 붙으면 한 번 알린다.
    expect(notified).toHaveLength(1);
    expect(others).toHaveLength(1);

    const teamId = toTeamId(4, 2, 5);
    await repository.saveSubmission({
      eventId: EVENT,
      missionId: 'golden-bell',
      teamId,
      answer: { type: 'golden_bell', selections: { q1: 1 } },
      requestId: 'station-live-1',
    });
    expect(notified).toHaveLength(2);
    await repository.reopenSubmission({ eventId: EVENT, missionId: 'golden-bell', teamId });
    expect(notified).toHaveLength(3);
    // 다른 부스에는 알리지 않는다.
    expect(others).toHaveLength(1);

    stop();
    stopOther();
    await repository.saveSubmission({
      eventId: EVENT,
      missionId: 'golden-bell',
      teamId,
      answer: { type: 'golden_bell', selections: { q1: 1 } },
      requestId: 'station-live-2',
    });
    expect(notified).toHaveLength(3);
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

  it('순위를 고치면 고르기 전 보상만 새 순위에 맞추고 받은 보상은 그대로 둔다', async () => {
    await repository.signInTeacher();
    const participants = await repository.listMissionParticipants(EVENT, 'golden-bell', 4, 2);
    const base = {
      eventId: EVENT,
      missionId: 'golden-bell',
      grade: 4 as const,
      roundNo: 2 as const,
    };
    const finalized = await repository.finalizeRanking({
      ...base,
      requestId: 'fin',
      entries: participants.map((participant, index) => ({
        teamId: participant.team.id,
        score: 100,
        rank: index + 1,
      })),
    });
    // 1위 팀은 3종 중 선택 대기, 3위 팀은 자동 배정으로 이미 받았다.
    const outcome = await repository.reviseRanking({
      ...base,
      requestId: 'rev',
      entries: participants.map((participant, index) => ({
        teamId: participant.team.id,
        score: 100,
        rank: index === 0 ? 3 : index === 2 ? 1 : index + 1,
      })),
    });
    expect(outcome).toMatchObject({ reoffered: 1, keptClaimed: 1 });

    const after = await repository.listMissionParticipants(EVENT, 'golden-bell', 4, 2);
    expect(after[0].award).toMatchObject({
      selectionMode: 'automatic',
      status: 'claimed',
      selectedType: finalized.awards[0].offeredTypes[0],
    });
    expect(after[2].award).toMatchObject({
      rank: 1,
      status: 'claimed',
      selectedType: finalized.awards[2].selectedType,
    });
    expect(after.map((row) => row.award?.id)).toEqual(finalized.awards.map((award) => award.id));
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
