import {
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import { ROUND_NUMBERS } from '../../domain/rotation';
import {
  applyHint,
  canViewFinalResults,
  emptyFinalClassState,
  emptyFinalResponse,
  getAnswerBlocker,
  getChoiceError,
  getFinalDeadline,
  getFinalOpenBlockers,
  getFinalStartBlocker,
  getHintBlocker,
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
  FinalQuestion,
  FinalQuestionSet,
  FinalResponse,
  FinalSession,
  Grade,
  RoundStatus,
} from '../../domain/types';
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
  Unsubscribe,
} from '../EventRepository';
import { createSampleFinalQuestionSet } from '../mock/finalQuestions';
import { isPermissionDenied, LiveGroup, type FirestoreStoreContext } from './firestoreContext';
import { LiveDoc, LiveQuery } from './liveQuery';
import { mapFinalClassState, mapFinalResponses, mapFinalSession } from './mappers';

/** 서버 시각과 기기 추정 시각의 차이를 감안해, 마감 기록은 제한 시간이 이만큼 지난 뒤에 보낸다. */
const CLOSE_MARGIN_MS = 1500;
const CHECKLIST_TTL_MS = 15_000;
const QUESTION_SET_TTL_MS = 5 * 60_000;

/** 담임교사 기기까지 내려가는 문제. 정답은 들어 있지 않다(정답 문서는 총괄 운영자만 읽는다). */
interface PublicQuestion extends FinalQuestion {
  hintRemoveChoiceId: string;
}

function sessionDocId(grade: Grade): string {
  return String(grade);
}

/** 학년 단위 구독: 세션 문서 하나와 학급 상태 문서(학년당 4~6개) */
class FinalGradeLive extends LiveGroup {
  readonly session: LiveDoc<DocumentData>;
  readonly states: LiveQuery<{ id: string; data: DocumentData }>;

  constructor(ctx: FirestoreStoreContext, eventId: string, grade: Grade, onIdle: () => void) {
    super(onIdle);
    const bump = () => this.notifier.bump();
    this.session = this.track(
      new LiveDoc(
        doc(ctx.sub(eventId, 'finalSessions'), sessionDocId(grade)),
        (_snapshot, data) => data,
        bump,
        () => undefined,
      ),
    );
    this.states = this.track(
      new LiveQuery(
        query(ctx.sub(eventId, 'finalClassStates'), where('grade', '==', grade)),
        (snapshot, data) => ({ id: snapshot.id, data }),
        bump,
        () => undefined,
      ),
    );
  }
}

/** 학급 단위 구독: 세션과 그 학급 상태만 지켜본다. 다른 반이 문제를 풀어도 다시 읽지 않는다. */
class FinalClassLive extends LiveGroup {
  constructor(ctx: FirestoreStoreContext, eventId: string, grade: Grade, classId: string) {
    super(() => undefined);
    const bump = () => this.notifier.bump();
    this.track(
      new LiveDoc(
        doc(ctx.sub(eventId, 'finalSessions'), sessionDocId(grade)),
        (_snapshot, data) => data,
        bump,
        () => undefined,
      ),
    );
    this.track(
      new LiveDoc(
        doc(ctx.sub(eventId, 'finalClassStates'), classId),
        (_snapshot, data) => data,
        bump,
        () => undefined,
      ),
    );
  }
}

/** 학급 전체 최종 미션의 Firestore 구현 */
export class FirestoreFinalStore {
  private readonly ctx: FirestoreStoreContext;
  private readonly gradeLives = new Map<string, FinalGradeLive>();
  private readonly classLives = new Set<FinalClassLive>();
  private readonly questionSets = new Map<string, { at: number; questions: PublicQuestion[] }>();
  private readonly checklists = new Map<string, { at: number; value: FinalOpenChecklist }>();
  /** 제출을 마친 학급의 채점 결과. 다시 시작하면 시작 시각이 달라져 새로 채점한다. */
  private readonly scores = new Map<string, number>();

  constructor(ctx: FirestoreStoreContext) {
    this.ctx = ctx;
  }

  // ---- 구독 ----

  private useGrade(eventId: string, grade: Grade): FinalGradeLive {
    const key = `${eventId}|${grade}`;
    let live = this.gradeLives.get(key);
    if (!live) {
      live = new FinalGradeLive(this.ctx, eventId, grade, () => this.gradeLives.delete(key));
      this.gradeLives.set(key, live);
    }
    live.touch();
    return live;
  }

  private async readyGrade(eventId: string, grade: Grade): Promise<FinalGradeLive> {
    await this.ctx.ensureUser();
    const live = this.useGrade(eventId, grade);
    try {
      await live.ready();
    } catch (error) {
      live.stop();
      throw error;
    }
    return live;
  }

  subscribe(
    eventId: string,
    grade: Grade,
    onChange: (revision: number) => void,
    onError: (error: unknown) => void,
    classId?: string,
  ): Unsubscribe {
    let stopped = false;
    let detach: () => void = () => undefined;
    void (async () => {
      await this.ctx.ensureUser();
      if (stopped) return;
      if (classId) {
        const live = new FinalClassLive(this.ctx, eventId, grade, classId);
        this.classLives.add(live);
        detach = () => {
          this.classLives.delete(live);
          live.stop();
        };
        await live.ready();
        if (stopped) return detach();
        live.notifier.add(onChange);
        onChange(live.notifier.current);
        return;
      }
      const live = await this.readyGrade(eventId, grade);
      if (stopped) return;
      const remove = live.notifier.add(onChange);
      live.touch();
      detach = () => {
        remove();
        live.touch();
      };
      onChange(live.notifier.current);
    })().catch(onError);
    return () => {
      stopped = true;
      detach();
    };
  }

  stopAll(): void {
    for (const live of [...this.gradeLives.values()]) live.stop();
    for (const live of [...this.classLives]) live.stop();
    this.classLives.clear();
  }

  // ---- 읽기 도우미 ----

  private sessionRef(eventId: string, grade: Grade) {
    return doc(this.ctx.sub(eventId, 'finalSessions'), sessionDocId(grade));
  }

  private stateRef(eventId: string, classId: string) {
    return doc(this.ctx.sub(eventId, 'finalClassStates'), classId);
  }

  private responsesRef(eventId: string, classId: string) {
    return doc(this.ctx.sub(eventId, 'finalResponses'), classId);
  }

  async sessionOf(eventId: string, grade: Grade): Promise<FinalSession> {
    const snapshot = await getDoc(this.sessionRef(eventId, grade));
    return mapFinalSession(grade, snapshot.data({ serverTimestamps: 'estimate' }));
  }

  async stateOf(eventId: string, classInfo: ClassInfo, session: FinalSession) {
    const snapshot = await getDoc(this.stateRef(eventId, classInfo.id));
    const data = snapshot.data({ serverTimestamps: 'estimate' });
    return data
      ? mapFinalClassState(classInfo.id, data, session.durationLimitSec)
      : emptyFinalClassState(classInfo.id, classInfo.grade, 0);
  }

  private async responsesOf(eventId: string, classInfo: ClassInfo) {
    const snapshot = await getDoc(this.responsesRef(eventId, classInfo.id));
    return mapFinalResponses(
      classInfo.id,
      classInfo.grade,
      snapshot.data({ serverTimestamps: 'estimate' }),
    );
  }

  /** 문제(정답 제외). 행사 중에는 바뀌지 않으므로 잠깐 메모리에 둔다. */
  private async questionsOf(
    eventId: string,
    grade: Grade,
    questionCount: number,
  ): Promise<PublicQuestion[]> {
    const key = `${eventId}|${grade}`;
    const cached = this.questionSets.get(key);
    if (cached && Date.now() - cached.at < QUESTION_SET_TTL_MS) return cached.questions;
    const snapshot = await getDoc(doc(this.ctx.sub(eventId, 'finalQuestionSets'), String(grade)));
    const raw = snapshot.data()?.questions;
    if (!Array.isArray(raw)) {
      throw new RepositoryError('not-found', '최종 미션 문제가 아직 준비되지 않았어요.');
    }
    const questions = raw.map((item: DocumentData): PublicQuestion => ({
      id: String(item.id),
      area: item.area,
      text: String(item.text ?? ''),
      passage: typeof item.passage === 'string' ? item.passage : null,
      choices: Array.isArray(item.choices)
        ? item.choices.map((choice: DocumentData) => ({
            id: String(choice.id),
            label: String(choice.label ?? ''),
          }))
        : [],
      hintRemoveChoiceId: String(item.hintRemoveChoiceId ?? ''),
    }));
    const error = this.publicSetError(questions, questionCount);
    if (error) throw new RepositoryError('invalid-input', error);
    this.questionSets.set(key, { at: Date.now(), questions });
    return questions;
  }

  /** 정답 없이 확인할 수 있는 문제 형식 검사 */
  private publicSetError(questions: readonly PublicQuestion[], questionCount: number) {
    if (questions.length !== questionCount) {
      return `최종 미션은 ${questionCount}문제여야 해요. (지금 ${questions.length}문제)`;
    }
    for (const [index, question] of questions.entries()) {
      const ids = question.choices.map((choice) => choice.id);
      if (ids.length !== 4 || new Set(ids).size !== 4) {
        return `${index + 1}번 문제: 보기는 서로 다른 4개여야 해요.`;
      }
      if (!ids.includes(question.hintRemoveChoiceId)) {
        return `${index + 1}번 문제: 힌트로 지울 보기가 보기에 없어요.`;
      }
    }
    return null;
  }

  private toQuestion(question: PublicQuestion): FinalQuestion {
    return {
      id: question.id,
      area: question.area,
      text: question.text,
      passage: question.passage,
      choices: question.choices,
    };
  }

  /** 정답까지 포함한 문제 묶음. 정답 문서는 총괄 운영자만 읽을 수 있다. */
  private async fullSetOf(
    eventId: string,
    grade: Grade,
    questionCount: number,
  ): Promise<FinalQuestionSet> {
    const [questions, keySnap] = await Promise.all([
      this.questionsOf(eventId, grade, questionCount),
      getDoc(doc(this.ctx.sub(eventId, 'finalAnswerKeys'), String(grade))),
    ]);
    const answers = (keySnap.data()?.answers ?? {}) as Record<string, unknown>;
    const set: FinalQuestionSet = {
      grade,
      questions: questions.map((question) => ({
        question: this.toQuestion(question),
        answerChoiceId: String(answers[question.id] ?? ''),
        hintRemoveChoiceId: question.hintRemoveChoiceId,
      })),
    };
    const error = getQuestionSetError(set, questionCount);
    if (error) throw new RepositoryError('invalid-input', error);
    return set;
  }

  /**
   * 문제가 아직 없으면 샘플 10문제로 만든다. 실제 문제는 행사 전에
   * finalQuestionSets/{학년}과 finalAnswerKeys/{학년} 문서를 고쳐 넣는다.
   */
  async ensureQuestionSet(eventId: string, grade: Grade): Promise<boolean> {
    const setRef = doc(this.ctx.sub(eventId, 'finalQuestionSets'), String(grade));
    const keyRef = doc(this.ctx.sub(eventId, 'finalAnswerKeys'), String(grade));
    const [setSnap, keySnap] = await Promise.all([getDoc(setRef), getDoc(keyRef)]);
    if (setSnap.exists() && keySnap.exists()) return false;
    const sample = createSampleFinalQuestionSet(grade);
    const batch = writeBatch(this.ctx.db);
    batch.set(setRef, {
      grade,
      questions: sample.questions.map((config) => ({
        ...config.question,
        hintRemoveChoiceId: config.hintRemoveChoiceId,
      })),
      updatedAt: serverTimestamp(),
    });
    batch.set(keyRef, {
      grade,
      answers: Object.fromEntries(
        sample.questions.map((config) => [config.question.id, config.answerChoiceId]),
      ),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    this.questionSets.delete(`${eventId}|${grade}`);
    return true;
  }

  private viewerCanSeeResults(session: FinalSession): boolean {
    return canViewFinalResults(session, this.ctx.teacher()?.role ?? null);
  }

  /** 모든 반이 끝났는데 아직 공개 전이면 "결과 공개 전" 상태로 보여 준다(저장하지 않고 계산). */
  private presentSession(session: FinalSession, states: readonly FinalClassState[]): FinalSession {
    if (session.status !== 'open') return session;
    const allFinished = states.length > 0 && states.every(isFinalFinished);
    return allFinished ? { ...session, status: 'results_hidden' } : session;
  }

  /**
   * 총괄 운영자용 채점. 점수는 결과를 공개할 때 학급 상태에 기록하며,
   * 그 전에는 총괄 운영자 기기에서만 계산해 보여 준다.
   */
  private async withScore(
    eventId: string,
    classInfo: ClassInfo,
    session: FinalSession,
    state: FinalClassState,
  ): Promise<FinalClassState> {
    if (!isFinalFinished(state) || state.correctCount !== null) return state;
    const key = `${eventId}|${state.classId}|${state.startedAt}|${state.status}`;
    let correct = this.scores.get(key);
    if (correct === undefined) {
      const [set, responses] = await Promise.all([
        this.fullSetOf(eventId, classInfo.grade, session.questionCount),
        this.responsesOf(eventId, classInfo),
      ]);
      correct = scoreResponses(
        set,
        responses.map((item) => item.response),
      );
      this.scores.set(key, correct);
    }
    return { ...state, correctCount: correct };
  }

  async checklist(eventId: string, grade: Grade): Promise<FinalOpenChecklist> {
    const key = `${eventId}|${grade}`;
    const cached = this.checklists.get(key);
    if (cached && Date.now() - cached.at < CHECKLIST_TTL_MS) return cached.value;
    const [rounds, missions, finalized, pending] = await Promise.all([
      getDocs(query(this.ctx.sub(eventId, 'rounds'), where('grade', '==', grade))),
      this.ctx.missions(eventId),
      // 개수만 필요하므로 집계 쿼리를 쓴다(문서를 하나씩 읽지 않는다).
      getCountFromServer(
        query(
          this.ctx.sub(eventId, 'missionStates'),
          where('grade', '==', grade),
          where('finalized', '==', true),
        ),
      ),
      getCountFromServer(
        query(
          this.ctx.sub(eventId, 'cardAwards'),
          where('grade', '==', grade),
          where('status', '==', 'pending'),
        ),
      ),
    ]);
    const closed = rounds.docs.filter((snapshot) => {
      const status = snapshot.data().status as RoundStatus | undefined;
      return status === 'scoring' || status === 'closed';
    }).length;
    const base = {
      roundsClosed: closed >= ROUND_NUMBERS.length,
      missingResults: Math.max(0, missions.length * ROUND_NUMBERS.length - finalized.data().count),
      pendingAwards: pending.data().count,
    };
    const value = { ...base, blockers: getFinalOpenBlockers(base) };
    this.checklists.set(key, { at: Date.now(), value });
    return value;
  }

  // ---- 학년 현황 ----

  async board(eventId: string, grade: Grade): Promise<FinalBoard> {
    const teacher = this.ctx.requireTeacher();
    const [live, classes] = await Promise.all([
      this.readyGrade(eventId, grade),
      this.ctx.classes(eventId, grade),
    ]);
    const stored = mapFinalSession(grade, live.session.value ?? undefined);
    const stateData = new Map(live.states.docs.map((item) => [item.id, item.data]));
    let states = classes.map((classInfo) => {
      const data = stateData.get(classInfo.id);
      return data
        ? mapFinalClassState(classInfo.id, data, stored.durationLimitSec)
        : emptyFinalClassState(classInfo.id, grade, 0);
    });
    const session = this.presentSession(stored, states);
    const canViewResults = this.viewerCanSeeResults(session);
    // 공개 전에도 총괄 운영자는 지금 기준 점수와 순위를 미리 본다.
    if (teacher.role === 'admin') {
      states = await Promise.all(
        states.map((state, index) => this.withScore(eventId, classes[index], session, state)),
      );
    }
    const ranks = rankFinalClasses(states);
    const now = this.ctx.serverNow();
    const rows = classes.map((classInfo, index) => {
      const state = states[index];
      const ranked = { ...state, finalRank: ranks.get(classInfo.id) ?? null };
      return {
        classInfo,
        state: redactFinalClassState(ranked, canViewResults),
        status: presentFinalClassStatus(session, state, now),
        confirmedCount: state.currentQuestionIndex,
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
    const checklist: FinalOpenChecklist =
      session.status === 'locked'
        ? await this.checklist(eventId, grade)
        : { roundsClosed: true, missingResults: 0, pendingAwards: 0, blockers: [] };
    return {
      session,
      checklist,
      rows,
      canViewResults,
      allFinished: states.length > 0 && states.every(isFinalFinished),
    };
  }

  async open(input: OpenFinalInput): Promise<FinalSession> {
    await this.ctx.ensureUser();
    const admin = this.ctx.requireAdmin();
    const current = await this.sessionOf(input.eventId, input.grade);
    // 다시 눌러도 처음 연 기록을 그대로 쓴다.
    if (current.status !== 'locked') return current;
    this.checklists.delete(`${input.eventId}|${input.grade}`);
    const { blockers } = await this.checklist(input.eventId, input.grade);
    const reason = input.reason.trim();
    if (blockers.length > 0) {
      if (!input.force) throw new RepositoryError('not-allowed', blockers.join(' '));
      if (reason.length < 2) {
        throw new RepositoryError('invalid-input', '강제로 여는 사유를 2글자 이상 적어 주세요.');
      }
    }
    await this.ensureQuestionSet(input.eventId, input.grade);
    await this.fullSetOf(input.eventId, input.grade, current.questionCount);

    const ref = this.sessionRef(input.eventId, input.grade);
    await runTransaction(this.ctx.db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (mapFinalSession(input.grade, snapshot.data()).status !== 'locked') return;
      transaction.set(
        ref,
        {
          grade: input.grade,
          status: 'open',
          questionCount: current.questionCount,
          durationLimitSec: current.durationLimitSec,
          openedAt: serverTimestamp(),
          openedBy: admin.uid,
          forceOpenReason: blockers.length > 0 ? reason : null,
          resultsPublishedAt: null,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    });
    await this.settle(input.eventId, input.grade, (session) => session.status !== 'locked');
    return this.sessionOf(input.eventId, input.grade);
  }

  async setDuration(eventId: string, grade: Grade, durationLimitSec: number) {
    await this.ctx.ensureUser();
    this.ctx.requireAdmin();
    if (!Number.isInteger(durationLimitSec) || durationLimitSec < 60 || durationLimitSec > 3600) {
      throw new RepositoryError('invalid-input', '제한 시간은 1분에서 60분 사이로 정해 주세요.');
    }
    const started = await getDocs(
      query(this.ctx.sub(eventId, 'finalClassStates'), where('grade', '==', grade)),
    );
    if (!started.empty) {
      throw new RepositoryError(
        'not-allowed',
        '이미 시작한 반이 있어 제한 시간을 바꿀 수 없어요. 같은 학년은 같은 시간을 써요.',
      );
    }
    const current = await this.sessionOf(eventId, grade);
    const batch = writeBatch(this.ctx.db);
    batch.set(
      this.sessionRef(eventId, grade),
      {
        grade,
        status: current.status,
        questionCount: current.questionCount,
        durationLimitSec,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    await batch.commit();
    await this.settle(eventId, grade, (session) => session.durationLimitSec === durationLimitSec);
    return this.sessionOf(eventId, grade);
  }

  /** 학년의 모든 학급 상태를 서버에서 새로 읽는다(결과 공개·보정처럼 정확해야 하는 일에 쓴다). */
  private async freshStates(eventId: string, grade: Grade, session: FinalSession) {
    const [classes, snapshot] = await Promise.all([
      this.ctx.classes(eventId, grade),
      getDocs(query(this.ctx.sub(eventId, 'finalClassStates'), where('grade', '==', grade))),
    ]);
    const byId = new Map(snapshot.docs.map((item) => [item.id, item.data()]));
    return classes.map((classInfo) => {
      const data = byId.get(classInfo.id);
      return {
        classInfo,
        exists: data !== undefined,
        state: data
          ? mapFinalClassState(classInfo.id, data, session.durationLimitSec)
          : emptyFinalClassState(classInfo.id, grade, 0),
      };
    });
  }

  /** 채점과 순위를 학급 상태에 기록한다. 관리자가 직접 정한 값은 그대로 둔다. */
  private async storeResults(
    eventId: string,
    grade: Grade,
    session: FinalSession,
    publish: boolean,
  ) {
    const entries = await this.freshStates(eventId, grade, session);
    if (
      publish &&
      (entries.length === 0 || !entries.every((entry) => isFinalFinished(entry.state)))
    ) {
      throw new RepositoryError(
        'not-allowed',
        '아직 제출하지 않은 반이 있어요. 모든 반이 제출한 뒤에 결과를 공개할 수 있어요.',
      );
    }
    const scored = await Promise.all(
      entries.map((entry) => this.withScore(eventId, entry.classInfo, session, entry.state)),
    );
    const ranks = rankFinalClasses(scored);
    const batch = writeBatch(this.ctx.db);
    scored.forEach((state, index) => {
      if (!entries[index].exists || !isFinalFinished(state)) return;
      batch.update(this.stateRef(eventId, state.classId), {
        correctCount: state.correctCount,
        durationMs: state.durationMs,
        finalRank: ranks.get(state.classId) ?? null,
        updatedAt: serverTimestamp(),
      });
    });
    if (publish) {
      batch.set(
        this.sessionRef(eventId, grade),
        {
          status: 'results_published',
          resultsPublishedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }
    await batch.commit();
  }

  async publish(eventId: string, grade: Grade): Promise<FinalSession> {
    await this.ctx.ensureUser();
    this.ctx.requireAdmin();
    const session = await this.sessionOf(eventId, grade);
    if (session.status === 'results_published' || session.status === 'closed') return session;
    if (session.status === 'locked') {
      throw new RepositoryError('not-allowed', '아직 열지 않은 최종 미션이에요.');
    }
    await this.storeResults(eventId, grade, session, true);
    await this.settle(eventId, grade, (next) => next.status === 'results_published');
    return this.sessionOf(eventId, grade);
  }

  /** 내 쓰기가 학년 구독 캐시에 반영될 때까지 잠깐 기다린다. */
  private async settle(
    eventId: string,
    grade: Grade,
    sessionReady: (session: FinalSession) => boolean,
  ): Promise<void> {
    const live = this.gradeLives.get(`${eventId}|${grade}`);
    if (!live) return;
    await live.waitFor(() => sessionReady(mapFinalSession(grade, live.session.value ?? undefined)));
  }

  private async settleState(
    eventId: string,
    grade: Grade,
    classId: string,
    stateReady: (data: DocumentData | undefined) => boolean,
  ): Promise<void> {
    const live = this.gradeLives.get(`${eventId}|${grade}`);
    if (!live) return;
    await live.waitFor(() =>
      stateReady(live.states.docs.find((item) => item.id === classId)?.data),
    );
  }

  // ---- 학급 화면 ----

  private buildView(
    classInfo: ClassInfo,
    session: FinalSession,
    state: FinalClassState,
    question: FinalQuestion | null,
    response: FinalResponse | null,
  ): ClassFinalView {
    const canViewResults = this.viewerCanSeeResults(session);
    return {
      classInfo,
      session,
      state: redactFinalClassState(state, canViewResults),
      status: presentFinalClassStatus(session, state, this.ctx.serverNow()),
      question: state.status === 'active' ? question : null,
      response: state.status === 'active' ? response : null,
      confirmedCount: state.currentQuestionIndex,
      canViewResults,
      canRunFinal: this.ctx.canRunClassFinal(classInfo.id),
    };
  }

  async classView(eventId: string, classId: string): Promise<ClassFinalView> {
    await this.ctx.ensureUser();
    const teacher = this.ctx.requireTeacher();
    const classInfo = await this.ctx.getClass(eventId, classId);
    const session = await this.sessionOf(eventId, classInfo.grade);
    let state = await this.stateOf(eventId, classInfo, session);

    // 제한 시간이 지난 채 열었으면 저장된 답안으로 마감한다(진행 권한이 있을 때만).
    if (
      state.status === 'active' &&
      this.ctx.canRunClassFinal(classId) &&
      isFinalExpired(session, state, this.ctx.serverNow() - CLOSE_MARGIN_MS)
    ) {
      state = await this.closeNow(eventId, classInfo, session).catch(() => state);
    }

    if (state.status !== 'active') {
      const shown =
        teacher.role === 'admin' ? await this.withScore(eventId, classInfo, session, state) : state;
      return this.buildView(classInfo, session, shown, null, null);
    }
    const [questions, responses] = await Promise.all([
      this.questionsOf(eventId, classInfo.grade, session.questionCount),
      this.responsesOf(eventId, classInfo),
    ]);
    const question = questions[state.currentQuestionIndex];
    const response = responses.find((item) => item.index === state.currentQuestionIndex);
    return this.buildView(
      classInfo,
      session,
      state,
      question ? this.toQuestion(question) : null,
      response?.response ?? null,
    );
  }

  async start(input: StartClassFinalInput): Promise<ClassFinalView> {
    await this.ctx.ensureUser();
    this.ctx.requireClassAccess(input.classId);
    const classInfo = await this.ctx.getClass(input.eventId, input.classId);
    const session = await this.sessionOf(input.eventId, classInfo.grade);
    const state = await this.stateOf(input.eventId, classInfo, session);
    // 새로고침·다른 기기·연타로 다시 시작해도 처음 시작 시각과 스냅샷을 유지한다.
    if (state.startedAt !== null) return this.classView(input.eventId, classInfo.id);

    const blocker = getFinalStartBlocker(session, state);
    if (blocker) throw new RepositoryError('not-allowed', blocker);
    await this.questionsOf(input.eventId, classInfo.grade, session.questionCount);
    const progress = await this.ctx.classProgress(input.eventId, classInfo.id);

    const ref = this.stateRef(input.eventId, classInfo.id);
    const attempt = runTransaction(this.ctx.db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists()) return;
      transaction.set(ref, {
        classId: classInfo.id,
        grade: classInfo.grade,
        status: 'active',
        currentQuestionIndex: 0,
        ...snapshotCards(progress),
        hintUsed: 0,
        // 시작 시각은 서버가 기록한다. 반마다 시작이 달라도 소요 시간을 같은 시계로 잰다.
        startedAt: serverTimestamp(),
        submittedAt: null,
        durationMs: null,
        correctCount: null,
        finalRank: null,
        manualOverride: false,
        overrideReason: null,
        overrideBy: null,
        // 보안 규칙이 세션 문서를 다시 읽지 않고도 마감 시각을 검사할 수 있게 함께 적어 둔다.
        questionCount: session.questionCount,
        durationLimitSec: session.durationLimitSec,
        startRequestId: input.requestId,
        updatedAt: serverTimestamp(),
      });
    });
    try {
      await attempt;
    } catch (error) {
      // 다른 기기가 거의 동시에 시작했다면 그 시작 기록을 그대로 쓴다.
      if (!isPermissionDenied(error)) throw error;
      const latest = await this.stateOf(input.eventId, classInfo, session);
      if (latest.startedAt === null) throw error;
    }
    return this.classView(input.eventId, classInfo.id);
  }

  /**
   * 진행 중인 학급의 현재 문제를 트랜잭션 안에서 읽고 바꾼다.
   * isRetry가 참이면 이미 처리한 요청을 다시 보낸 것이므로 아무것도 쓰지 않는다.
   */
  private async updateCurrent(
    input: { eventId: string; classId: string; questionId: string },
    isRetry: (stored: {
      response: FinalResponse;
      requestIds: { hint: string | null; confirm: string | null };
    }) => boolean,
    change: (current: {
      session: FinalSession;
      state: FinalClassState;
      question: PublicQuestion;
      response: FinalResponse;
      now: number;
    }) => { state?: Record<string, unknown>; answer: Record<string, unknown> },
  ): Promise<ClassFinalView> {
    await this.ctx.ensureUser();
    this.ctx.requireClassAccess(input.classId);
    const classInfo = await this.ctx.getClass(input.eventId, input.classId);
    const session = await this.sessionOf(input.eventId, classInfo.grade);
    const questions = await this.questionsOf(input.eventId, classInfo.grade, session.questionCount);
    const stateRef = this.stateRef(input.eventId, classInfo.id);
    const responsesRef = this.responsesRef(input.eventId, classInfo.id);

    const attempt = runTransaction(this.ctx.db, async (transaction) => {
      const [stateSnap, responsesSnap] = await Promise.all([
        transaction.get(stateRef),
        transaction.get(responsesRef),
      ]);
      const stored = mapFinalResponses(classInfo.id, classInfo.grade, responsesSnap.data());
      const target = stored.find((item) => item.response.questionId === input.questionId);
      if (target && isRetry(target)) return false;

      const stateData = stateSnap.data();
      if (!stateData) throw new RepositoryError('not-allowed', '진행 중인 최종 미션이 아니에요.');
      const state = mapFinalClassState(classInfo.id, stateData, session.durationLimitSec);
      if (state.status !== 'active') {
        throw new RepositoryError('not-allowed', '진행 중인 최종 미션이 아니에요.');
      }
      const now = this.ctx.serverNow();
      if (isFinalExpired(session, state, now)) return true;
      const index = state.currentQuestionIndex;
      const question = questions[index];
      if (!question || question.id !== input.questionId) {
        throw new RepositoryError(
          'not-allowed',
          '지금 푸는 문제가 아니에요. 화면을 새로고침해 주세요.',
        );
      }
      const outcome = change({
        session,
        state,
        question,
        response:
          target?.response ?? emptyFinalResponse(classInfo.id, classInfo.grade, question.id, now),
        now,
      });
      // 응답은 학급당 문서 하나에 문제 번호("0"~"9")별로 모은다. 보안 규칙은 지금 푸는 번호만
      // 바꿀 수 있게 해서, 확정한 답을 나중에 고치지 못하게 한다.
      const answerPatch = {
        answers: { [String(index)]: { ...outcome.answer, updatedAt: serverTimestamp() } },
        updatedAt: serverTimestamp(),
      };
      if (responsesSnap.exists()) {
        transaction.set(responsesRef, answerPatch, { merge: true });
      } else {
        transaction.set(responsesRef, {
          classId: classInfo.id,
          grade: classInfo.grade,
          ...answerPatch,
        });
      }
      if (outcome.state) {
        transaction.update(stateRef, { ...outcome.state, updatedAt: serverTimestamp() });
      }
      return false;
    });
    let expired = false;
    try {
      expired = await attempt;
    } catch (error) {
      // 같은 요청이 거의 동시에 두 번 들어와 먼저 처리된 경우에는 그 결과를 그대로 보여 준다.
      if (!isPermissionDenied(error)) throw error;
      const latest = (await this.responsesOf(input.eventId, classInfo)).find(
        (item) => item.response.questionId === input.questionId,
      );
      if (!latest || !isRetry(latest)) throw error;
    }

    // 제한 시간이 끝났으면 저장된 답안으로 마감한다.
    if (expired) await this.closeNow(input.eventId, classInfo, session).catch(() => undefined);
    return this.classView(input.eventId, classInfo.id);
  }

  private answerData(response: FinalResponse): Record<string, unknown> {
    return {
      questionId: response.questionId,
      selectedChoiceId: response.selectedChoiceId,
      hintUsed: response.hintUsed,
      removedChoiceId: response.removedChoiceId,
      confirmedAt: null,
    };
  }

  select(input: SelectFinalChoiceInput): Promise<ClassFinalView> {
    return this.updateCurrent(
      input,
      () => false,
      ({ session, state, question, response, now }) => {
        const blocker =
          getAnswerBlocker(session, state, response, now) ??
          getChoiceError({ question }, response, input.choiceId);
        if (blocker) throw new RepositoryError('not-allowed', blocker);
        return { answer: this.answerData({ ...response, selectedChoiceId: input.choiceId }) };
      },
    );
  }

  hint(input: FinalQuestionActionInput): Promise<ClassFinalView> {
    return this.updateCurrent(
      input,
      // 같은 요청을 다시 보낸 경우(연타·재시도)에는 두 번 차감하지 않는다.
      (stored) => stored.response.hintUsed && stored.requestIds.hint === input.requestId,
      ({ session, state, question, response, now }) => {
        const blocker =
          getAnswerBlocker(session, state, response, now) ?? getHintBlocker(state, response);
        if (blocker) throw new RepositoryError('not-allowed', blocker);
        const next = applyHint(state, response, question, now);
        return {
          state: { hintUsed: next.state.hintUsed },
          answer: { ...this.answerData(next.response), hintRequestId: input.requestId },
        };
      },
    );
  }

  confirm(input: FinalQuestionActionInput): Promise<ClassFinalView> {
    return this.updateCurrent(
      input,
      // 이미 확정한 문제를 같은 요청으로 다시 보내면 그대로 다음 화면을 돌려준다.
      (stored) =>
        stored.response.confirmedAt !== null && stored.requestIds.confirm === input.requestId,
      ({ session, state, response, now }) => {
        const blocker = getAnswerBlocker(session, state, response, now);
        if (blocker) throw new RepositoryError('not-allowed', blocker);
        if (response.selectedChoiceId === null) {
          throw new RepositoryError('invalid-input', '보기를 고른 뒤에 확정할 수 있어요.');
        }
        const nextIndex = state.currentQuestionIndex + 1;
        // 마지막 문제까지 확정하면 전체 답안을 제출한다. 제출 시각은 서버가 기록한다.
        const finished = nextIndex >= session.questionCount;
        return {
          state: {
            currentQuestionIndex: nextIndex,
            ...(finished ? { status: 'submitted', submittedAt: serverTimestamp() } : {}),
          },
          answer: {
            ...this.answerData(response),
            confirmedAt: serverTimestamp(),
            confirmRequestId: input.requestId,
          },
        };
      },
    );
  }

  /** 제한 시간이 끝난 학급을 저장된 답안으로 마감한다. 미응답은 채점할 때 오답이 된다. */
  private async closeNow(
    eventId: string,
    classInfo: ClassInfo,
    session: FinalSession,
  ): Promise<FinalClassState> {
    const ref = this.stateRef(eventId, classInfo.id);
    await runTransaction(this.ctx.db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      const data = snapshot.data();
      if (!data || data.status !== 'active') return;
      transaction.update(ref, {
        status: 'timeout',
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    return this.stateOf(eventId, classInfo, session);
  }

  async closeExpired(eventId: string, classId: string): Promise<ClassFinalView> {
    await this.ctx.ensureUser();
    this.ctx.requireClassAccess(classId);
    const classInfo = await this.ctx.getClass(eventId, classId);
    const session = await this.sessionOf(eventId, classInfo.grade);
    const state = await this.stateOf(eventId, classInfo, session);
    const deadline = getFinalDeadline(session, state);
    if (state.status === 'active' && deadline !== null) {
      // 서버 시각 기준으로 확실히 끝난 뒤에 마감을 기록한다(조금 이르면 잠깐 기다린다).
      const wait = deadline + CLOSE_MARGIN_MS - this.ctx.serverNow();
      if (wait <= 5000) {
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        await this.closeNow(eventId, classInfo, session);
      }
    }
    return this.classView(eventId, classId);
  }

  // ---- 총괄 운영자 복구 ----

  private requireReason(reason: string): string {
    const trimmed = reason.trim();
    if (trimmed.length < 2) {
      throw new RepositoryError('invalid-input', '수정 사유를 2글자 이상 적어 주세요.');
    }
    return trimmed;
  }

  async forceClose(input: FinalAdminActionInput): Promise<FinalClassState> {
    await this.ctx.ensureUser();
    const admin = this.ctx.requireAdmin();
    const reason = this.requireReason(input.reason);
    const classInfo = await this.ctx.getClass(input.eventId, input.classId);
    const session = await this.sessionOf(input.eventId, classInfo.grade);
    const state = await this.stateOf(input.eventId, classInfo, session);
    if (isFinalFinished(state)) return state;
    if (session.status === 'locked') {
      throw new RepositoryError('not-allowed', '아직 열지 않은 최종 미션이에요.');
    }
    const override = { manualOverride: true, overrideReason: reason, overrideBy: admin.uid };
    const ref = this.stateRef(input.eventId, classInfo.id);
    if (state.startedAt === null) {
      // 시작하지 못한 반은 0점·제한 시간 전체로 마감한다.
      const progress = await this.ctx.classProgress(input.eventId, classInfo.id);
      const batch = writeBatch(this.ctx.db);
      batch.set(ref, {
        classId: classInfo.id,
        grade: classInfo.grade,
        status: 'timeout',
        currentQuestionIndex: 0,
        ...snapshotCards(progress),
        hintUsed: 0,
        startedAt: Timestamp.fromMillis(this.ctx.serverNow() - session.durationLimitSec * 1000),
        submittedAt: serverTimestamp(),
        durationMs: session.durationLimitSec * 1000,
        correctCount: 0,
        finalRank: null,
        ...override,
        questionCount: session.questionCount,
        durationLimitSec: session.durationLimitSec,
        startRequestId: null,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    } else {
      const batch = writeBatch(this.ctx.db);
      batch.update(ref, {
        status: 'timeout',
        submittedAt: serverTimestamp(),
        ...override,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    }
    await this.settleState(
      input.eventId,
      classInfo.grade,
      classInfo.id,
      (data) => data?.status === 'timeout',
    );
    return this.withScore(
      input.eventId,
      classInfo,
      session,
      await this.stateOf(input.eventId, classInfo, session),
    );
  }

  async adjust(input: AdjustFinalResultInput): Promise<FinalClassState> {
    await this.ctx.ensureUser();
    const admin = this.ctx.requireAdmin();
    const classInfo = await this.ctx.getClass(input.eventId, input.classId);
    const session = await this.sessionOf(input.eventId, classInfo.grade);
    const error = getOverrideError(input, session.questionCount);
    if (error) throw new RepositoryError('invalid-input', error);
    const state = await this.stateOf(input.eventId, classInfo, session);
    if (!isFinalFinished(state)) {
      throw new RepositoryError('not-allowed', '제출을 마친 반의 결과만 고칠 수 있어요.');
    }
    const reason = input.reason.trim();
    const batch = writeBatch(this.ctx.db);
    batch.update(this.stateRef(input.eventId, classInfo.id), {
      ...(input.correctCount !== null ? { correctCount: input.correctCount } : {}),
      ...(input.durationMs !== null ? { durationMs: input.durationMs } : {}),
      finalRank: input.finalRank,
      manualOverride: true,
      overrideReason: reason,
      overrideBy: admin.uid,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    // 이미 공개한 결과를 고쳤으면 다른 반의 순위도 다시 계산해 기록한다.
    if (session.status === 'results_published') {
      await this.storeResults(input.eventId, classInfo.grade, session, false);
    }
    await this.settleState(
      input.eventId,
      classInfo.grade,
      classInfo.id,
      (data) => data?.overrideReason === reason,
    );
    return this.withScore(
      input.eventId,
      classInfo,
      session,
      await this.stateOf(input.eventId, classInfo, session),
    );
  }

  async reset(input: FinalAdminActionInput): Promise<FinalClassState> {
    await this.ctx.ensureUser();
    this.ctx.requireAdmin();
    this.requireReason(input.reason);
    const classInfo = await this.ctx.getClass(input.eventId, input.classId);
    const batch = writeBatch(this.ctx.db);
    batch.delete(this.stateRef(input.eventId, classInfo.id));
    batch.delete(this.responsesRef(input.eventId, classInfo.id));
    // 누가 왜 되돌렸는지는 세션 문서에 남긴다.
    batch.set(
      this.sessionRef(input.eventId, classInfo.grade),
      {
        lastReset: {
          classId: classInfo.id,
          reason: input.reason.trim(),
          by: this.ctx.teacher()?.uid ?? null,
          at: serverTimestamp(),
        },
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    await batch.commit();
    await this.settleState(
      input.eventId,
      classInfo.grade,
      classInfo.id,
      (data) => data === undefined,
    );
    return emptyFinalClassState(classInfo.id, classInfo.grade, this.ctx.serverNow());
  }
}
