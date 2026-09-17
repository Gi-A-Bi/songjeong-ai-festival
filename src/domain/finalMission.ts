import { FINAL_DEFAULT_DURATION_SEC, FINAL_MAX_HINTS, FINAL_QUESTION_COUNT } from '../config';
import type {
  ClassCardProgress,
  FinalClassState,
  FinalClassStatus,
  FinalQuestionConfig,
  FinalQuestionSet,
  FinalResponse,
  FinalSession,
  Grade,
  TeacherRole,
} from './types';

/** 제한 시간이 지난 뒤 자동 제출을 기다려 주는 시간. 넘으면 "제출 확인 필요"로 표시한다. */
export const FINAL_REVIEW_GRACE_MS = 20_000;

export function finalResponseId(classId: string, questionId: string): string {
  return `${classId}_${questionId}`;
}

export function emptyFinalSession(grade: Grade): FinalSession {
  return {
    grade,
    status: 'locked',
    questionCount: FINAL_QUESTION_COUNT,
    durationLimitSec: FINAL_DEFAULT_DURATION_SEC,
    openedAt: null,
    openedBy: null,
    forceOpenReason: null,
    resultsPublishedAt: null,
  };
}

export function emptyFinalClassState(classId: string, grade: Grade, now: number): FinalClassState {
  return {
    classId,
    grade,
    status: 'ready',
    currentQuestionIndex: 0,
    completedCardTypeCountSnapshot: 0,
    allFiveCardsCompletedSnapshot: false,
    hintTotal: 0,
    hintUsed: 0,
    startedAt: null,
    submittedAt: null,
    durationMs: null,
    correctCount: null,
    finalRank: null,
    manualOverride: false,
    overrideReason: null,
    overrideBy: null,
    updatedAt: now,
  };
}

export function emptyFinalResponse(
  classId: string,
  grade: Grade,
  questionId: string,
  now: number,
): FinalResponse {
  return {
    id: finalResponseId(classId, questionId),
    classId,
    grade,
    questionId,
    selectedChoiceId: null,
    hintUsed: false,
    removedChoiceId: null,
    confirmedAt: null,
    updatedAt: now,
  };
}

/** 완성 카드 종류 수 = 힌트 수(최대 5). 중복 조각은 힌트를 늘리지 않는다. */
export function getHintTotal(progress: Pick<ClassCardProgress, 'completedCount'>): number {
  return Math.max(0, Math.min(FINAL_MAX_HINTS, progress.completedCount));
}

/** 시작할 때 고정하는 카드 스냅샷. 이후 카드 데이터가 바뀌어도 진행 중 세션에는 반영하지 않는다. */
export function snapshotCards(
  progress: Pick<ClassCardProgress, 'completedCount' | 'allComplete'>,
): Pick<
  FinalClassState,
  'completedCardTypeCountSnapshot' | 'allFiveCardsCompletedSnapshot' | 'hintTotal'
> {
  return {
    completedCardTypeCountSnapshot: progress.completedCount,
    allFiveCardsCompletedSnapshot: progress.allComplete,
    hintTotal: getHintTotal(progress),
  };
}

/** 문제 설정 검사: 10문제, 4지선다, 힌트는 정답이 아닌 보기만 지운다. 문제가 없으면 null */
export function getQuestionSetError(
  set: Pick<FinalQuestionSet, 'questions'>,
  questionCount: number = FINAL_QUESTION_COUNT,
): string | null {
  if (set.questions.length !== questionCount) {
    return `최종 미션은 ${questionCount}문제여야 해요. (지금 ${set.questions.length}문제)`;
  }
  const ids = new Set<string>();
  for (const [index, config] of set.questions.entries()) {
    const label = `${index + 1}번 문제`;
    const choiceIds = config.question.choices.map((choice) => choice.id);
    if (ids.has(config.question.id)) return `${label}: 문제 ID가 겹쳐요.`;
    ids.add(config.question.id);
    if (choiceIds.length !== 4 || new Set(choiceIds).size !== 4) {
      return `${label}: 보기는 서로 다른 4개여야 해요.`;
    }
    if (!choiceIds.includes(config.answerChoiceId)) return `${label}: 정답이 보기에 없어요.`;
    if (!choiceIds.includes(config.hintRemoveChoiceId)) {
      return `${label}: 힌트로 지울 보기가 보기에 없어요.`;
    }
    if (config.hintRemoveChoiceId === config.answerChoiceId) {
      return `${label}: 힌트는 정답 보기를 지우면 안 돼요.`;
    }
  }
  return null;
}

export function getFinalDeadline(
  session: Pick<FinalSession, 'durationLimitSec'>,
  state: Pick<FinalClassState, 'startedAt'>,
): number | null {
  return state.startedAt === null ? null : state.startedAt + session.durationLimitSec * 1000;
}

export function isFinalExpired(
  session: Pick<FinalSession, 'durationLimitSec'>,
  state: Pick<FinalClassState, 'startedAt'>,
  now: number,
): boolean {
  const deadline = getFinalDeadline(session, state);
  return deadline !== null && now >= deadline;
}

/** 화면에 보이는 학급 상태. 잠김과 제출 확인 필요는 세션 상태와 시각으로 계산한다. */
export function presentFinalClassStatus(
  session: Pick<FinalSession, 'status' | 'durationLimitSec'>,
  state: Pick<FinalClassState, 'status' | 'startedAt'>,
  now: number,
): FinalClassStatus {
  if (state.status === 'submitted' || state.status === 'timeout') return state.status;
  if (state.status === 'active') {
    const deadline = getFinalDeadline(session, state);
    return deadline !== null && now >= deadline + FINAL_REVIEW_GRACE_MS
      ? 'review_required'
      : 'active';
  }
  return session.status === 'locked' ? 'locked' : 'ready';
}

export function isFinalFinished(state: Pick<FinalClassState, 'status'>): boolean {
  return state.status === 'submitted' || state.status === 'timeout';
}

/** 최종 미션을 열기 전에 확인할 것. 빈 배열이면 열 수 있다. */
export function getFinalOpenBlockers(checklist: {
  roundsClosed: boolean;
  missingResults: number;
  pendingAwards: number;
}): string[] {
  const blockers: string[] = [];
  if (!checklist.roundsClosed) blockers.push('5라운드가 아직 끝나지 않았어요.');
  if (checklist.missingResults > 0) {
    blockers.push(`결과를 확정하지 않은 미션이 ${checklist.missingResults}개 있어요.`);
  }
  if (checklist.pendingAwards > 0) {
    blockers.push(`아직 고르지 않은 카드 보상이 ${checklist.pendingAwards}개 있어요.`);
  }
  return blockers;
}

/** 학급이 최종 미션을 시작할 수 없는 이유. 시작할 수 있으면 null */
export function getFinalStartBlocker(
  session: Pick<FinalSession, 'status'>,
  state: Pick<FinalClassState, 'status'>,
): string | null {
  if (session.status === 'locked') return '총괄 선생님이 최종 미션을 열면 시작할 수 있어요.';
  if (session.status !== 'open') return '최종 미션이 이미 마감됐어요.';
  if (state.status !== 'ready') return '이미 시작한 최종 미션이에요. 다시 시작할 수 없어요.';
  return null;
}

/** 답을 고치거나 힌트를 쓸 수 없는 이유 */
export function getAnswerBlocker(
  session: Pick<FinalSession, 'durationLimitSec'>,
  state: Pick<FinalClassState, 'status' | 'startedAt'>,
  response: Pick<FinalResponse, 'confirmedAt'>,
  now: number,
): string | null {
  if (state.status !== 'active') return '진행 중인 최종 미션이 아니에요.';
  if (isFinalExpired(session, state, now)) return '제한 시간이 끝났어요.';
  if (response.confirmedAt !== null) return '이미 확정한 문제예요.';
  return null;
}

export function getHintBlocker(
  state: Pick<FinalClassState, 'hintTotal' | 'hintUsed'>,
  response: Pick<FinalResponse, 'hintUsed'>,
): string | null {
  if (response.hintUsed) return '이 문제에서는 이미 힌트를 썼어요.';
  if (state.hintUsed >= state.hintTotal) return '남은 힌트가 없어요.';
  return null;
}

/** 힌트 1개로 현재 문제의 오답 보기 하나를 지운다. 고른 보기가 지워지면 선택을 먼저 푼다. */
export function applyHint(
  state: FinalClassState,
  response: FinalResponse,
  config: Pick<FinalQuestionConfig, 'hintRemoveChoiceId'>,
  now: number,
): { state: FinalClassState; response: FinalResponse } {
  return {
    state: { ...state, hintUsed: state.hintUsed + 1, updatedAt: now },
    response: {
      ...response,
      hintUsed: true,
      removedChoiceId: config.hintRemoveChoiceId,
      selectedChoiceId:
        response.selectedChoiceId === config.hintRemoveChoiceId ? null : response.selectedChoiceId,
      updatedAt: now,
    },
  };
}

/** 보기를 고를 수 없는 이유(없는 보기, 힌트로 지운 보기) */
export function getChoiceError(
  config: Pick<FinalQuestionConfig, 'question'>,
  response: Pick<FinalResponse, 'removedChoiceId'>,
  choiceId: string,
): string | null {
  if (!config.question.choices.some((choice) => choice.id === choiceId)) {
    return '보기에 없는 답이에요.';
  }
  if (response.removedChoiceId === choiceId) return '힌트로 지운 보기는 고를 수 없어요.';
  return null;
}

/** 맞힌 문제 수. 고르지 않은 문제는 오답이다. */
export function scoreResponses(
  set: Pick<FinalQuestionSet, 'questions'>,
  responses: readonly Pick<FinalResponse, 'questionId' | 'selectedChoiceId'>[],
): number {
  return set.questions.filter((config) => {
    const response = responses.find((item) => item.questionId === config.question.id);
    return (
      response?.selectedChoiceId != null && response.selectedChoiceId === config.answerChoiceId
    );
  }).length;
}

/** 제출 마감. 시간 초과면 제한 시간에 제출한 것으로 기록한다. durationMs = submittedAt - startedAt */
export function finishFinal(
  session: Pick<FinalSession, 'durationLimitSec'>,
  state: FinalClassState,
  correctCount: number,
  now: number,
  reason: 'completed' | 'timeout',
): FinalClassState {
  const startedAt = state.startedAt ?? now;
  const deadline = startedAt + session.durationLimitSec * 1000;
  const submittedAt = reason === 'timeout' ? Math.min(now, deadline) : now;
  return {
    ...state,
    status: reason === 'timeout' ? 'timeout' : 'submitted',
    startedAt,
    submittedAt,
    durationMs: Math.max(0, submittedAt - startedAt),
    correctCount,
    updatedAt: now,
  };
}

type RankFields = Pick<
  FinalClassState,
  | 'classId'
  | 'status'
  | 'correctCount'
  | 'allFiveCardsCompletedSnapshot'
  | 'durationMs'
  | 'finalRank'
  | 'manualOverride'
>;

/** 정답 수 내림차순 → 5종 완성 우선 → 소요 시간 오름차순 */
export function compareFinalResults(a: RankFields, b: RankFields): number {
  return (
    (b.correctCount ?? 0) - (a.correctCount ?? 0) ||
    Number(b.allFiveCardsCompletedSnapshot) - Number(a.allFiveCardsCompletedSnapshot) ||
    (a.durationMs ?? Number.POSITIVE_INFINITY) - (b.durationMs ?? Number.POSITIVE_INFINITY)
  );
}

/**
 * 제출을 마친 학급의 순위. 세 값이 모두 같으면 공동 순위다.
 * 완성 카드가 3종인지 4종인지는 비교하지 않는다. 관리자가 직접 정한 순위는 그대로 쓴다.
 */
export function rankFinalClasses(states: readonly RankFields[]): Map<string, number> {
  const finished = states.filter(isFinalFinished).sort(compareFinalResults);
  const ranks = new Map<string, number>();
  finished.forEach((state, index) => {
    const previous = finished[index - 1];
    const tied = previous !== undefined && compareFinalResults(previous, state) === 0;
    ranks.set(state.classId, tied ? (ranks.get(previous.classId) ?? index + 1) : index + 1);
  });
  for (const state of finished) {
    if (state.manualOverride && state.finalRank !== null) {
      ranks.set(state.classId, state.finalRank);
    }
  }
  return ranks;
}

/** 점수와 순위는 총괄 운영자에게만, 그 밖에는 결과를 공개한 뒤에만 보여 준다. */
export function canViewFinalResults(
  session: Pick<FinalSession, 'status'>,
  role: TeacherRole | null,
): boolean {
  return role === 'admin' || session.status === 'results_published' || session.status === 'closed';
}

export function redactFinalClassState(state: FinalClassState, canView: boolean): FinalClassState {
  return canView ? state : { ...state, correctCount: null, finalRank: null };
}

/** 관리자 수동 보정 입력 검사. 사유는 꼭 적어야 한다. */
export function getOverrideError(
  input: {
    reason: string;
    correctCount?: number | null;
    durationMs?: number | null;
    finalRank?: number | null;
  },
  questionCount: number = FINAL_QUESTION_COUNT,
): string | null {
  if (input.reason.trim().length < 2) return '수정 사유를 2글자 이상 적어 주세요.';
  const { correctCount, durationMs, finalRank } = input;
  if (
    correctCount != null &&
    (!Number.isInteger(correctCount) || correctCount < 0 || correctCount > questionCount)
  ) {
    return `정답 수는 0~${questionCount} 사이 정수로 입력해 주세요.`;
  }
  if (durationMs != null && (!Number.isFinite(durationMs) || durationMs < 0)) {
    return '소요 시간은 0 이상으로 입력해 주세요.';
  }
  if (finalRank != null && (!Number.isInteger(finalRank) || finalRank < 1)) {
    return '순위는 1 이상의 정수로 입력해 주세요.';
  }
  return null;
}

export const FINAL_CLASS_STATUS_LABELS: Record<FinalClassStatus, string> = {
  locked: '열기 전',
  ready: '시작 대기',
  active: '풀이 중',
  submitted: '제출 완료',
  timeout: '시간 마감',
  review_required: '시간 초과·제출 확인 필요',
};
