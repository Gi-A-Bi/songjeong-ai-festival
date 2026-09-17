import { describe, expect, it } from 'vitest';
import { createSampleFinalQuestionSet } from '../data/mock/finalQuestions';
import { CARD_TYPES, computeClassCardProgress } from './cards';
import {
  applyHint,
  canViewFinalResults,
  emptyFinalClassState,
  emptyFinalResponse,
  emptyFinalSession,
  FINAL_REVIEW_GRACE_MS,
  finishFinal,
  getAnswerBlocker,
  getChoiceError,
  getFinalOpenBlockers,
  getFinalStartBlocker,
  getHintBlocker,
  getHintTotal,
  getOverrideError,
  getQuestionSetError,
  presentFinalClassStatus,
  rankFinalClasses,
  redactFinalClassState,
  scoreResponses,
  snapshotCards,
} from './finalMission';
import type { CardType, FinalClassState } from './types';

const set = createSampleFinalQuestionSet(3);
const session = { ...emptyFinalSession(3), status: 'open' as const };
const MINUTE = 60_000;

function progressOf(counts: Partial<Record<CardType, number>>) {
  const awards = CARD_TYPES.flatMap((cardType) =>
    Array.from({ length: counts[cardType] ?? 0 }, () => ({
      classId: 'c1',
      status: 'claimed' as const,
      selectedType: cardType,
    })),
  );
  return computeClassCardProgress('c1', awards);
}

function finished(classId: string, patch: Partial<FinalClassState>): FinalClassState {
  return {
    ...emptyFinalClassState(classId, 3, 0),
    status: 'submitted',
    startedAt: 0,
    submittedAt: patch.durationMs ?? 0,
    ...patch,
  };
}

describe('카드와 공통 힌트', () => {
  it('완성 카드 종류 수가 힌트 수이고 중복 조각은 힌트를 늘리지 않는다', () => {
    expect(getHintTotal(progressOf({}))).toBe(0);
    expect(getHintTotal(progressOf({ thinking: 4, command: 3 }))).toBe(1);
    // 생각 카드를 9번 받아도 완성 카드는 1종이다.
    expect(getHintTotal(progressOf({ thinking: 9, command: 4 }))).toBe(2);
    const all = progressOf({
      thinking: 5,
      observation: 4,
      expression: 4,
      command: 6,
      verification: 4,
    });
    expect(getHintTotal(all)).toBe(5);
    expect(all.allComplete).toBe(true);
  });

  it('시작할 때 완성 카드 수, 5종 완성 여부, 힌트 수를 스냅샷으로 고정한다', () => {
    const four = progressOf({ thinking: 4, observation: 4, expression: 4, command: 4 });
    expect(snapshotCards(four)).toEqual({
      completedCardTypeCountSnapshot: 4,
      allFiveCardsCompletedSnapshot: false,
      hintTotal: 4,
    });
  });
});

describe('문제 설정', () => {
  it('샘플은 10문제, 4지선다, 영역별 2문제이며 힌트는 정답을 지우지 않는다', () => {
    expect(getQuestionSetError(set)).toBeNull();
    expect(set.questions).toHaveLength(10);
    for (const cardType of CARD_TYPES) {
      expect(set.questions.filter((config) => config.question.area === cardType)).toHaveLength(2);
    }
    for (const config of set.questions) {
      expect(config.question.choices).toHaveLength(4);
      expect(config.hintRemoveChoiceId).not.toBe(config.answerChoiceId);
    }
    // 화면에 보내는 문제에는 정답이 들어 있지 않다.
    expect(JSON.stringify(set.questions[0].question)).not.toContain('answerChoiceId');
  });

  it('정답을 지우는 힌트와 문제 수가 다른 설정은 거부한다', () => {
    const [first, ...rest] = set.questions;
    expect(
      getQuestionSetError({
        questions: [{ ...first, hintRemoveChoiceId: first.answerChoiceId }, ...rest],
      }),
    ).toMatch(/정답 보기를 지우면/);
    expect(getQuestionSetError({ questions: rest })).toMatch(/10문제/);
  });
});

describe('힌트 사용', () => {
  const config = set.questions[0];
  const state = { ...emptyFinalClassState('c1', 3, 0), status: 'active' as const, hintTotal: 2 };
  const response = emptyFinalResponse('c1', 3, config.question.id, 0);

  it('오답 보기 하나만 지우고, 고른 보기가 지워지면 선택을 먼저 푼다', () => {
    const picked = { ...response, selectedChoiceId: config.hintRemoveChoiceId };
    const next = applyHint(state, picked, config, 100);
    expect(next.state.hintUsed).toBe(1);
    expect(next.response).toMatchObject({
      hintUsed: true,
      removedChoiceId: config.hintRemoveChoiceId,
      selectedChoiceId: null,
    });
    expect(next.response.removedChoiceId).not.toBe(config.answerChoiceId);
    expect(getChoiceError(config, next.response, config.hintRemoveChoiceId)).toMatch(/지운 보기/);
    expect(getChoiceError(config, next.response, config.answerChoiceId)).toBeNull();
  });

  it('같은 문제에 두 번 쓰거나 보유 수를 넘겨 쓸 수 없다', () => {
    expect(getHintBlocker(state, response)).toBeNull();
    expect(getHintBlocker(state, { hintUsed: true })).toBe('이 문제에서는 이미 힌트를 썼어요.');
    expect(getHintBlocker({ hintTotal: 2, hintUsed: 2 }, response)).toBe('남은 힌트가 없어요.');
    expect(getHintBlocker({ hintTotal: 0, hintUsed: 0 }, response)).not.toBeNull();
  });

  it('확정한 문제와 시간이 끝난 뒤에는 답을 바꿀 수 없다', () => {
    const active = { status: 'active' as const, startedAt: 0 };
    expect(getAnswerBlocker(session, active, response, MINUTE)).toBeNull();
    expect(getAnswerBlocker(session, active, { confirmedAt: 5 }, MINUTE)).toMatch(/확정/);
    expect(getAnswerBlocker(session, active, response, 12 * MINUTE)).toMatch(/제한 시간/);
  });
});

describe('시작과 마감', () => {
  it('총괄 운영자가 열기 전에는 시작할 수 없고, 한 번 시작하면 다시 시작할 수 없다', () => {
    const ready = { status: 'ready' as const };
    expect(getFinalStartBlocker(emptyFinalSession(3), ready)).toMatch(/총괄 선생님/);
    expect(getFinalStartBlocker(session, ready)).toBeNull();
    expect(getFinalStartBlocker(session, { status: 'active' })).toMatch(/다시 시작할 수 없어요/);
  });

  it('개방 조건: 5라운드 종료, 결과 확정, 카드 선택 완료', () => {
    expect(
      getFinalOpenBlockers({ roundsClosed: true, missingResults: 0, pendingAwards: 0 }),
    ).toEqual([]);
    expect(
      getFinalOpenBlockers({ roundsClosed: false, missingResults: 2, pendingAwards: 1 }),
    ).toHaveLength(3);
  });

  it('소요 시간은 서버 시각의 제출 시각에서 시작 시각을 뺀 값이다', () => {
    const state = {
      ...emptyFinalClassState('c1', 3, 0),
      status: 'active' as const,
      startedAt: 1000,
    };
    const done = finishFinal(session, state, 7, 1000 + 5 * MINUTE, 'completed');
    expect(done).toMatchObject({
      status: 'submitted',
      submittedAt: 1000 + 5 * MINUTE,
      durationMs: 5 * MINUTE,
      correctCount: 7,
    });
  });

  it('시간 마감은 제한 시간에 제출한 것으로 기록하고 미응답은 오답이다', () => {
    const state = { ...emptyFinalClassState('c1', 3, 0), status: 'active' as const, startedAt: 0 };
    const responses = set.questions.slice(0, 3).map((config) => ({
      questionId: config.question.id,
      selectedChoiceId: config.answerChoiceId,
    }));
    const correct = scoreResponses(set, [
      ...responses,
      { questionId: set.questions[3].question.id, selectedChoiceId: null },
    ]);
    expect(correct).toBe(3);
    const late = finishFinal(session, state, correct, 20 * MINUTE, 'timeout');
    expect(late).toMatchObject({ status: 'timeout', durationMs: 12 * MINUTE, correctCount: 3 });
  });

  it('제한 시간이 지나도 제출되지 않으면 제출 확인 필요로 표시한다', () => {
    const active = { status: 'active' as const, startedAt: 0 };
    const limit = session.durationLimitSec * 1000;
    expect(presentFinalClassStatus(session, active, limit)).toBe('active');
    expect(presentFinalClassStatus(session, active, limit + FINAL_REVIEW_GRACE_MS)).toBe(
      'review_required',
    );
    expect(
      presentFinalClassStatus(emptyFinalSession(3), { status: 'ready', startedAt: null }, 0),
    ).toBe('locked');
  });
});

describe('최종 순위', () => {
  it('정답 수 → 5종 완성 → 소요 시간 순서로 정한다', () => {
    const ranks = rankFinalClasses([
      finished('a', {
        correctCount: 8,
        allFiveCardsCompletedSnapshot: false,
        durationMs: 4 * MINUTE,
      }),
      finished('b', {
        correctCount: 9,
        allFiveCardsCompletedSnapshot: false,
        durationMs: 11 * MINUTE,
      }),
      finished('c', {
        correctCount: 8,
        allFiveCardsCompletedSnapshot: true,
        durationMs: 9 * MINUTE,
      }),
      finished('d', {
        correctCount: 8,
        allFiveCardsCompletedSnapshot: true,
        durationMs: 7 * MINUTE,
      }),
    ]);
    expect(Object.fromEntries(ranks)).toEqual({ b: 1, d: 2, c: 3, a: 4 });
  });

  it('5종을 완성하지 못한 학급끼리도 시간으로 가리고, 완성 3종·4종은 비교하지 않는다', () => {
    const ranks = rankFinalClasses([
      finished('a', {
        correctCount: 7,
        completedCardTypeCountSnapshot: 4,
        durationMs: 8 * MINUTE,
      }),
      finished('b', {
        correctCount: 7,
        completedCardTypeCountSnapshot: 3,
        durationMs: 6 * MINUTE,
      }),
    ]);
    expect(Object.fromEntries(ranks)).toEqual({ b: 1, a: 2 });
  });

  it('세 값이 모두 같으면 공동 순위이고, 제출하지 않은 학급은 순위가 없다', () => {
    const ranks = rankFinalClasses([
      finished('a', { correctCount: 6, durationMs: 5 * MINUTE }),
      finished('b', { correctCount: 6, durationMs: 5 * MINUTE }),
      finished('c', { correctCount: 5, durationMs: MINUTE }),
      { ...emptyFinalClassState('d', 3, 0), status: 'active' },
    ]);
    expect(Object.fromEntries(ranks)).toEqual({ a: 1, b: 1, c: 3 });
  });

  it('관리자가 직접 정한 순위는 자동 계산이 덮어쓰지 않는다', () => {
    const ranks = rankFinalClasses([
      finished('a', { correctCount: 9, durationMs: MINUTE }),
      finished('b', { correctCount: 5, durationMs: MINUTE, manualOverride: true, finalRank: 1 }),
    ]);
    expect(ranks.get('b')).toBe(1);
  });
});

describe('결과 공개와 관리자 보정', () => {
  it('결과를 공개하기 전에는 총괄 운영자만 점수와 순위를 본다', () => {
    const hidden = { status: 'results_hidden' as const };
    expect(canViewFinalResults(hidden, 'admin')).toBe(true);
    expect(canViewFinalResults(hidden, 'homeroom_teacher')).toBe(false);
    expect(canViewFinalResults(hidden, 'station_teacher')).toBe(false);
    expect(canViewFinalResults({ status: 'results_published' }, 'homeroom_teacher')).toBe(true);

    const state = finished('a', { correctCount: 9, finalRank: 1, durationMs: MINUTE });
    expect(redactFinalClassState(state, false)).toMatchObject({
      correctCount: null,
      finalRank: null,
      durationMs: MINUTE,
    });
  });

  it('수동 보정은 사유가 있어야 하고 값의 범위를 검사한다', () => {
    expect(getOverrideError({ reason: ' ' })).toMatch(/사유/);
    expect(getOverrideError({ reason: '네트워크 오류', correctCount: 11 })).toMatch(/0~10/);
    expect(getOverrideError({ reason: '네트워크 오류', durationMs: -1 })).not.toBeNull();
    expect(getOverrideError({ reason: '네트워크 오류', finalRank: 0 })).not.toBeNull();
    expect(getOverrideError({ reason: '네트워크 오류', correctCount: 8, finalRank: 2 })).toBeNull();
  });
});
