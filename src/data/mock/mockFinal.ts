import { ROUND_NUMBERS } from '../../domain/rotation';
import {
  applyHint,
  canViewFinalResults,
  emptyFinalClassState,
  emptyFinalResponse,
  emptyFinalSession,
  finalResponseId,
  finishFinal,
  getAnswerBlocker,
  getChoiceError,
  getFinalOpenBlockers,
  getFinalStartBlocker,
  getHintBlocker,
  getHintTotal,
  getOverrideError,
  getQuestionSetError,
  isFinalExpired,
  isFinalFinished,
  presentFinalClassStatus,
  rankFinalClasses,
  redactFinalClassState,
  scoreResponses,
  snapshotCards,
} from '../../domain/finalMission';
import type {
  ClassInfo,
  FinalClassState,
  FinalQuestionConfig,
  FinalQuestionSet,
  FinalResponse,
  FinalSession,
  Grade,
} from '../../domain/types';
import { formatClock } from '../../lib/time';
import { RepositoryError } from '../errors';
import type {
  AdjustFinalResultInput,
  ClassFinalView,
  FinalAdminActionInput,
  FinalBoard,
  FinalOpenChecklist,
  FinalQuestionActionInput,
  OpenFinalInput,
  SelectFinalChoiceInput,
  StartClassFinalInput,
} from '../EventRepository';
import { resultKey } from './keys';
import type { MockStoreContext } from './mockContext';

/** 학급 전체 최종 미션의 mock 구현 */
export class MockFinalStore {
  private readonly ctx: MockStoreContext;

  constructor(ctx: MockStoreContext) {
    this.ctx = ctx;
  }

  // ---- 읽기 도우미 ----

  sessionOf(grade: Grade): FinalSession {
    return this.ctx.state().finalSessions[grade] ?? emptyFinalSession(grade);
  }

  stateOf(classInfo: ClassInfo): FinalClassState {
    return (
      this.ctx.state().finalClassStates[classInfo.id] ??
      emptyFinalClassState(classInfo.id, classInfo.grade, 0)
    );
  }

  private questionSetOf(grade: Grade): FinalQuestionSet {
    const set = this.ctx.state().finalQuestionSets[grade];
    if (!set) throw new RepositoryError('not-found', '최종 미션 문제가 아직 준비되지 않았어요.');
    const error = getQuestionSetError(set, this.sessionOf(grade).questionCount);
    if (error) throw new RepositoryError('invalid-input', error);
    return set;
  }

  private responsesOf(classId: string): FinalResponse[] {
    return Object.values(this.ctx.state().finalResponses).filter(
      (response) => response.classId === classId,
    );
  }

  private viewerCanSeeResults(grade: Grade): boolean {
    return canViewFinalResults(this.sessionOf(grade), this.ctx.teacher()?.role ?? null);
  }

  checklist(grade: Grade): FinalOpenChecklist {
    const state = this.ctx.state();
    const roundsClosed = ROUND_NUMBERS.every((roundNo) => {
      const status = this.ctx.roundStatusOf(grade, roundNo);
      return status === 'scoring' || status === 'closed';
    });
    const missingResults = state.missions.reduce(
      (count, mission) =>
        count +
        ROUND_NUMBERS.filter((roundNo) => {
          const prefix = `${resultKey(mission.id, grade, roundNo)}__`;
          return !state.results.some((result) => result.id.startsWith(prefix));
        }).length,
      0,
    );
    const pendingAwards = state.cardAwards.filter(
      (award) => award.grade === grade && award.status === 'pending',
    ).length;
    const checklist = { roundsClosed, missingResults, pendingAwards };
    return { ...checklist, blockers: getFinalOpenBlockers(checklist) };
  }

  // ---- 학년 현황 ----

  board(grade: Grade): FinalBoard {
    this.ctx.requireTeacher();
    const session = this.sessionOf(grade);
    const canViewResults = this.viewerCanSeeResults(grade);
    const now = this.ctx.now();
    const classes = this.ctx.classesOf(grade);
    const states = classes.map((classInfo) => this.stateOf(classInfo));
    // 공개 전에도 총괄 운영자는 지금 기준 순위를 미리 본다.
    const ranks = rankFinalClasses(states);
    const rows = classes.map((classInfo, index) => {
      const state = states[index];
      const ranked = { ...state, finalRank: ranks.get(classInfo.id) ?? null };
      return {
        classInfo,
        state: redactFinalClassState(ranked, canViewResults),
        status: presentFinalClassStatus(session, state, now),
        confirmedCount: this.responsesOf(classInfo.id).filter(
          (response) => response.confirmedAt !== null,
        ).length,
        hintLeft: Math.max(0, state.hintTotal - state.hintUsed),
      };
    });
    if (canViewResults) {
      rows.sort(
        (a, b) =>
          (a.state.finalRank ?? Number.POSITIVE_INFINITY) -
            (b.state.finalRank ?? Number.POSITIVE_INFINITY) ||
          a.classInfo.classNo - b.classInfo.classNo,
      );
    }
    return {
      session,
      checklist: this.checklist(grade),
      rows,
      canViewResults,
      allFinished: states.length > 0 && states.every(isFinalFinished),
    };
  }

  open(input: OpenFinalInput): FinalSession {
    const admin = this.ctx.requireAdmin();
    const session = this.sessionOf(input.grade);
    // 다시 눌러도 처음 연 기록을 그대로 쓴다.
    if (session.status !== 'locked') return session;
    const { blockers } = this.checklist(input.grade);
    const reason = input.reason.trim();
    if (blockers.length > 0) {
      if (!input.force) throw new RepositoryError('not-allowed', blockers.join(' '));
      if (reason.length < 2) {
        throw new RepositoryError('invalid-input', '강제로 여는 사유를 2글자 이상 적어 주세요.');
      }
    }
    this.questionSetOf(input.grade);
    const now = this.ctx.now();
    const opened: FinalSession = {
      ...session,
      status: 'open',
      openedAt: now,
      openedBy: admin.uid,
      forceOpenReason: blockers.length > 0 ? reason : null,
    };
    this.ctx.state().finalSessions[input.grade] = opened;
    this.ctx.addActivity({
      id: `final_open__g${input.grade}`,
      grade: input.grade,
      type: 'final_opened',
      message:
        blockers.length > 0
          ? `${input.grade}학년 최종 미션 열림(강제: ${reason})`
          : `${input.grade}학년 최종 미션 열림`,
      classId: null,
      teamId: null,
      missionId: null,
      roundNo: null,
    });
    this.ctx.notifyFinal(input.grade);
    return opened;
  }

  setDuration(grade: Grade, durationLimitSec: number): FinalSession {
    this.ctx.requireAdmin();
    if (!Number.isInteger(durationLimitSec) || durationLimitSec < 60 || durationLimitSec > 3600) {
      throw new RepositoryError('invalid-input', '제한 시간은 1분에서 60분 사이로 정해 주세요.');
    }
    const started = this.ctx
      .classesOf(grade)
      .some((classInfo) => this.stateOf(classInfo).startedAt !== null);
    if (started) {
      throw new RepositoryError(
        'not-allowed',
        '이미 시작한 반이 있어 제한 시간을 바꿀 수 없어요. 같은 학년은 같은 시간을 써요.',
      );
    }
    const updated = { ...this.sessionOf(grade), durationLimitSec };
    this.ctx.state().finalSessions[grade] = updated;
    this.ctx.notifyFinal(grade);
    return updated;
  }

  publish(grade: Grade): FinalSession {
    this.ctx.requireAdmin();
    const session = this.sessionOf(grade);
    if (session.status === 'results_published' || session.status === 'closed') return session;
    const classes = this.ctx.classesOf(grade);
    const states = classes.map((classInfo) => this.stateOf(classInfo));
    if (states.length === 0 || !states.every(isFinalFinished)) {
      throw new RepositoryError(
        'not-allowed',
        '아직 제출하지 않은 반이 있어요. 모든 반이 제출한 뒤에 결과를 공개할 수 있어요.',
      );
    }
    this.storeRanks(grade);
    const now = this.ctx.now();
    const published: FinalSession = {
      ...session,
      status: 'results_published',
      resultsPublishedAt: now,
    };
    this.ctx.state().finalSessions[grade] = published;
    this.ctx.addActivity({
      id: `publish__g${grade}`,
      grade,
      type: 'results_published',
      message: `${grade}학년 최종 결과 공개`,
      classId: null,
      teamId: null,
      missionId: null,
      roundNo: null,
    });
    this.ctx.notifyFinal(grade);
    return published;
  }

  /** 제출을 마친 학급의 순위를 저장한다. 관리자가 직접 정한 순위는 그대로 둔다. */
  private storeRanks(grade: Grade): void {
    const states = this.ctx.classesOf(grade).map((classInfo) => this.stateOf(classInfo));
    const ranks = rankFinalClasses(states);
    for (const state of states) {
      if (!this.ctx.state().finalClassStates[state.classId]) continue;
      this.ctx.state().finalClassStates[state.classId] = {
        ...state,
        finalRank: ranks.get(state.classId) ?? null,
      };
    }
  }

  // ---- 학급 화면 ----

  classView(classId: string): ClassFinalView {
    this.ctx.requireTeacher();
    const classInfo = this.ctx.findClass(classId);
    // 제한 시간이 지난 채 열었으면 저장된 답안으로 마감한다.
    this.closeIfExpired(classInfo);
    const session = this.sessionOf(classInfo.grade);
    const state = this.stateOf(classInfo);
    const canViewResults = this.viewerCanSeeResults(classInfo.grade);
    const responses = this.responsesOf(classInfo.id);
    const config =
      state.status === 'active'
        ? this.questionSetOf(classInfo.grade).questions[state.currentQuestionIndex]
        : undefined;
    return {
      classInfo,
      session,
      state: redactFinalClassState(state, canViewResults),
      status: presentFinalClassStatus(session, state, this.ctx.now()),
      question: config?.question ?? null,
      response: config
        ? (responses.find((item) => item.questionId === config.question.id) ?? null)
        : null,
      confirmedCount: responses.filter((response) => response.confirmedAt !== null).length,
      canViewResults,
      canRunFinal: this.ctx.canRunClassFinal(classInfo.id),
    };
  }

  start(input: StartClassFinalInput): ClassFinalView {
    this.ctx.requireClassAccess(input.classId);
    const classInfo = this.ctx.findClass(input.classId);
    const state = this.stateOf(classInfo);
    // 새로고침·다른 기기·연타로 다시 시작해도 처음 시작 시각과 스냅샷을 유지한다.
    if (state.startedAt !== null) return this.classView(classInfo.id);

    const blocker = getFinalStartBlocker(this.sessionOf(classInfo.grade), state);
    if (blocker) throw new RepositoryError('not-allowed', blocker);
    this.questionSetOf(classInfo.grade);

    const now = this.ctx.now();
    const progress = this.ctx.classProgress(classInfo.id);
    this.ctx.state().finalClassStates[classInfo.id] = {
      ...emptyFinalClassState(classInfo.id, classInfo.grade, now),
      ...snapshotCards(progress),
      status: 'active',
      startedAt: now,
    };
    this.ctx.state().processedRequests[input.requestId] = classInfo.id;
    this.ctx.addActivity({
      id: `final_start__${classInfo.id}__${now}`,
      grade: classInfo.grade,
      type: 'final_started',
      message: `${classInfo.displayName} 최종 미션 시작(힌트 ${getHintTotal(progress)}개)`,
      classId: classInfo.id,
      teamId: null,
      missionId: null,
      roundNo: null,
    });
    this.ctx.notifyFinal(classInfo.grade);
    return this.classView(classInfo.id);
  }

  /** 진행 중인 학급, 현재 문제 설정, 그 문제의 응답을 함께 돌려준다. 시간이 끝났으면 마감하고 null */
  private activeQuestion(
    classId: string,
    questionId: string,
  ): {
    classInfo: ClassInfo;
    state: FinalClassState;
    config: FinalQuestionConfig;
    response: FinalResponse;
  } | null {
    this.ctx.requireClassAccess(classId);
    const classInfo = this.ctx.findClass(classId);
    if (this.closeIfExpired(classInfo)) return null;
    const state = this.stateOf(classInfo);
    if (state.status !== 'active') {
      throw new RepositoryError('not-allowed', '진행 중인 최종 미션이 아니에요.');
    }
    const config = this.questionSetOf(classInfo.grade).questions[state.currentQuestionIndex];
    if (!config || config.question.id !== questionId) {
      throw new RepositoryError(
        'not-allowed',
        '지금 푸는 문제가 아니에요. 화면을 새로고침해 주세요.',
      );
    }
    const response =
      this.ctx.state().finalResponses[finalResponseId(classId, questionId)] ??
      emptyFinalResponse(classId, classInfo.grade, questionId, this.ctx.now());
    return { classInfo, state, config, response };
  }

  select(input: SelectFinalChoiceInput): ClassFinalView {
    const current = this.activeQuestion(input.classId, input.questionId);
    if (!current) return this.classView(input.classId);
    const { classInfo, state, config, response } = current;
    const now = this.ctx.now();
    const blocker =
      getAnswerBlocker(this.sessionOf(classInfo.grade), state, response, now) ??
      getChoiceError(config, response, input.choiceId);
    if (blocker) throw new RepositoryError('not-allowed', blocker);
    this.ctx.state().finalResponses[response.id] = {
      ...response,
      selectedChoiceId: input.choiceId,
      updatedAt: now,
    };
    return this.classView(classInfo.id);
  }

  hint(input: FinalQuestionActionInput): ClassFinalView {
    const current = this.activeQuestion(input.classId, input.questionId);
    if (!current) return this.classView(input.classId);
    const { classInfo, state, config, response } = current;
    // 같은 요청을 다시 보낸 경우(연타·재시도)에는 두 번 차감하지 않는다.
    if (response.hintUsed && this.ctx.state().processedRequests[input.requestId] === response.id) {
      return this.classView(classInfo.id);
    }
    const now = this.ctx.now();
    const blocker =
      getAnswerBlocker(this.sessionOf(classInfo.grade), state, response, now) ??
      getHintBlocker(state, response);
    if (blocker) throw new RepositoryError('not-allowed', blocker);
    const next = applyHint(state, response, config, now);
    this.ctx.state().finalClassStates[classInfo.id] = next.state;
    this.ctx.state().finalResponses[response.id] = next.response;
    this.ctx.state().processedRequests[input.requestId] = response.id;
    this.ctx.notifyFinal(classInfo.grade);
    return this.classView(classInfo.id);
  }

  confirm(input: FinalQuestionActionInput): ClassFinalView {
    const classInfo = this.ctx.findClass(input.classId);
    const stored =
      this.ctx.state().finalResponses[finalResponseId(input.classId, input.questionId)];
    // 이미 확정한 문제를 같은 요청으로 다시 보내면 그대로 다음 화면을 돌려준다.
    if (
      stored?.confirmedAt != null &&
      this.ctx.state().processedRequests[input.requestId] === stored.id
    ) {
      this.ctx.requireClassAccess(input.classId);
      return this.classView(classInfo.id);
    }
    const current = this.activeQuestion(input.classId, input.questionId);
    if (!current) return this.classView(input.classId);
    const { state, response } = current;
    const session = this.sessionOf(classInfo.grade);
    const now = this.ctx.now();
    const blocker = getAnswerBlocker(session, state, response, now);
    if (blocker) throw new RepositoryError('not-allowed', blocker);
    if (response.selectedChoiceId === null) {
      throw new RepositoryError('invalid-input', '보기를 고른 뒤에 확정할 수 있어요.');
    }
    this.ctx.state().finalResponses[response.id] = {
      ...response,
      confirmedAt: now,
      updatedAt: now,
    };
    this.ctx.state().processedRequests[input.requestId] = response.id;
    const nextIndex = state.currentQuestionIndex + 1;
    const advanced = { ...state, currentQuestionIndex: nextIndex, updatedAt: now };
    this.ctx.state().finalClassStates[classInfo.id] = advanced;
    // 마지막 문제까지 확정하면 전체 답안을 제출한다.
    if (nextIndex >= session.questionCount) this.finish(classInfo, advanced, 'completed');
    this.ctx.notifyFinal(classInfo.grade);
    return this.classView(classInfo.id);
  }

  closeExpired(classId: string): ClassFinalView {
    this.ctx.requireClassAccess(classId);
    return this.classView(classId);
  }

  private closeIfExpired(classInfo: ClassInfo): boolean {
    const state = this.stateOf(classInfo);
    if (state.status !== 'active') return false;
    if (!isFinalExpired(this.sessionOf(classInfo.grade), state, this.ctx.now())) return false;
    this.finish(classInfo, state, 'timeout');
    this.ctx.notifyFinal(classInfo.grade);
    return true;
  }

  /** 저장된 답안으로 채점하고 마감한다. 고르지 않은 문제는 오답이다. */
  private finish(
    classInfo: ClassInfo,
    state: FinalClassState,
    reason: 'completed' | 'timeout',
  ): FinalClassState {
    const session = this.sessionOf(classInfo.grade);
    const correctCount = scoreResponses(
      this.questionSetOf(classInfo.grade),
      this.responsesOf(classInfo.id),
    );
    const finished = finishFinal(session, state, correctCount, this.ctx.now(), reason);
    this.ctx.state().finalClassStates[classInfo.id] = finished;
    this.ctx.addActivity({
      id: `final_submit__${classInfo.id}__${finished.startedAt}`,
      grade: classInfo.grade,
      type: 'final_submitted',
      // 점수는 공개 전이라 기록에 남기지 않는다.
      message: `${classInfo.displayName} 최종 미션 ${
        reason === 'timeout' ? '시간 마감' : '제출'
      }(${formatClock((finished.durationMs ?? 0) / 1000)})`,
      classId: classInfo.id,
      teamId: null,
      missionId: null,
      roundNo: null,
    });
    // 모든 반이 끝나면 결과 공개를 기다리는 상태가 된다.
    const allFinished = this.ctx
      .classesOf(classInfo.grade)
      .every((item) => isFinalFinished(this.stateOf(item)));
    if (allFinished && session.status === 'open') {
      this.ctx.state().finalSessions[classInfo.grade] = { ...session, status: 'results_hidden' };
    }
    return finished;
  }

  // ---- 총괄 운영자 복구 ----

  private requireReason(reason: string): string {
    const trimmed = reason.trim();
    if (trimmed.length < 2) {
      throw new RepositoryError('invalid-input', '수정 사유를 2글자 이상 적어 주세요.');
    }
    return trimmed;
  }

  forceClose(input: FinalAdminActionInput): FinalClassState {
    const admin = this.ctx.requireAdmin();
    const reason = this.requireReason(input.reason);
    const classInfo = this.ctx.findClass(input.classId);
    const state = this.stateOf(classInfo);
    if (isFinalFinished(state)) return state;
    const session = this.sessionOf(classInfo.grade);
    if (session.status === 'locked') {
      throw new RepositoryError('not-allowed', '아직 열지 않은 최종 미션이에요.');
    }
    const now = this.ctx.now();
    // 시작하지 못한 반은 0점·제한 시간 전체로 마감한다.
    const base =
      state.startedAt === null
        ? {
            ...emptyFinalClassState(classInfo.id, classInfo.grade, now),
            ...snapshotCards(this.ctx.classProgress(classInfo.id)),
            startedAt: now - session.durationLimitSec * 1000,
          }
        : state;
    const finished = this.finish(classInfo, { ...base, status: 'active' }, 'timeout');
    const recorded = {
      ...finished,
      manualOverride: true,
      overrideReason: reason,
      overrideBy: admin.uid,
    };
    this.ctx.state().finalClassStates[classInfo.id] = recorded;
    this.logManualFix(classInfo, `강제 마감(${reason})`);
    this.ctx.notifyFinal(classInfo.grade);
    return recorded;
  }

  adjust(input: AdjustFinalResultInput): FinalClassState {
    const admin = this.ctx.requireAdmin();
    const classInfo = this.ctx.findClass(input.classId);
    const session = this.sessionOf(classInfo.grade);
    const error = getOverrideError(input, session.questionCount);
    if (error) throw new RepositoryError('invalid-input', error);
    const state = this.stateOf(classInfo);
    if (!isFinalFinished(state)) {
      throw new RepositoryError('not-allowed', '제출을 마친 반의 결과만 고칠 수 있어요.');
    }
    const now = this.ctx.now();
    const adjusted: FinalClassState = {
      ...state,
      correctCount: input.correctCount ?? state.correctCount,
      durationMs: input.durationMs ?? state.durationMs,
      finalRank: input.finalRank,
      manualOverride: true,
      overrideReason: input.reason.trim(),
      overrideBy: admin.uid,
      updatedAt: now,
    };
    this.ctx.state().finalClassStates[classInfo.id] = adjusted;
    if (session.status === 'results_published') this.storeRanks(classInfo.grade);
    this.logManualFix(classInfo, `결과 보정(${input.reason.trim()})`);
    this.ctx.notifyFinal(classInfo.grade);
    return this.stateOf(classInfo);
  }

  reset(input: FinalAdminActionInput): FinalClassState {
    this.ctx.requireAdmin();
    const reason = this.requireReason(input.reason);
    const classInfo = this.ctx.findClass(input.classId);
    const state = this.ctx.state();
    for (const response of this.responsesOf(classInfo.id)) delete state.finalResponses[response.id];
    const fresh = emptyFinalClassState(classInfo.id, classInfo.grade, this.ctx.now());
    state.finalClassStates[classInfo.id] = fresh;
    // 결과 공개를 기다리던 중이었다면 다시 진행 중으로 돌린다.
    const session = this.sessionOf(classInfo.grade);
    if (session.status === 'results_hidden') {
      state.finalSessions[classInfo.grade] = { ...session, status: 'open' };
    }
    this.logManualFix(classInfo, `최종 미션 초기화(${reason})`);
    this.ctx.notifyFinal(classInfo.grade);
    return fresh;
  }

  private logManualFix(classInfo: ClassInfo, message: string): void {
    this.ctx.addActivity({
      id: `manual__${classInfo.id}__${this.ctx.now()}`,
      grade: classInfo.grade,
      type: 'manual_fix',
      message: `${classInfo.displayName} ${message}`,
      classId: classInfo.id,
      teamId: null,
      missionId: null,
      roundNo: null,
    });
  }
}
