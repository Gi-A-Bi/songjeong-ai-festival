import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_ID } from '../../config';
import { isRepositoryError } from '../errors';
import type { ClassFinalView } from '../EventRepository';
import { createSampleFinalQuestionSet } from './finalQuestions';
import { MockEventRepository } from './MockEventRepository';

const EVENT = DEFAULT_EVENT_ID;
const START = 5_000_000;
const MINUTE = 60_000;
const answers = Object.fromEntries(
  createSampleFinalQuestionSet(3).questions.map((config) => [
    config.question.id,
    { answer: config.answerChoiceId, remove: config.hintRemoveChoiceId },
  ]),
);

describe('MockEventRepository 학급 최종 미션', () => {
  let clock: number;
  let repository: MockEventRepository;

  beforeEach(async () => {
    clock = START;
    repository = new MockEventRepository({ now: () => clock, random: () => 0 });
    await repository.signInTeacher();
  });

  /** 지금 문제부터 끝까지 푼다. wrong에 든 문제는 오답을 고른다. */
  async function solveAll(classId: string, view: ClassFinalView, wrong: string[] = []) {
    let current = view;
    let step = 0;
    while (current.question) {
      const question = current.question;
      const key = answers[question.id];
      const wrongChoice = question.choices.find(
        (choice) => choice.id !== key.answer && choice.id !== key.remove,
      );
      await repository.selectFinalChoice({
        eventId: EVENT,
        classId,
        questionId: question.id,
        choiceId: wrong.includes(question.id) ? (wrongChoice?.id ?? '') : key.answer,
      });
      clock += 20_000;
      step += 1;
      current = await repository.confirmFinalAnswer({
        eventId: EVENT,
        classId,
        questionId: question.id,
        requestId: `${classId}-confirm-${step}`,
      });
    }
    return current;
  }

  it('총괄 운영자가 열기 전에는 시작할 수 없고, 조건을 못 채우면 사유를 적어 강제로만 연다', async () => {
    // 4학년은 아직 투어 중이라 개방 조건을 채우지 못했다.
    const board = await repository.getFinalBoard(EVENT, 4);
    expect(board.session.status).toBe('locked');
    expect(board.checklist.blockers.length).toBeGreaterThan(0);
    expect(board.rows.every((row) => row.status === 'locked')).toBe(true);

    await expect(
      repository.startClassFinal({ eventId: EVENT, classId: 'g4-c1', requestId: 's0' }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
    await expect(
      repository.openFinal({ eventId: EVENT, grade: 4, force: false, reason: '' }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
    await expect(
      repository.openFinal({ eventId: EVENT, grade: 4, force: true, reason: ' ' }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'invalid-input'));

    const opened = await repository.openFinal({
      eventId: EVENT,
      grade: 4,
      force: true,
      reason: '리허설',
    });
    expect(opened).toMatchObject({ status: 'open', openedAt: START, forceOpenReason: '리허설' });
    // 다시 눌러도 처음 연 기록 그대로
    clock += MINUTE;
    expect(
      (await repository.openFinal({ eventId: EVENT, grade: 4, force: true, reason: '다시' }))
        .openedAt,
    ).toBe(START);
  });

  it('투어를 마친 학년은 조건 확인 뒤 바로 열 수 있다', async () => {
    const board = await repository.getFinalBoard(EVENT, 3);
    expect(board.checklist).toMatchObject({
      roundsClosed: true,
      missingResults: 0,
      pendingAwards: 0,
      blockers: [],
    });
  });

  it('반별 시작은 한 번만 기록되고 카드·힌트 수를 스냅샷으로 고정한다', async () => {
    const first = await repository.startClassFinal({
      eventId: EVENT,
      classId: 'g3-c4',
      requestId: 'start-1',
    });
    // 3학년 4반: 검증 카드만 0/4라 완성 4종
    expect(first.state).toMatchObject({
      status: 'active',
      startedAt: START,
      completedCardTypeCountSnapshot: 4,
      allFiveCardsCompletedSnapshot: false,
      hintTotal: 4,
      hintUsed: 0,
      currentQuestionIndex: 0,
    });
    expect(first.question?.id).toBe('q1');
    // 화면에 가는 문제에는 정답과 힌트 제거 대상이 없다.
    expect(JSON.stringify(first)).not.toMatch(/answerChoiceId|hintRemoveChoiceId/);

    // 새로고침·다른 기기·연타로 다시 시작해도 시작 시각은 그대로다.
    clock += 2 * MINUTE;
    const again = await repository.startClassFinal({
      eventId: EVENT,
      classId: 'g3-c4',
      requestId: 'start-2',
    });
    expect(again.state.startedAt).toBe(START);
    expect(again.state.hintTotal).toBe(4);
  });

  it('힌트는 오답 하나만 지우고, 같은 문제 재사용·연타·보유량 초과를 막는다', async () => {
    const view = await repository.startClassFinal({
      eventId: EVENT,
      classId: 'g3-c4',
      requestId: 'start',
    });
    const questionId = view.question?.id ?? '';
    const key = answers[questionId];
    // 지워질 보기를 먼저 골라 둔다.
    await repository.selectFinalChoice({
      eventId: EVENT,
      classId: 'g3-c4',
      questionId,
      choiceId: key.remove,
    });
    const hint = { eventId: EVENT, classId: 'g3-c4', questionId, requestId: 'hint-1' };
    const used = await repository.applyFinalHint(hint);
    expect(used.response).toMatchObject({
      hintUsed: true,
      removedChoiceId: key.remove,
      selectedChoiceId: null,
    });
    expect(used.response?.removedChoiceId).not.toBe(key.answer);
    expect(used.state.hintUsed).toBe(1);

    // 같은 요청 재전송은 두 번 차감하지 않고, 새 요청은 거부한다.
    expect((await repository.applyFinalHint(hint)).state.hintUsed).toBe(1);
    await expect(repository.applyFinalHint({ ...hint, requestId: 'hint-2' })).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'not-allowed'),
    );
    // 지운 보기는 다시 고를 수 없다.
    await expect(
      repository.selectFinalChoice({
        eventId: EVENT,
        classId: 'g3-c4',
        questionId,
        choiceId: key.remove,
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
  });

  it('힌트는 보유 수만큼만 쓸 수 있다', async () => {
    let view = await repository.startClassFinal({
      eventId: EVENT,
      classId: 'g3-c4',
      requestId: 'start',
    });
    for (let index = 0; index < 4; index += 1) {
      const questionId = view.question?.id ?? '';
      await repository.applyFinalHint({
        eventId: EVENT,
        classId: 'g3-c4',
        questionId,
        requestId: `h${index}`,
      });
      await repository.selectFinalChoice({
        eventId: EVENT,
        classId: 'g3-c4',
        questionId,
        choiceId: answers[questionId].answer,
      });
      view = await repository.confirmFinalAnswer({
        eventId: EVENT,
        classId: 'g3-c4',
        questionId,
        requestId: `c${index}`,
      });
    }
    expect(view.state.hintUsed).toBe(4);
    await expect(
      repository.applyFinalHint({
        eventId: EVENT,
        classId: 'g3-c4',
        questionId: view.question?.id ?? '',
        requestId: 'h-over',
      }),
    ).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'not-allowed') && /남은 힌트/.test(error.message),
    );
  });

  it('10문제를 순서대로 확정하고, 새로고침해도 고른 답과 현재 문제를 복구한다', async () => {
    // 3학년 1반은 3문제를 확정하고 4번 문제를 푸는 중이다.
    let view = await repository.getClassFinalView(EVENT, 'g3-c1');
    expect(view).toMatchObject({ status: 'active', confirmedCount: 3 });
    expect(view.question?.id).toBe('q4');
    expect(view.state).toMatchObject({ hintTotal: 5, hintUsed: 1 });

    // 보기를 고르지 않으면 확정할 수 없다.
    await expect(
      repository.confirmFinalAnswer({
        eventId: EVENT,
        classId: 'g3-c1',
        questionId: 'q4',
        requestId: 'c-empty',
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'invalid-input'));

    await repository.selectFinalChoice({
      eventId: EVENT,
      classId: 'g3-c1',
      questionId: 'q4',
      choiceId: 'a',
    });
    // 확정 전에는 바꿀 수 있고, 다시 열어도 고른 답이 남아 있다.
    await repository.selectFinalChoice({
      eventId: EVENT,
      classId: 'g3-c1',
      questionId: 'q4',
      choiceId: 'b',
    });
    view = await repository.getClassFinalView(EVENT, 'g3-c1');
    expect(view.response?.selectedChoiceId).toBe('b');

    const confirm = { eventId: EVENT, classId: 'g3-c1', questionId: 'q4', requestId: 'c4' };
    view = await repository.confirmFinalAnswer(confirm);
    expect(view.question?.id).toBe('q5');
    // 같은 확정 요청을 다시 보내도 문제를 건너뛰지 않는다.
    expect((await repository.confirmFinalAnswer(confirm)).question?.id).toBe('q5');
    // 이미 지나간 문제는 고칠 수 없다.
    await expect(
      repository.selectFinalChoice({
        eventId: EVENT,
        classId: 'g3-c1',
        questionId: 'q4',
        choiceId: 'a',
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
  });

  it('마지막 문제를 확정하면 제출되고 소요 시간은 서버 시각으로 계산한다', async () => {
    const started = await repository.startClassFinal({
      eventId: EVENT,
      classId: 'g3-c4',
      requestId: 'start',
    });
    const done = await solveAll('g3-c4', started, ['q2', 'q9']);
    expect(done.status).toBe('submitted');
    expect(done.question).toBeNull();
    // 총괄 운영자는 공개 전에도 점수를 본다.
    expect(done.state).toMatchObject({
      correctCount: 8,
      durationMs: 10 * 20_000,
      submittedAt: START + 10 * 20_000,
    });
  });

  it('제한 시간이 끝나면 저장된 답안으로 마감하고 미응답은 오답 처리한다', async () => {
    const started = await repository.startClassFinal({
      eventId: EVENT,
      classId: 'g3-c4',
      requestId: 'start',
    });
    const q1 = started.question?.id ?? '';
    await repository.selectFinalChoice({
      eventId: EVENT,
      classId: 'g3-c4',
      questionId: q1,
      choiceId: answers[q1].answer,
    });
    await repository.confirmFinalAnswer({
      eventId: EVENT,
      classId: 'g3-c4',
      questionId: q1,
      requestId: 'c1',
    });
    // 2번 문제는 고르기만 하고 확정하지 못했다.
    await repository.selectFinalChoice({
      eventId: EVENT,
      classId: 'g3-c4',
      questionId: 'q2',
      choiceId: answers.q2.answer,
    });

    clock = START + 11 * MINUTE;
    expect((await repository.closeExpiredClassFinal(EVENT, 'g3-c4')).status).toBe('active');

    // 시간이 지난 뒤 자동 제출이 안 된 학급은 대시보드에 확인 필요로 보인다.
    clock = START + 13 * MINUTE;
    const board = await repository.getFinalBoard(EVENT, 3);
    expect(board.rows.find((row) => row.classInfo.id === 'g3-c4')?.status).toBe('review_required');

    const closed = await repository.closeExpiredClassFinal(EVENT, 'g3-c4');
    expect(closed.status).toBe('timeout');
    expect(closed.state).toMatchObject({ correctCount: 2, durationMs: 12 * MINUTE });
  });

  it('모든 반이 제출하기 전에는 결과를 공개할 수 없고, 공개 전에는 담임교사에게 점수와 순위를 숨긴다', async () => {
    await expect(repository.publishFinalResults(EVENT, 3)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );

    repository.signInAs('homeroom_teacher', { classId: 'g3-c2' });
    const hiddenBoard = await repository.getFinalBoard(EVENT, 3);
    expect(hiddenBoard.canViewResults).toBe(false);
    expect(hiddenBoard.rows.every((row) => row.state.correctCount === null)).toBe(true);
    expect(hiddenBoard.rows.every((row) => row.state.finalRank === null)).toBe(true);
    // 진행 상태, 문제 번호, 소요 시간, 남은 힌트는 중계한다.
    const class1 = hiddenBoard.rows.find((row) => row.classInfo.id === 'g3-c1');
    expect(class1).toMatchObject({ status: 'active', confirmedCount: 3, hintLeft: 4 });
    const own = await repository.getClassFinalView(EVENT, 'g3-c2');
    expect(own.status).toBe('submitted');
    expect(own.state.correctCount).toBeNull();
    expect(own.state.durationMs).toBe(6 * MINUTE + 10_000);
  });

  it('모든 반이 제출하면 정답 수 → 5종 완성 → 시간 순위로 결과를 공개한다', async () => {
    // 1반(5종 완성)은 남은 문제를 풀어 8문제 정답, 4반은 8문제 정답으로 맞춘다.
    const class1 = await repository.getClassFinalView(EVENT, 'g3-c1');
    await solveAll('g3-c1', class1, ['q5', 'q6']);
    const class4 = await repository.startClassFinal({
      eventId: EVENT,
      classId: 'g3-c4',
      requestId: 'start',
    });
    await solveAll('g3-c4', class4, ['q1', 'q2']);

    let board = await repository.getFinalBoard(EVENT, 3);
    expect(board.allFinished).toBe(true);
    expect(board.session.status).toBe('results_hidden');

    const published = await repository.publishFinalResults(EVENT, 3);
    expect(published.status).toBe('results_published');

    repository.signInAs('homeroom_teacher', { classId: 'g3-c2' });
    board = await repository.getFinalBoard(EVENT, 3);
    expect(board.canViewResults).toBe(true);
    // 네 반 모두 8문제 정답: 5종을 완성한 1반이 1위, 나머지는 소요 시간 순서
    expect(board.rows.map((row) => [row.classInfo.classNo, row.state.finalRank])).toEqual([
      [1, 1],
      [4, 2],
      [2, 3],
      [3, 4],
    ]);
    expect(board.rows.every((row) => row.state.correctCount === 8)).toBe(true);
  });

  it('관리자 보정과 초기화는 사유가 있어야 하고 기록에 남는다', async () => {
    await expect(
      repository.adjustFinalResult({
        eventId: EVENT,
        classId: 'g3-c2',
        correctCount: 9,
        durationMs: null,
        finalRank: null,
        reason: '',
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'invalid-input'));

    const adjusted = await repository.adjustFinalResult({
      eventId: EVENT,
      classId: 'g3-c2',
      correctCount: 9,
      durationMs: 5 * MINUTE,
      finalRank: null,
      reason: '네트워크 오류로 한 문제 누락',
    });
    expect(adjusted).toMatchObject({
      correctCount: 9,
      durationMs: 5 * MINUTE,
      manualOverride: true,
      overrideReason: '네트워크 오류로 한 문제 누락',
      overrideBy: 'dev-teacher',
    });

    await expect(
      repository.resetClassFinal({ eventId: EVENT, classId: 'g3-c3', reason: ' ' }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'invalid-input'));
    const reset = await repository.resetClassFinal({
      eventId: EVENT,
      classId: 'g3-c3',
      reason: '잘못 시작함',
    });
    expect(reset).toMatchObject({ status: 'ready', startedAt: null, hintUsed: 0 });
    expect((await repository.getClassFinalView(EVENT, 'g3-c3')).confirmedCount).toBe(0);

    // 담임교사는 보정·초기화·강제 마감을 할 수 없다.
    repository.signInAs('homeroom_teacher', { classId: 'g3-c3' });
    await expect(
      repository.resetClassFinal({ eventId: EVENT, classId: 'g3-c3', reason: '다시' }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
  });

  it('총괄 운영자는 제출되지 않은 학급을 사유와 함께 강제 마감할 수 있다', async () => {
    const closed = await repository.forceCloseClassFinal({
      eventId: EVENT,
      classId: 'g3-c1',
      reason: '전자칠판 고장',
    });
    // 확정한 3문제만 채점한다.
    expect(closed).toMatchObject({ status: 'timeout', correctCount: 3, manualOverride: true });
    // 시작하지 못한 반은 0점·제한 시간 전체로 마감한다.
    const never = await repository.forceCloseClassFinal({
      eventId: EVENT,
      classId: 'g3-c4',
      reason: '불참',
    });
    expect(never).toMatchObject({ status: 'timeout', correctCount: 0, durationMs: 12 * MINUTE });
  });

  it('어느 반이라도 시작한 뒤에는 제한 시간을 바꿀 수 없다', async () => {
    await expect(repository.setFinalDuration(EVENT, 3, 600)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
    expect((await repository.setFinalDuration(EVENT, 5, 600)).durationLimitSec).toBe(600);
  });
});
