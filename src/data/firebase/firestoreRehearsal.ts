import {
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Query,
} from 'firebase/firestore';
import type { RehearsalSummary } from '../../domain/rehearsal';
import type { Grade, Team } from '../../domain/types';
import type { FirestoreStoreContext } from './firestoreContext';
import { mapFinalSession } from './mappers';

/** 학년(grade)이 적혀 있어 학년으로 찾을 수 있는 기록 */
const GRADE_COLLECTIONS = [
  'submissions',
  'results',
  'cardAwards',
  'teamMissionStates',
  'missionRoundStates',
  'missionStates',
  'finalClassStates',
] as const;

/** 한 번에 지우는 문서 수(배치 한도 500 안쪽) */
const BATCH_SIZE = 200;
/** where in 조건에 넣을 수 있는 값의 수 */
const IN_LIMIT = 30;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const parts: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    parts.push(items.slice(index, index + size));
  }
  return parts;
}

/**
 * 연습(리허설)에서 남은 기록을 학년별로 세고 지운다. 총괄 운영자만 쓴다.
 * 행사 구조(학급·팀·미션), 미션 문제, 최종 미션 문제와 정답, 교사 계정은 건드리지 않는다.
 */
export class FirestoreRehearsalStore {
  private readonly ctx: FirestoreStoreContext;

  constructor(ctx: FirestoreStoreContext) {
    this.ctx = ctx;
  }

  private byGrade(eventId: string, name: string, grade: Grade): Query<DocumentData> {
    return query(this.ctx.sub(eventId, name), where('grade', '==', grade));
  }

  private sessionRef(eventId: string, grade: Grade) {
    return doc(this.ctx.sub(eventId, 'finalSessions'), String(grade));
  }

  /** 기기 세션에는 학년이 없어 팀 ID로 찾는다. */
  private deviceQueries(eventId: string, teams: readonly Team[]): Query<DocumentData>[] {
    return chunk(
      teams.map((team) => team.id),
      IN_LIMIT,
    ).map((teamIds) => query(this.ctx.sub(eventId, 'sessions'), where('teamId', 'in', teamIds)));
  }

  /** 개수만 필요하므로 집계 쿼리를 쓴다(문서를 하나씩 읽지 않는다). */
  async summary(eventId: string, grade: Grade): Promise<RehearsalSummary> {
    await this.ctx.ensureUser();
    this.ctx.requireAdmin();
    const teams = await this.ctx.teams(eventId, grade);
    const count = async (source: Query<DocumentData>) =>
      (await getCountFromServer(source)).data().count;
    const [
      submissions,
      results,
      cardAwards,
      checkIns,
      boothRounds,
      finalClasses,
      deviceCounts,
      session,
    ] = await Promise.all([
      count(this.byGrade(eventId, 'submissions', grade)),
      count(this.byGrade(eventId, 'results', grade)),
      count(this.byGrade(eventId, 'cardAwards', grade)),
      count(this.byGrade(eventId, 'teamMissionStates', grade)),
      count(this.byGrade(eventId, 'missionRoundStates', grade)),
      count(this.byGrade(eventId, 'finalClassStates', grade)),
      Promise.all(this.deviceQueries(eventId, teams).map(count)),
      getDoc(this.sessionRef(eventId, grade)),
    ]);
    return {
      grade,
      counts: {
        submissions,
        results,
        cardAwards,
        checkIns,
        boothRounds,
        finalClasses,
        devices: deviceCounts.reduce((sum, value) => sum + value, 0),
      },
      finalOpened: mapFinalSession(grade, session.data()).status !== 'locked',
    };
  }

  /** 한 학년의 제출·순위·카드·입장·부스 라운드·최종 미션 진행 기록과 팀에 묶인 기기를 지운다. */
  async reset(eventId: string, grade: Grade): Promise<void> {
    await this.ctx.ensureUser();
    const admin = this.ctx.requireAdmin();
    const [teams, classes] = await Promise.all([
      this.ctx.teams(eventId, grade),
      this.ctx.classes(eventId, grade),
    ]);
    const snapshots = await Promise.all([
      ...GRADE_COLLECTIONS.map((name) => getDocs(this.byGrade(eventId, name, grade))),
      ...this.deviceQueries(eventId, teams).map((source) => getDocs(source)),
    ]);
    const refs: DocumentReference<DocumentData>[] = snapshots.flatMap((snapshot) =>
      snapshot.docs.map((item) => item.ref),
    );
    // 학년이 적혀 있지 않은 문서는 팀·학급 ID로 찾는다. 없는 문서를 지워도 오류가 아니다.
    for (const team of teams) refs.push(doc(this.ctx.sub(eventId, 'drawingSubmissions'), team.id));
    for (const classInfo of classes) {
      refs.push(doc(this.ctx.sub(eventId, 'finalResponses'), classInfo.id));
    }

    for (const part of chunk(refs, BATCH_SIZE)) {
      const batch = writeBatch(this.ctx.db);
      for (const ref of part) batch.delete(ref);
      await batch.commit();
    }

    // 최종 미션은 총괄이 정한 제한 시간을 남기고 열기 전으로 되돌린다.
    const sessionRef = this.sessionRef(eventId, grade);
    if ((await getDoc(sessionRef)).exists()) {
      await setDoc(
        sessionRef,
        {
          status: 'locked',
          openedAt: null,
          openedBy: null,
          forceOpenReason: null,
          resultsPublishedAt: null,
          lastReset: { scope: 'grade', by: admin.uid, at: serverTimestamp() },
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }
  }
}
