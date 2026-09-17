import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  Bytes,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  CardAwardError,
  claimCardAward as applyCardClaim,
  computeClassCardProgress,
  createCardAward,
  reofferCardAward,
} from '../../domain/cards';
import {
  canViewFinalResults,
  getFinalStartBlocker,
  getHintTotal,
  presentFinalClassStatus,
  redactFinalClassState,
} from '../../domain/finalMission';
import { getGoldenBellConfigError } from '../../domain/goldenBell';
import { getSubmissionBlocker } from '../../domain/missionPhase';
import { getRankingEntryError } from '../../domain/rewards';
import { missionRoundStateId, teamMissionStateId } from '../../domain/tour';
import { getRoundForMission, getTeamNoForMission, ROUND_NUMBERS } from '../../domain/rotation';
import { resolveSubmissionScore } from '../../domain/scoring';
import type {
  CardAward,
  ClassCardProgress,
  ClassInfo,
  DrawingFile,
  FestivalEvent,
  FinalClassState,
  FinalSession,
  Grade,
  Mission,
  MissionConfig,
  MissionResult,
  MissionRoundState,
  RoundNo,
  RoundStatus,
  Submission,
  Team,
  TeacherProfile,
  TeamMissionState,
} from '../../domain/types';
import { toDeviceCode } from '../../domain/device';
import type {
  AdjustFinalResultInput,
  CardAwardView,
  CheckInInput,
  CheckInOutcome,
  ClaimCardAwardInput,
  ClaimCardAwardOutcome,
  ClassCardBoard,
  ClassFinalView,
  ClassOpsDetail,
  DeviceInfo,
  EventRepository,
  EventSetupSummary,
  FinalAdminActionInput,
  FinalBoard,
  FinalizeRankingInput,
  FinalizeRankingOutcome,
  FinalQuestionActionInput,
  MarkArrivedInput,
  MissionLiveState,
  MissionParticipant,
  MissionProgress,
  OpenFinalInput,
  OpsDashboard,
  ReopenSubmissionInput,
  ReviseRankingOutcome,
  RoundControlAction,
  SaveSubmissionInput,
  SelectFinalChoiceInput,
  StartClassFinalInput,
  StartStationInput,
  StationArrivals,
  TeacherClassCards,
  TeamDevice,
  TeamMissionView,
  TeamRewardView,
  TeamSession,
  TeamTourStatus,
  Unsubscribe,
} from '../EventRepository';
import { RepositoryError } from '../errors';
// 샘플 행사 구조는 mock과 Firestore가 같은 정의를 쓴다.
import { buildSampleEvent } from '../mock/seed';
import { getFirebase } from './firebaseApp';
import type { FirestoreStoreContext } from './firestoreContext';
import { FirestoreFinalStore } from './firestoreFinal';
import { FirestoreStationStore } from './firestoreStation';
import { FirestoreTourStore } from './firestoreTour';
import {
  isCompleteSubmission,
  mapCardAward,
  mapClass,
  mapDrawingFile,
  mapEvent,
  mapMission,
  mapResult,
  mapSubmission,
  mapTeam,
  toMillis,
} from './mappers';

/** 미션·팀별 고정 제출 ID */
function submissionId(missionId: string, teamId: string): string {
  return `${missionId}__${teamId}`;
}

/** 한 학년·라운드·미션의 순위 묶음 키. 보안 규칙도 같은 규칙으로 문서 ID를 확인한다. */
function resultKey(missionId: string, grade: Grade, roundNo: RoundNo): string {
  return `${missionId}__g${grade}__r${roundNo}`;
}

function resultId(missionId: string, grade: Grade, roundNo: RoundNo, teamId: string): string {
  return `${resultKey(missionId, grade, roundNo)}__${teamId}`;
}

function roundId(grade: Grade, roundNo: RoundNo): string {
  return `g${grade}-r${roundNo}`;
}

/** Firestore 오류를 화면에 보여 줄 수 있는 한국어 오류로 바꾼다. */
function toRepositoryError(error: unknown): RepositoryError {
  if (error instanceof RepositoryError) return error;
  const code = (error as { code?: string } | null)?.code ?? '';
  if (code === 'permission-denied') {
    return new RepositoryError('not-allowed', '권한이 없어요. 선생님께 알려 주세요.');
  }
  if (code === 'not-found') return new RepositoryError('not-found');
  if (code === 'unavailable' || code === 'deadline-exceeded') {
    return new RepositoryError('unavailable');
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return new RepositoryError('not-allowed', '로그인 창이 닫혔어요. 다시 시도해 주세요.');
  }
  return new RepositoryError('unavailable');
}

/** 미션·학급·팀 목록처럼 행사 중에 거의 바뀌지 않는 자료를 메모리에 두는 시간 */
const STATIC_TTL_MS = 10 * 60_000;

interface Cached<T> {
  at: number;
  value: Promise<T>;
}

async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw toRepositoryError(error);
  }
}

/**
 * Cloud Firestore 구현.
 * 학생은 익명 로그인, 교사는 Google 로그인을 쓰고, 권한은 보안 규칙이 최종 판단한다.
 */
export class FirestoreEventRepository implements EventRepository {
  readonly mode = 'firebase' as const;
  readonly capabilities = { liveOps: true, classFinal: true };

  private readonly db: Firestore;
  private authReady: Promise<void> | null = null;
  private teacher: TeacherProfile | null = null;
  private readonly tour: FirestoreTourStore;
  private readonly final: FirestoreFinalStore;
  private readonly station: FirestoreStationStore;
  private readonly staticCache = new Map<string, Cached<unknown>>();
  /** 구독 중인 행사 상태. 대시보드·체크인이 행사 문서를 다시 읽지 않게 한다. */
  private readonly liveEvents = new Map<string, { count: number; event: FestivalEvent | null }>();
  private clockOffsetMs = 0;
  private clockSync: Promise<void> | null = null;

  constructor() {
    this.db = getFirebase().db;
    const context = this.createContext();
    this.tour = new FirestoreTourStore(context);
    this.final = new FirestoreFinalStore(context);
    this.station = new FirestoreStationStore(context);
  }

  /** 서버 기준 현재 시각 추정값. 기기 시계가 틀려도 타이머와 마감 판정이 서버 시각을 따른다. */
  serverNow(): number {
    return Date.now() + this.clockOffsetMs;
  }

  /**
   * 기기 시계와 서버 시계의 차이를 한 번 잰다(쓰기 1회 + 읽기 1회).
   * 자기 문서에 서버 시각을 기록하고 되읽어, 요청을 보낸 시각과 받은 시각의 가운데와 비교한다.
   */
  private syncClock(eventId: string): Promise<void> {
    this.clockSync ??= (async () => {
      const user = await this.ensureUser();
      const ref = doc(this.sub(eventId, 'clockSync'), user.uid);
      const sentAt = Date.now();
      await setDoc(ref, { at: serverTimestamp() });
      const receivedAt = Date.now();
      const serverAt = toMillis((await getDocFromServer(ref)).data()?.at);
      if (serverAt !== null) this.clockOffsetMs = serverAt - (sentAt + receivedAt) / 2;
    })().catch(() => {
      // 실패하면 기기 시계를 그대로 쓰고, 다음 기회에 다시 잰다.
      this.clockSync = null;
    });
    return this.clockSync;
  }

  // ---- 기능별 모듈이 함께 쓰는 통로 ----

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.staticCache.get(key) as Cached<T> | undefined;
    if (hit && Date.now() - hit.at < STATIC_TTL_MS) return hit.value;
    const value = load();
    this.staticCache.set(key, { at: Date.now(), value });
    // 실패한 읽기는 기억하지 않는다.
    value.catch(() => this.staticCache.delete(key));
    return value;
  }

  private createContext(): FirestoreStoreContext {
    return {
      db: this.db,
      sub: (eventId, name) => this.sub(eventId, name),
      eventRef: (eventId) => this.eventRef(eventId),
      ensureUser: () => this.ensureUser(),
      serverNow: () => this.serverNow(),
      teacher: () => this.teacher,
      requireTeacher: () => this.requireTeacher(),
      requireAdmin: () => this.requireAdmin(),
      requireStationAccess: (missionId) => this.requireStationAccess(missionId),
      requireClassAccess: (classId) => this.requireClassAccess(classId),
      canRunClassFinal: (classId) => this.canRunClassFinal(classId),
      currentEvent: async (eventId) => {
        const live = this.liveEvents.get(eventId)?.event;
        if (live) return live;
        return mapEvent(await getDoc(this.eventRef(eventId)));
      },
      missions: (eventId) => this.cached(`missions|${eventId}`, () => this.listMissions(eventId)),
      classes: (eventId, grade) =>
        this.cached(`classes|${eventId}|${grade}`, () => this.listClasses(eventId, grade)),
      teams: (eventId, grade) =>
        this.cached(`teams|${eventId}|${grade}`, () => this.listTeams(eventId, grade)),
      getClass: (eventId, classId) =>
        this.cached(`class|${eventId}|${classId}`, () => this.getClass(eventId, classId)),
      getTeam: (eventId, teamId) =>
        this.cached(`team|${eventId}|${teamId}`, () => this.getTeam(eventId, teamId)),
      classAwards: (eventId, classId) => this.classAwards(eventId, classId),
      classProgress: (eventId, classId) => this.classProgress(eventId, classId),
    };
  }

  // ---- 경로 ----

  private eventRef(eventId: string) {
    return doc(this.db, 'events', eventId);
  }

  private sub(eventId: string, name: string) {
    return collection(this.db, 'events', eventId, name);
  }

  // ---- 인증 ----

  /** 로그인 상태가 정해질 때까지 기다리고, 학생이면 익명 로그인을 만든다. */
  private async ensureUser(): Promise<User> {
    const { auth } = getFirebase();
    if (!this.authReady) {
      this.authReady = new Promise<void>((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, () => {
          unsubscribe();
          resolve();
        });
      });
    }
    await this.authReady;
    if (!auth.currentUser) await signInAnonymously(auth);
    const user = auth.currentUser;
    if (!user) throw new RepositoryError('not-allowed', '로그인을 만들지 못했어요.');
    return user;
  }

  private async loadTeacherProfile(uid: string): Promise<TeacherProfile | null> {
    const snapshot = await getDoc(doc(this.db, 'teachers', uid));
    const data = snapshot.data();
    if (!data || data.active !== true) return null;
    // 예전 역할값 teacher는 담당이 정해지지 않은 부스 교사로 읽는다.
    const role =
      data.role === 'admin' || data.role === 'homeroom_teacher' ? data.role : 'station_teacher';
    return {
      uid,
      displayName: String(data.displayName ?? '선생님'),
      role,
      missionId: typeof data.missionId === 'string' ? data.missionId : null,
      classId: typeof data.classId === 'string' ? data.classId : null,
    };
  }

  getCurrentTeacher(): TeacherProfile | null {
    return this.teacher ? { ...this.teacher } : null;
  }

  /** 새로고침 뒤 남아 있는 로그인으로 교사 자격을 다시 확인한다. */
  async restoreTeacher(): Promise<TeacherProfile | null> {
    return run(async () => {
      const { auth } = getFirebase();
      if (!this.authReady) {
        this.authReady = new Promise<void>((resolve) => {
          const unsubscribe = onAuthStateChanged(auth, () => {
            unsubscribe();
            resolve();
          });
        });
      }
      await this.authReady;
      const user = auth.currentUser;
      if (!user || user.isAnonymous) {
        this.teacher = null;
        return null;
      }
      this.teacher = await this.loadTeacherProfile(user.uid);
      return this.getCurrentTeacher();
    });
  }

  async signInTeacher(): Promise<TeacherProfile> {
    return run(async () => {
      const { auth } = getFirebase();
      const credential = await signInWithPopup(auth, new GoogleAuthProvider());
      const profile = await this.loadTeacherProfile(credential.user.uid);
      if (!profile) {
        await signOut(auth);
        this.teacher = null;
        throw new RepositoryError(
          'not-allowed',
          '등록된 교사 계정이 아니에요. 관리자에게 계정 등록을 요청해 주세요.',
        );
      }
      this.teacher = profile;
      return { ...profile };
    });
  }

  async signOutTeacher(): Promise<void> {
    this.teacher = null;
    // 교사 권한으로 붙인 구독은 로그아웃하면 거부되므로 먼저 끊는다.
    this.tour.stopAll();
    this.final.stopAll();
    this.station.stopAll();
    await signOut(getFirebase().auth);
  }

  private requireTeacher(): TeacherProfile {
    if (!this.teacher) throw new RepositoryError('not-allowed', '교사로 로그인해야 할 수 있어요.');
    return this.teacher;
  }

  private requireAdmin(): TeacherProfile {
    const teacher = this.requireTeacher();
    if (teacher.role !== 'admin') {
      throw new RepositoryError('not-allowed', '총괄 선생님만 할 수 있어요.');
    }
    return teacher;
  }

  /** 총괄 운영자 또는 그 미션 담당(담당이 정해지지 않은 부스 교사 포함) */
  private requireStationAccess(missionId: string): TeacherProfile {
    const teacher = this.requireTeacher();
    const allowed =
      teacher.role === 'admin' ||
      (teacher.role === 'station_teacher' &&
        (teacher.missionId === null || teacher.missionId === missionId));
    if (!allowed) throw new RepositoryError('not-allowed', '담당 미션만 운영할 수 있어요.');
    return teacher;
  }

  private canRunClassFinal(classId: string): boolean {
    const teacher = this.teacher;
    if (!teacher) return false;
    return (
      teacher.role === 'admin' ||
      (teacher.role === 'homeroom_teacher' && teacher.classId === classId)
    );
  }

  /** 총괄 운영자 또는 그 학급 담임 */
  private requireClassAccess(classId: string): TeacherProfile {
    const teacher = this.requireTeacher();
    if (!this.canRunClassFinal(classId)) {
      throw new RepositoryError('not-allowed', '담당 학급의 최종 미션만 진행할 수 있어요.');
    }
    return teacher;
  }

  // ---- 행사 준비 ----

  /** 행사·학급·팀·미션 문서를 한 번에 만든다(126개 문서, 배치 한도 안). */
  async setupEvent(eventId: string): Promise<EventSetupSummary> {
    return run(async () => {
      await this.ensureUser();
      if (!this.teacher)
        throw new RepositoryError('not-allowed', '교사로 로그인해야 할 수 있어요.');

      const existing = await getDoc(this.eventRef(eventId));
      if (existing.exists()) {
        await this.ensureFinalQuestionSets(eventId);
        const [classes, teams, missions] = await Promise.all([
          getDocs(this.sub(eventId, 'classes')),
          getDocs(this.sub(eventId, 'teams')),
          getDocs(this.sub(eventId, 'missions')),
        ]);
        return {
          created: false,
          classes: classes.size,
          teams: teams.size,
          missions: missions.size,
        };
      }

      const structure = buildSampleEvent(eventId, Date.now());
      const batch = writeBatch(this.db);
      batch.set(this.eventRef(eventId), {
        title: structure.event.title,
        schoolName: structure.event.schoolName,
        status: 'ready',
        activeGrade: null,
        activeRound: 0,
        roundEndsAt: null,
        pausedRemainingMs: null,
        roundDurationMs: structure.event.roundDurationMs,
        moveDurationMs: structure.event.moveDurationMs,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      for (const classInfo of structure.classes) {
        batch.set(doc(this.sub(eventId, 'classes'), classInfo.id), {
          grade: classInfo.grade,
          classNo: classInfo.classNo,
          displayName: classInfo.displayName,
          status: classInfo.status,
        });
      }
      for (const team of structure.teams) {
        batch.set(doc(this.sub(eventId, 'teams'), team.id), {
          classId: team.classId,
          grade: team.grade,
          classNo: team.classNo,
          teamNo: team.teamNo,
          displayName: team.displayName,
          status: team.status,
          lockedSessionUid: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      for (const mission of structure.missions) {
        batch.set(doc(this.sub(eventId, 'missions'), mission.id), {
          no: mission.no,
          type: mission.type,
          title: mission.title,
          room: mission.room,
          cardType: mission.cardType,
          summary: mission.summary,
          teacherJudged: mission.teacherJudged,
          enabled: mission.enabled,
          config: mission.config,
        });
      }
      await batch.commit();
      this.staticCache.clear();
      await this.ensureFinalQuestionSets(eventId);

      return {
        created: true,
        classes: structure.classes.length,
        teams: structure.teams.length,
        missions: structure.missions.length,
      };
    });
  }

  /** 최종 미션 문제가 없는 학년에 샘플 10문제를 넣는다(정답은 총괄 운영자만 읽는 문서에 따로 둔다). */
  private async ensureFinalQuestionSets(eventId: string): Promise<void> {
    if (this.teacher?.role !== 'admin') return;
    for (const grade of [3, 4, 5, 6] as const) {
      await this.final.ensureQuestionSet(eventId, grade);
    }
  }

  // ---- 행사 상태 ----

  async getEvent(eventId: string): Promise<FestivalEvent> {
    return run(async () => {
      await this.ensureUser();
      return mapEvent(await getDoc(this.eventRef(eventId)));
    });
  }

  subscribeEvent(
    eventId: string,
    onChange: (event: FestivalEvent) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    let stopped = false;
    let detach: Unsubscribe = () => undefined;
    const entry = this.liveEvents.get(eventId) ?? { count: 0, event: null };
    entry.count += 1;
    this.liveEvents.set(eventId, entry);

    void this.ensureUser()
      .then(() => {
        if (stopped) return;
        void this.syncClock(eventId);
        // 진행 상태는 작은 문서 하나만 실시간 구독한다(무료 사용량 보호).
        detach = onSnapshot(
          this.eventRef(eventId),
          (snapshot) => {
            try {
              const event = mapEvent(snapshot);
              entry.event = event;
              onChange(event);
            } catch (error) {
              onError(toRepositoryError(error));
            }
          },
          (error) => onError(toRepositoryError(error)),
        );
      })
      .catch((error: unknown) => onError(toRepositoryError(error)));

    return () => {
      if (stopped) return;
      stopped = true;
      detach();
      entry.count -= 1;
      if (entry.count <= 0) this.liveEvents.delete(eventId);
    };
  }

  async controlRound(eventId: string, action: RoundControlAction): Promise<FestivalEvent> {
    return run(async () => {
      await this.ensureUser();
      this.requireAdmin();
      await this.syncClock(eventId);
      const eventRef = this.eventRef(eventId);
      await runTransaction(this.db, async (transaction) => {
        const snapshot = await transaction.get(eventRef);
        const event = mapEvent(snapshot);
        // 학생 기기의 타이머와 같은 시계(서버 시각 추정값)로 종료 시각을 정한다.
        const now = this.serverNow();
        if (event.activeGrade === null) {
          throw new RepositoryError('not-allowed', '먼저 진행할 학년을 골라 주세요.');
        }

        if (action === 'pause') {
          if (event.status !== 'active' || event.roundEndsAt === null) {
            throw new RepositoryError('not-allowed', '진행 중인 라운드만 일시정지할 수 있어요.');
          }
          transaction.update(eventRef, {
            status: 'paused',
            pausedRemainingMs: Math.max(0, event.roundEndsAt - now),
            roundEndsAt: null,
            updatedAt: serverTimestamp(),
          });
          return;
        }

        if (action === 'end') {
          if ((event.status !== 'active' && event.status !== 'paused') || event.activeRound === 0) {
            throw new RepositoryError('not-allowed', '진행 중인 라운드가 없어요.');
          }
          transaction.set(
            doc(this.sub(eventId, 'rounds'), roundId(event.activeGrade, event.activeRound)),
            {
              grade: event.activeGrade,
              roundNo: event.activeRound,
              status: 'scoring',
              endsAt: null,
            },
            { merge: true },
          );
          transaction.update(eventRef, {
            status: 'ready',
            roundEndsAt: null,
            pausedRemainingMs: null,
            roundEndedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          return;
        }

        if (event.status === 'active') return;

        if (event.status === 'paused') {
          transaction.update(eventRef, {
            status: 'active',
            roundEndsAt: new Date(now + (event.pausedRemainingMs ?? event.roundDurationMs)),
            pausedRemainingMs: null,
            updatedAt: serverTimestamp(),
          });
          return;
        }

        let nextRound = event.activeRound;
        const currentStatus =
          nextRound === 0
            ? null
            : (((
                await transaction.get(
                  doc(this.sub(eventId, 'rounds'), roundId(event.activeGrade, nextRound)),
                )
              ).data()?.status as RoundStatus | undefined) ?? 'waiting');
        if (nextRound === 0 || currentStatus === 'scoring' || currentStatus === 'closed') {
          if (nextRound === 5) throw new RepositoryError('not-allowed', '5라운드가 모두 끝났어요.');
          if (nextRound !== 0) {
            transaction.set(
              doc(this.sub(eventId, 'rounds'), roundId(event.activeGrade, nextRound)),
              { status: 'closed' },
              { merge: true },
            );
          }
          nextRound = (nextRound + 1) as RoundNo;
        }
        const endsAt = new Date(now + event.roundDurationMs);
        transaction.set(
          doc(this.sub(eventId, 'rounds'), roundId(event.activeGrade, nextRound)),
          {
            grade: event.activeGrade,
            roundNo: nextRound,
            status: 'active',
            startedAt: serverTimestamp(),
            endsAt,
          },
          { merge: true },
        );
        transaction.update(eventRef, {
          status: 'active',
          activeRound: nextRound,
          roundEndsAt: endsAt,
          pausedRemainingMs: null,
          roundEndedAt: null,
          updatedAt: serverTimestamp(),
        });
      });
      return this.getEvent(eventId);
    });
  }

  async setActiveGrade(eventId: string, grade: Grade): Promise<FestivalEvent> {
    return run(async () => {
      await this.ensureUser();
      this.requireAdmin();
      const event = await this.getEvent(eventId);
      if (event.status === 'active' || event.status === 'paused') {
        throw new RepositoryError('not-allowed', '라운드를 종료한 뒤 학년을 바꿀 수 있어요.');
      }
      let lastRound: 0 | RoundNo = 0;
      for (const value of ROUND_NUMBERS) {
        if ((await this.getRoundStatus(eventId, grade, value)) !== 'waiting') lastRound = value;
      }
      await updateDoc(this.eventRef(eventId), {
        activeGrade: grade,
        activeRound: lastRound,
        status: 'ready',
        roundEndsAt: null,
        pausedRemainingMs: null,
        roundEndedAt: null,
        updatedAt: serverTimestamp(),
      });
      return this.getEvent(eventId);
    });
  }

  async getRoundStatus(eventId: string, grade: Grade, roundNo: RoundNo): Promise<RoundStatus> {
    return run(async () => {
      await this.ensureUser();
      const snapshot = await getDoc(doc(this.sub(eventId, 'rounds'), roundId(grade, roundNo)));
      return (snapshot.data()?.status as RoundStatus | undefined) ?? 'waiting';
    });
  }

  // ---- 미션·학급·팀 ----

  private async fetchAll<T>(
    source: Query<DocumentData>,
    map: (snapshot: QueryDocumentSnapshot<DocumentData>) => T,
  ): Promise<T[]> {
    const snapshot = await getDocs(source);
    return snapshot.docs.map(map);
  }

  async listMissions(eventId: string): Promise<Mission[]> {
    return run(async () => {
      await this.ensureUser();
      const missions = await this.fetchAll(query(this.sub(eventId, 'missions')), mapMission);
      return missions.filter((mission) => mission.enabled).sort((a, b) => a.no - b.no);
    });
  }

  async getMission(eventId: string, missionId: string): Promise<Mission> {
    return run(async () => {
      await this.ensureUser();
      return mapMission(await getDoc(doc(this.sub(eventId, 'missions'), missionId)));
    });
  }

  async updateMissionConfig(
    eventId: string,
    missionId: string,
    config: MissionConfig,
  ): Promise<Mission> {
    return run(async () => {
      await this.ensureUser();
      this.requireStationAccess(missionId);
      const mission = await this.getMission(eventId, missionId);
      if (config.type !== mission.type) {
        throw new RepositoryError('invalid-input', '미션 종류와 설정 형식이 달라요.');
      }
      if (config.type === 'golden_bell') {
        const error = getGoldenBellConfigError(config.questions);
        if (error) throw new RepositoryError('invalid-input', error);
      }
      await updateDoc(doc(this.sub(eventId, 'missions'), missionId), { config });
      this.staticCache.delete(`missions|${eventId}`);
      return { ...mission, config };
    });
  }

  async listClasses(eventId: string, grade: Grade): Promise<ClassInfo[]> {
    return run(async () => {
      await this.ensureUser();
      const classes = await this.fetchAll(
        query(this.sub(eventId, 'classes'), where('grade', '==', grade)),
        mapClass,
      );
      return classes.sort((a, b) => a.classNo - b.classNo);
    });
  }

  async listTeams(eventId: string, grade: Grade): Promise<Team[]> {
    return run(async () => {
      await this.ensureUser();
      const teams = await this.fetchAll(
        query(this.sub(eventId, 'teams'), where('grade', '==', grade)),
        mapTeam,
      );
      return teams.sort((a, b) => a.classNo - b.classNo || a.teamNo - b.teamNo);
    });
  }

  async getTeam(eventId: string, teamId: string): Promise<Team> {
    return run(async () => {
      await this.ensureUser();
      return mapTeam(await getDoc(doc(this.sub(eventId, 'teams'), teamId)));
    });
  }

  /** 첫 입장 UID를 한 팀에 잠근다. 다른 팀으로는 바꿀 수 없다. */
  async joinTeam(eventId: string, teamId: string): Promise<TeamSession> {
    return run(async () => {
      const user = await this.ensureUser();
      const sessionRef = doc(this.sub(eventId, 'sessions'), user.uid);
      const existing = await getDoc(sessionRef);
      const existingTeamId = existing.data()?.teamId as string | undefined;
      if (existingTeamId && existingTeamId !== teamId) throw new RepositoryError('device-locked');
      if (!existing.exists()) {
        await setDoc(sessionRef, {
          uid: user.uid,
          teamId,
          createdAt: serverTimestamp(),
          lastSeenAt: serverTimestamp(),
        });
      } else {
        await updateDoc(sessionRef, { lastSeenAt: serverTimestamp() });
      }
      return { eventId, teamId, joinedAt: Date.now() };
    });
  }

  async getMyDevice(eventId: string): Promise<DeviceInfo> {
    return run(async () => {
      const user = await this.ensureUser();
      const session = await getDoc(doc(this.sub(eventId, 'sessions'), user.uid));
      const teamId = session.data()?.teamId as string | undefined;
      return {
        code: toDeviceCode(user.uid),
        team: teamId ? await this.getTeam(eventId, teamId) : null,
      };
    });
  }

  /** 필요할 때만 한 번 읽는다(구독하지 않는다). 학급의 다섯 팀에 묶인 세션만 가져온다. */
  async listClassDevices(eventId: string, classId: string): Promise<TeamDevice[]> {
    return run(async () => {
      await this.ensureUser();
      this.requireTeacher();
      const classInfo = await this.getClass(eventId, classId);
      const teams = (await this.listTeams(eventId, classInfo.grade)).filter(
        (team) => team.classId === classId,
      );
      if (teams.length === 0) return [];
      const snapshot = await getDocs(
        query(
          this.sub(eventId, 'sessions'),
          where(
            'teamId',
            'in',
            teams.map((team) => team.id),
          ),
        ),
      );
      const teamNoOf = (teamId: string) => teams.find((team) => team.id === teamId)?.teamNo ?? 0;
      return snapshot.docs
        .map((item): TeamDevice => {
          const data = item.data();
          return {
            id: item.id,
            teamId: String(data.teamId),
            code: toDeviceCode(item.id),
            joinedAt: toMillis(data.createdAt),
            lastSeenAt: toMillis(data.lastSeenAt),
          };
        })
        .sort(
          (a, b) =>
            teamNoOf(a.teamId) - teamNoOf(b.teamId) || (a.joinedAt ?? 0) - (b.joinedAt ?? 0),
        );
    });
  }

  async unlockDevice(eventId: string, deviceId: string): Promise<void> {
    return run(async () => {
      await this.ensureUser();
      this.requireTeacher();
      // 세션 문서만 지운다. 제출·카드·체크인 기록은 팀 단위라 그대로 남는다.
      await deleteDoc(doc(this.sub(eventId, 'sessions'), deviceId));
    });
  }

  // ---- 제출 ----

  async getTeamMissionView(
    eventId: string,
    teamId: string,
    missionId: string,
  ): Promise<TeamMissionView> {
    return run(async () => {
      await this.ensureUser();
      const [team, mission] = await Promise.all([
        this.getTeam(eventId, teamId),
        this.getMission(eventId, missionId),
      ]);
      const roundNo = getRoundForMission(team.teamNo, mission.no);
      const [roundStatus, submissionSnap, resultSnap, revealSnap] = await Promise.all([
        this.getRoundStatus(eventId, team.grade, roundNo),
        getDoc(doc(this.sub(eventId, 'submissions'), submissionId(mission.id, team.id))),
        getDoc(
          doc(this.sub(eventId, 'results'), resultId(mission.id, team.grade, roundNo, team.id)),
        ),
        getDoc(doc(this.sub(eventId, 'missionStates'), resultKey(mission.id, team.grade, roundNo))),
      ]);
      return {
        team,
        mission,
        roundNo,
        roundStatus,
        submission: isCompleteSubmission(submissionSnap.data())
          ? mapSubmission(submissionSnap)
          : null,
        finalized: resultSnap.exists(),
        answerRevealed: revealSnap.data()?.answerRevealed === true,
      };
    });
  }

  /** 미션·학년·라운드별 작은 상태 문서 하나만 실시간 구독한다. */
  subscribeMissionState(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
    onChange: (state: MissionLiveState) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    let stopped = false;
    let detach: Unsubscribe = () => undefined;
    void this.ensureUser()
      .then(() => {
        if (stopped) return;
        detach = onSnapshot(
          doc(this.sub(eventId, 'missionStates'), resultKey(missionId, grade, roundNo)),
          (snapshot) => {
            const data = snapshot.data();
            onChange({
              answerRevealed: data?.answerRevealed === true,
              finalized: data?.finalized === true,
              updatedAt: toMillis(data?.updatedAt) ?? 0,
            });
          },
          (error) => onError(toRepositoryError(error)),
        );
      })
      .catch((error: unknown) => onError(toRepositoryError(error)));
    return () => {
      stopped = true;
      detach();
    };
  }

  /** 학생 화면이 구독하는 미션 상태 문서의 참조와 바꿀 값(교사만 쓴다) */
  private missionStateWrite(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
    patch: Record<string, unknown> = {},
  ) {
    return {
      ref: doc(this.sub(eventId, 'missionStates'), resultKey(missionId, grade, roundNo)),
      data: { missionId, grade, roundNo, ...patch, updatedAt: serverTimestamp() },
    };
  }

  async listTeamSubmissions(eventId: string, teamId: string): Promise<Submission[]> {
    return run(async () => {
      await this.ensureUser();
      return this.fetchAll(
        query(this.sub(eventId, 'submissions'), where('teamId', '==', teamId)),
        mapSubmission,
      );
    });
  }

  async saveSubmission(input: SaveSubmissionInput): Promise<Submission> {
    return run(async () => {
      await this.ensureUser();
      const [team, mission] = await Promise.all([
        this.getTeam(input.eventId, input.teamId),
        this.getMission(input.eventId, input.missionId),
      ]);
      if (input.answer.type !== mission.type) {
        throw new RepositoryError('invalid-input', '미션 종류와 답안 형식이 달라요.');
      }
      if ((mission.type === 'drawing') !== (input.drawing !== undefined)) {
        throw new RepositoryError('invalid-input', '그림 파일이 없어요. 다시 제출해 주세요.');
      }
      const roundNo = getRoundForMission(team.teamNo, mission.no);
      const ref = doc(this.sub(input.eventId, 'submissions'), submissionId(mission.id, team.id));
      const eventRef = this.eventRef(input.eventId);
      const withScore = (submission: Submission): Submission => ({
        ...submission,
        score: resolveSubmissionScore(submission, mission),
      });

      /** 받을 수 있는 제출인지 확인한다. 같은 요청의 재시도면 true */
      const isRetry = (data: DocumentData | undefined, event: FestivalEvent): boolean => {
        const existing = isCompleteSubmission(data) ? data : undefined;
        if (existing && existing.status !== 'draft') {
          if (existing.requestId === input.requestId) return true;
          throw new RepositoryError(
            'not-allowed',
            '이미 제출했어요. 다시 내려면 선생님께 말해 주세요.',
          );
        }
        const blocker = getSubmissionBlocker({
          event,
          grade: team.grade,
          roundNo,
          reopened: existing?.status === 'draft' && existing.reopened === true,
        });
        if (blocker) throw new RepositoryError('not-allowed', blocker);
        return false;
      };

      const [currentSnap, eventSnap, resultSnap] = await Promise.all([
        getDoc(ref),
        getDoc(eventRef),
        getDoc(
          doc(
            this.sub(input.eventId, 'results'),
            resultId(mission.id, team.grade, roundNo, team.id),
          ),
        ),
      ]);
      if (isRetry(currentSnap.data(), mapEvent(eventSnap))) {
        return withScore(mapSubmission(currentSnap));
      }
      if (resultSnap.exists()) {
        throw new RepositoryError('not-allowed', '순위가 이미 확정되어 제출할 수 없어요.');
      }

      // 그림 파일을 먼저 저장한다. 제출 문서 저장이 실패하면 다시 눌렀을 때 덮어쓴다.
      if (input.drawing) {
        await setDoc(doc(this.sub(input.eventId, 'drawingSubmissions'), team.id), {
          teamId: team.id,
          missionId: mission.id,
          promptId: input.drawing.promptId,
          mimeType: input.drawing.mimeType,
          byteSize: input.drawing.bytes.length,
          width: input.drawing.width,
          height: input.drawing.height,
          imageBytes: Bytes.fromUint8Array(input.drawing.bytes),
          submittedAt: serverTimestamp(),
        });
      }

      await runTransaction(this.db, async (transaction) => {
        const existing = await transaction.get(ref);
        const latestEvent = await transaction.get(eventRef);
        if (isRetry(existing.data(), mapEvent(latestEvent))) return;
        transaction.set(ref, {
          teamId: team.id,
          classId: team.classId,
          missionId: mission.id,
          grade: team.grade,
          roundNo,
          status: 'submitted',
          answer: input.answer,
          score: null,
          reopened: false,
          requestId: input.requestId,
          submittedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      // 자동 채점 점수는 저장하지 않고 읽을 때 계산한다(학생은 점수를 쓸 수 없다).
      return withScore(mapSubmission(await getDoc(ref)));
    });
  }

  async getRoundProgress(
    eventId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): Promise<MissionProgress[]> {
    return run(async () => {
      await this.ensureUser();
      const [missions, classes, submissions, results] = await Promise.all([
        this.listMissions(eventId),
        this.listClasses(eventId, grade),
        this.fetchAll(
          query(
            this.sub(eventId, 'submissions'),
            where('grade', '==', grade),
            where('roundNo', '==', roundNo),
          ),
          mapSubmission,
        ),
        this.fetchAll(
          query(
            this.sub(eventId, 'results'),
            where('grade', '==', grade),
            where('roundNo', '==', roundNo),
          ),
          mapResult,
        ),
      ]);
      return missions.map((mission) => ({
        missionId: mission.id,
        submitted: submissions.filter(
          (item) => item.missionId === mission.id && item.status !== 'draft',
        ).length,
        total: classes.length,
        finalized: results.some((item) => item.missionId === mission.id),
      }));
    });
  }

  // ---- 교사 운영 ----

  async listMissionParticipants(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
    options: { fresh?: boolean } = {},
  ): Promise<MissionParticipant[]> {
    return run(async () => {
      await this.ensureUser();
      const mission = await this.getMission(eventId, missionId);
      const teamNo = getTeamNoForMission(mission.no, roundNo);
      const teams = (await this.listTeams(eventId, grade)).filter((team) => team.teamNo === teamNo);
      // 부스 제출을 구독 중이면 그 캐시로 만들고(읽기 없음), 아니면 한 번 읽는다.
      const cached = options.fresh
        ? null
        : await this.station.cachedSubmissions(eventId, missionId, grade, roundNo);
      const [submissions, results] = await Promise.all([
        cached ??
          this.fetchAll(
            query(
              this.sub(eventId, 'submissions'),
              where('grade', '==', grade),
              where('roundNo', '==', roundNo),
              where('missionId', '==', missionId),
            ),
            mapSubmission,
          ),
        this.fetchAll(
          query(
            this.sub(eventId, 'results'),
            where('missionId', '==', missionId),
            where('grade', '==', grade),
            where('roundNo', '==', roundNo),
          ),
          mapResult,
        ),
      ]);
      // 확정된 순위가 있을 때만 카드 보상을 읽는다(불필요한 읽기 방지).
      const awards = await this.awardsForResults(eventId, results);
      return teams.map((team) => {
        const submission = submissions.find((item) => item.teamId === team.id) ?? null;
        return {
          team,
          submission: submission
            ? { ...submission, score: resolveSubmissionScore(submission, mission) }
            : null,
          result: results.find((item) => item.teamId === team.id) ?? null,
          award: awards.find((item) => item.teamId === team.id) ?? null,
          movement: this.movementOf(
            team,
            missionId,
            roundNo,
            results.find((item) => item.teamId === team.id) ?? null,
          ),
        };
      });
    });
  }

  subscribeStationSubmissions(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
    onChange: (revision: number) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    return this.station.subscribe(eventId, missionId, grade, roundNo, onChange, (error) =>
      onError(toRepositoryError(error)),
    );
  }

  async setAnswerRevealed(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
    revealed: boolean,
  ): Promise<void> {
    return run(async () => {
      await this.ensureUser();
      this.requireStationAccess(missionId);
      const state = this.missionStateWrite(eventId, missionId, grade, roundNo, {
        answerRevealed: revealed,
      });
      await setDoc(state.ref, state.data, { merge: true });
    });
  }

  async isAnswerRevealed(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): Promise<boolean> {
    return run(async () => {
      await this.ensureUser();
      const snapshot = await getDoc(
        doc(this.sub(eventId, 'missionStates'), resultKey(missionId, grade, roundNo)),
      );
      return snapshot.data()?.answerRevealed === true;
    });
  }

  /** 순위 입력을 검사하고 입력 순서대로 참가 팀 정보를 돌려준다. */
  private async validateRankingEntries(input: FinalizeRankingInput): Promise<Team[]> {
    if (input.entries.length === 0) {
      throw new RepositoryError('invalid-input', '순위를 확정할 팀이 없어요.');
    }
    const mission = await this.getMission(input.eventId, input.missionId);
    const teamNo = getTeamNoForMission(mission.no, input.roundNo);
    const teams = await this.listTeams(input.eventId, input.grade);
    const seen = new Set<string>();
    return input.entries.map((entry) => {
      const team = teams.find((item) => item.id === entry.teamId);
      if (!team || team.teamNo !== teamNo) {
        throw new RepositoryError('invalid-input', '이 미션에 참가하지 않은 팀이 들어 있어요.');
      }
      if (seen.has(team.id)) {
        throw new RepositoryError('invalid-input', '같은 팀이 두 번 들어 있어요.');
      }
      seen.add(team.id);
      const error = getRankingEntryError(entry);
      if (error) throw new RepositoryError('invalid-input', error);
      return team;
    });
  }

  /** 카드 보상 문서 값. 시각은 서버 시각으로 기록한다. */
  private cardAwardData(award: CardAward) {
    return {
      resultId: award.resultId,
      grade: award.grade,
      classId: award.classId,
      teamId: award.teamId,
      missionId: award.missionId,
      roundNo: award.roundNo,
      rank: award.rank,
      selectionMode: award.selectionMode,
      offeredTypes: award.offeredTypes,
      selectedType: award.selectedType,
      status: award.status,
      createdAt: serverTimestamp(),
      claimedAt: award.status === 'claimed' ? serverTimestamp() : null,
    };
  }

  /**
   * 실제로 제출한 팀의 제출 문서 참조만 고른다.
   * 제출하지 않은 팀에 점수만 있는 빈 제출 문서를 만들지 않기 위해서다.
   */
  private async submittedRefsByTeam(eventId: string, missionId: string, teams: readonly Team[]) {
    const refs = teams.map((team) =>
      doc(this.sub(eventId, 'submissions'), submissionId(missionId, team.id)),
    );
    const snapshots = await Promise.all(refs.map((ref) => getDoc(ref)));
    const byTeam = new Map<string, (typeof refs)[number]>();
    snapshots.forEach((snapshot, index) => {
      const data = snapshot.data();
      if (isCompleteSubmission(data) && data.status !== 'draft') {
        byTeam.set(teams[index].id, refs[index]);
      }
    });
    return byTeam;
  }

  private async resultsOf(
    input: Pick<FinalizeRankingInput, 'eventId' | 'missionId' | 'grade' | 'roundNo'>,
  ) {
    return this.fetchAll(
      query(
        this.sub(input.eventId, 'results'),
        where('missionId', '==', input.missionId),
        where('grade', '==', input.grade),
        where('roundNo', '==', input.roundNo),
      ),
      mapResult,
    );
  }

  /**
   * 순위를 확정한 팀을 부스 문서에도 적는다. 대시보드는 이 작은 문서만 구독해
   * 팀의 완료 여부를 알 수 있어 결과 문서를 되풀이해 읽지 않는다. 원본은 여전히 results다.
   */
  private async boothResultWrite(
    input: Pick<FinalizeRankingInput, 'eventId' | 'missionId' | 'grade' | 'roundNo'>,
    teamIds: readonly string[],
    teacherUid: string,
  ) {
    const ref = doc(
      this.sub(input.eventId, 'missionRoundStates'),
      missionRoundStateId(input.missionId, input.grade, input.roundNo),
    );
    const existing = (await getDoc(ref)).data();
    const stored = Array.isArray(existing?.resultTeamIds) ? existing.resultTeamIds.map(String) : [];
    const upToDate =
      existing?.resultFinalizedAt != null &&
      stored.length === teamIds.length &&
      teamIds.every((teamId) => stored.includes(teamId));
    return {
      ref,
      upToDate,
      data: {
        grade: input.grade,
        missionId: input.missionId,
        roundNo: input.roundNo,
        status: 'completed',
        ...(existing ? {} : { startedAt: null }),
        // 처음 확정한 시각은 순위를 고쳐도 그대로 둔다.
        ...(existing?.resultFinalizedAt != null
          ? {}
          : { resultFinalizedAt: serverTimestamp(), completedAt: serverTimestamp() }),
        resultTeamIds: [...teamIds],
        updatedBy: teacherUid,
        updatedAt: serverTimestamp(),
      },
    };
  }

  /** 순위 확정과 카드 보상 생성을 한 번에 기록한다. 같은 묶음을 다시 확정해도 늘지 않는다. */
  async finalizeRanking(input: FinalizeRankingInput): Promise<FinalizeRankingOutcome> {
    return run(async () => {
      await this.ensureUser();
      const teacher = this.requireStationAccess(input.missionId);

      const existing = await this.resultsOf(input);
      if (existing.length > 0) {
        // 부스 문서가 없던 때 확정한 순위라면 지금 맞춰 둔다.
        const booth = await this.boothResultWrite(
          input,
          existing.map((result) => result.teamId),
          teacher.uid,
        );
        if (!booth.upToDate) await setDoc(booth.ref, booth.data, { merge: true });
        return {
          results: existing,
          awards: await this.awardsForResults(input.eventId, existing),
          alreadyFinalized: true,
        };
      }

      const teams = await this.validateRankingEntries(input);
      const submittedRefs = await this.submittedRefsByTeam(input.eventId, input.missionId, teams);
      const booth = await this.boothResultWrite(
        input,
        teams.map((team) => team.id),
        teacher.uid,
      );
      const batch = writeBatch(this.db);
      batch.set(booth.ref, booth.data, { merge: true });
      const results: MissionResult[] = [];
      const awards: CardAward[] = [];
      const now = Date.now();

      input.entries.forEach((entry, entryIndex) => {
        const team = teams[entryIndex];
        const id = resultId(input.missionId, input.grade, input.roundNo, team.id);
        batch.set(doc(this.sub(input.eventId, 'results'), id), {
          missionId: input.missionId,
          grade: input.grade,
          roundNo: input.roundNo,
          teamId: team.id,
          score: entry.score,
          rank: entry.rank,
          finalizedBy: teacher.uid,
          finalizedAt: serverTimestamp(),
        });
        const result: MissionResult = {
          id,
          missionId: input.missionId,
          grade: input.grade,
          roundNo: input.roundNo,
          teamId: team.id,
          score: entry.score,
          rank: entry.rank,
          finalizedBy: teacher.uid,
          finalizedAt: now,
        };
        results.push(result);

        // 결과 하나당 카드 보상 하나. 문서 ID를 결과 ID로 고정한다.
        const award = createCardAward({ result, team, now, random: Math.random });
        awards.push(award);
        batch.set(doc(this.sub(input.eventId, 'cardAwards'), id), this.cardAwardData(award));
        const submittedRef = submittedRefs.get(team.id);
        if (submittedRef) {
          batch.update(submittedRef, {
            score: entry.score,
            status: 'verified',
            updatedAt: serverTimestamp(),
          });
        }
      });
      const state = this.missionStateWrite(
        input.eventId,
        input.missionId,
        input.grade,
        input.roundNo,
        { finalized: true },
      );
      batch.set(state.ref, state.data, { merge: true });

      await batch.commit();
      return { results, awards, alreadyFinalized: false };
    });
  }

  async reviseRanking(input: FinalizeRankingInput): Promise<ReviseRankingOutcome> {
    return run(async () => {
      await this.ensureUser();
      const teacher = this.requireStationAccess(input.missionId);
      const existing = await this.resultsOf(input);
      if (existing.length === 0) {
        throw new RepositoryError(
          'not-allowed',
          '아직 확정하지 않은 순위예요. 먼저 순위를 확정해 주세요.',
        );
      }
      const teams = await this.validateRankingEntries(input);
      const submittedRefs = await this.submittedRefsByTeam(input.eventId, input.missionId, teams);
      const booth = await this.boothResultWrite(
        input,
        [...new Set([...existing.map((result) => result.teamId), ...teams.map((team) => team.id)])],
        teacher.uid,
      );

      const batch = writeBatch(this.db);
      batch.set(booth.ref, booth.data, { merge: true });
      const results: MissionResult[] = [];
      const awards: CardAward[] = [];
      const now = Date.now();
      let reoffered = 0;
      let keptClaimed = 0;

      for (const [entryIndex, entry] of input.entries.entries()) {
        const team = teams[entryIndex];
        const id = resultId(input.missionId, input.grade, input.roundNo, team.id);
        const previous = existing.find((item) => item.id === id);
        batch.set(
          doc(this.sub(input.eventId, 'results'), id),
          {
            missionId: input.missionId,
            grade: input.grade,
            roundNo: input.roundNo,
            teamId: team.id,
            score: entry.score,
            rank: entry.rank,
            finalizedBy: teacher.uid,
            ...(previous ? {} : { finalizedAt: serverTimestamp() }),
            revisedAt: serverTimestamp(),
          },
          { merge: true },
        );
        const result: MissionResult = {
          id,
          missionId: input.missionId,
          grade: input.grade,
          roundNo: input.roundNo,
          teamId: team.id,
          score: entry.score,
          rank: entry.rank,
          finalizedBy: teacher.uid,
          finalizedAt: previous?.finalizedAt ?? now,
        };
        results.push(result);

        // 고르기 전 보상만 새 순위에 맞추고, 이미 받은 보상은 그대로 둔다.
        const awardRef = doc(this.sub(input.eventId, 'cardAwards'), id);
        const awardSnapshot = await getDoc(awardRef);
        if (!awardSnapshot.exists()) {
          const created = createCardAward({ result, team, now, random: Math.random });
          awards.push(created);
          batch.set(awardRef, this.cardAwardData(created));
        } else {
          const current = mapCardAward(awardSnapshot);
          const next = reofferCardAward(current, entry.rank, now, Math.random);
          awards.push(next.award);
          if (next.changed) {
            batch.update(awardRef, {
              rank: next.award.rank,
              selectionMode: next.award.selectionMode,
              offeredTypes: next.award.offeredTypes,
              selectedType: next.award.selectedType,
              status: next.award.status,
              claimedAt:
                current.status === 'pending' && next.award.status === 'claimed'
                  ? serverTimestamp()
                  : (awardSnapshot.data().claimedAt ?? null),
            });
          }
          if (next.changed && current.status === 'pending') reoffered += 1;
          if (next.keptClaimed) keptClaimed += 1;
        }

        const submittedRef = submittedRefs.get(team.id);
        if (submittedRef) {
          batch.update(submittedRef, {
            score: entry.score,
            status: 'verified',
            updatedAt: serverTimestamp(),
          });
        }
      }
      const state = this.missionStateWrite(
        input.eventId,
        input.missionId,
        input.grade,
        input.roundNo,
        { finalized: true },
      );
      batch.set(state.ref, state.data, { merge: true });

      await batch.commit();
      return { results, awards, reoffered, keptClaimed };
    });
  }

  async reopenSubmission(input: ReopenSubmissionInput): Promise<void> {
    return run(async () => {
      await this.ensureUser();
      this.requireStationAccess(input.missionId);
      const ref = doc(
        this.sub(input.eventId, 'submissions'),
        submissionId(input.missionId, input.teamId),
      );
      const snapshot = await getDoc(ref);
      const data = snapshot.data();
      if (!isCompleteSubmission(data) || data.status === 'draft') {
        throw new RepositoryError('not-allowed', '되돌릴 제출이 없어요.');
      }
      const submission = mapSubmission(snapshot);
      const result = await getDoc(
        doc(
          this.sub(input.eventId, 'results'),
          resultId(input.missionId, submission.grade, submission.roundNo, input.teamId),
        ),
      );
      if (result.exists()) {
        throw new RepositoryError(
          'not-allowed',
          '순위를 확정한 뒤에는 제출을 되돌릴 수 없어요. 순위 수정으로 바꿔 주세요.',
        );
      }
      const batch = writeBatch(this.db);
      batch.update(ref, {
        status: 'draft',
        reopened: true,
        score: null,
        updatedAt: serverTimestamp(),
      });
      const state = this.missionStateWrite(
        input.eventId,
        input.missionId,
        submission.grade,
        submission.roundNo,
      );
      batch.set(state.ref, state.data, { merge: true });
      await batch.commit();
    });
  }

  async listDrawingFiles(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): Promise<DrawingFile[]> {
    return run(async () => {
      await this.ensureUser();
      this.requireTeacher();
      const mission = await this.getMission(eventId, missionId);
      const teamNo = getTeamNoForMission(mission.no, roundNo);
      const teams = (await this.listTeams(eventId, grade)).filter((team) => team.teamNo === teamNo);
      // 이번 라운드 참가 팀(4~6팀)의 그림 문서만 하나씩 읽는다.
      const snapshots = await Promise.all(
        teams.map((team) => getDoc(doc(this.sub(eventId, 'drawingSubmissions'), team.id))),
      );
      return snapshots
        .filter((snapshot) => snapshot.exists())
        .map(mapDrawingFile)
        .filter((file) => file.missionId === '' || file.missionId === missionId);
    });
  }

  /** 순위 결과별 카드 보상. 보상 ID가 결과 ID와 같아 문서를 하나씩 읽는다. */
  private async awardsForResults(
    eventId: string,
    results: readonly MissionResult[],
  ): Promise<CardAward[]> {
    const snapshots = await Promise.all(
      results.map((result) => getDoc(doc(this.sub(eventId, 'cardAwards'), result.id))),
    );
    return snapshots.filter((snapshot) => snapshot.exists()).map(mapCardAward);
  }

  // ---- 카드 보상과 네 조각 성장 ----

  private classAwards(eventId: string, classId: string): Promise<CardAward[]> {
    return this.fetchAll(
      query(this.sub(eventId, 'cardAwards'), where('classId', '==', classId)),
      mapCardAward,
    );
  }

  private async classProgress(eventId: string, classId: string): Promise<ClassCardProgress> {
    return computeClassCardProgress(classId, await this.classAwards(eventId, classId));
  }

  private async awardViews(eventId: string, awards: readonly CardAward[]) {
    const missions = await this.listMissions(eventId);
    return awards.map((award): CardAwardView => ({
      ...award,
      sourceLabel: `${award.roundNo}라운드 ${
        missions.find((mission) => mission.id === award.missionId)?.title ?? '미션'
      } ${award.rank}위`,
    }));
  }

  private async getClass(eventId: string, classId: string): Promise<ClassInfo> {
    const snapshot = await getDoc(doc(this.sub(eventId, 'classes'), classId));
    if (!snapshot.exists()) throw new RepositoryError('not-found', '학급을 찾을 수 없어요.');
    return mapClass(snapshot);
  }

  async getTeamRewardView(eventId: string, teamId: string): Promise<TeamRewardView> {
    return run(async () => {
      await this.ensureUser();
      const team = await this.getTeam(eventId, teamId);
      const [classInfo, progress, awards] = await Promise.all([
        this.getClass(eventId, team.classId),
        this.classProgress(eventId, team.classId),
        this.fetchAll(
          query(this.sub(eventId, 'cardAwards'), where('teamId', '==', team.id)),
          mapCardAward,
        ),
      ]);
      awards.sort(
        (a, b) =>
          Number(a.status === 'claimed') - Number(b.status === 'claimed') ||
          b.roundNo - a.roundNo ||
          b.createdAt - a.createdAt,
      );
      return { classInfo, progress, awards: await this.awardViews(eventId, awards) };
    });
  }

  async claimCardAward(input: ClaimCardAwardInput): Promise<ClaimCardAwardOutcome> {
    return run(async () => {
      await this.ensureUser();
      const team = await this.getTeam(input.eventId, input.teamId);
      const before = (await this.classProgress(input.eventId, team.classId)).cards[
        input.selectedType
      ];
      const ref = doc(this.sub(input.eventId, 'cardAwards'), input.awardId);
      const claimed = await runTransaction(this.db, async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists()) {
          throw new RepositoryError('not-found', '카드 보상을 찾을 수 없어요.');
        }
        const award = mapCardAward(snapshot);
        if (award.teamId !== team.id) {
          throw new RepositoryError('not-allowed', '다른 팀의 카드 보상이에요.');
        }
        // 같은 요청을 다시 보낸 경우(연타·재시도)는 이미 받은 결과로 본다.
        if (award.status === 'claimed' && snapshot.data().claimRequestId === input.requestId) {
          return award;
        }
        try {
          const next = applyCardClaim(award, input.selectedType, Date.now());
          transaction.update(ref, {
            status: 'claimed',
            selectedType: input.selectedType,
            claimedAt: serverTimestamp(),
            claimRequestId: input.requestId,
          });
          return next;
        } catch (error) {
          if (error instanceof CardAwardError) {
            throw error.reason === 'already-claimed'
              ? new RepositoryError('already-claimed', '이미 받은 카드 보상이에요.')
              : new RepositoryError('invalid-input', '제시된 카드 중에서만 고를 수 있어요.');
          }
          throw error;
        }
      });
      const progress = await this.classProgress(input.eventId, team.classId);
      const [view] = await this.awardViews(input.eventId, [claimed]);
      const selectedType = claimed.selectedType ?? input.selectedType;
      return { award: view, before, after: progress.cards[selectedType], progress };
    });
  }

  async listClassCardBoards(eventId: string, grade: Grade): Promise<ClassCardBoard[]> {
    return run(async () => {
      await this.ensureUser();
      const [classes, awards] = await Promise.all([
        this.listClasses(eventId, grade),
        this.fetchAll(
          query(this.sub(eventId, 'cardAwards'), where('grade', '==', grade)),
          mapCardAward,
        ),
      ]);
      return classes.map((classInfo) => ({
        classInfo,
        progress: computeClassCardProgress(classInfo.id, awards),
      }));
    });
  }

  async getTeacherClassCards(eventId: string, classId: string): Promise<TeacherClassCards> {
    return run(async () => {
      await this.ensureUser();
      this.requireTeacher();
      const classInfo = await this.getClass(eventId, classId);
      const [teams, awards] = await Promise.all([
        this.listTeams(eventId, classInfo.grade),
        this.fetchAll(
          query(this.sub(eventId, 'cardAwards'), where('classId', '==', classId)),
          mapCardAward,
        ),
      ]);
      awards.sort((a, b) => a.roundNo - b.roundNo || a.teamId.localeCompare(b.teamId));
      return {
        classInfo,
        teams: teams.filter((team) => team.classId === classId).sort((a, b) => a.teamNo - b.teamNo),
        progress: computeClassCardProgress(classId, awards),
        awards: await this.awardViews(eventId, awards),
      };
    });
  }

  /** 팀 이동 기록을 연결하기 전까지는 순위 결과로만 완료 여부를 알린다. */
  private movementOf(
    team: Team,
    missionId: string,
    roundNo: RoundNo,
    result: MissionResult | null,
  ): TeamMissionState {
    return {
      id: teamMissionStateId(team.classId, team.teamNo, roundNo),
      grade: team.grade,
      classId: team.classId,
      teamId: team.id,
      teamNo: team.teamNo,
      roundNo,
      expectedMissionId: missionId,
      actualMissionId: null,
      status: result ? 'completed' : 'scheduled',
      alertCodes: [],
      checkedInAt: null,
      startedAt: null,
      completedAt: result?.finalizedAt ?? null,
      resultId: result?.id ?? null,
      updatedAt: result?.finalizedAt ?? 0,
    };
  }

  // ---- 팀 이동과 QR 체크인 ----

  async getMyTeam(eventId: string): Promise<Team | null> {
    return run(async () => {
      const user = await this.ensureUser();
      const session = await getDoc(doc(this.sub(eventId, 'sessions'), user.uid));
      const teamId = session.data()?.teamId as string | undefined;
      return teamId ? this.getTeam(eventId, teamId) : null;
    });
  }

  async checkInStation(input: CheckInInput): Promise<CheckInOutcome> {
    return run(() => this.tour.checkIn(input));
  }

  async getTeamTourStatus(eventId: string, teamId: string): Promise<TeamTourStatus> {
    return run(() => this.tour.tourStatus(eventId, teamId));
  }

  // ---- 실시간 운영 대시보드 ----

  async getOpsDashboard(eventId: string, grade: Grade, roundNo?: RoundNo): Promise<OpsDashboard> {
    return run(() => this.tour.dashboard(eventId, grade, roundNo));
  }

  async getClassOpsDetail(eventId: string, classId: string): Promise<ClassOpsDetail> {
    return run(async () => {
      await this.ensureUser();
      const teacher = this.requireTeacher();
      const classInfo = await this.getClass(eventId, classId);
      const [awards, session] = await Promise.all([
        this.classAwards(eventId, classId),
        this.final.sessionOf(eventId, classInfo.grade),
      ]);
      const [teams, finalState] = await Promise.all([
        this.tour.classTeams(eventId, classId, classInfo.grade, awards),
        this.final.stateOf(eventId, classInfo, session),
      ]);
      const progress = computeClassCardProgress(classId, awards);
      return {
        classInfo,
        teams,
        progress,
        hintPreview: getHintTotal(progress),
        session,
        finalState: redactFinalClassState(finalState, canViewFinalResults(session, teacher.role)),
        finalStatus: presentFinalClassStatus(session, finalState, this.serverNow()),
        canRunFinal: this.canRunClassFinal(classId),
        startBlocker: getFinalStartBlocker(session, finalState),
      };
    });
  }

  subscribeOps(
    eventId: string,
    grade: Grade,
    onChange: (revision: number) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    return this.tour.subscribe(eventId, grade, onChange, (error) =>
      onError(toRepositoryError(error)),
    );
  }

  async getMissionRoundState(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): Promise<MissionRoundState> {
    return run(() => this.tour.missionRound(eventId, missionId, grade, roundNo));
  }

  async getStationArrivals(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): Promise<StationArrivals> {
    return run(() => this.tour.arrivals(eventId, missionId, grade, roundNo));
  }

  async startStationRound(input: StartStationInput): Promise<MissionRoundState> {
    return run(() => this.tour.startStation(input));
  }

  async markTeamArrived(input: MarkArrivedInput): Promise<TeamMissionState> {
    return run(() => this.tour.markArrived(input));
  }

  // ---- 학급 전체 최종 미션 ----

  async getFinalBoard(eventId: string, grade: Grade): Promise<FinalBoard> {
    return run(() => this.final.board(eventId, grade));
  }

  subscribeFinal(
    eventId: string,
    grade: Grade,
    onChange: (revision: number) => void,
    onError: (error: unknown) => void,
    classId?: string,
  ): Unsubscribe {
    return this.final.subscribe(
      eventId,
      grade,
      onChange,
      (error) => onError(toRepositoryError(error)),
      classId,
    );
  }

  async openFinal(input: OpenFinalInput): Promise<FinalSession> {
    return run(() => this.final.open(input));
  }

  async setFinalDuration(
    eventId: string,
    grade: Grade,
    durationLimitSec: number,
  ): Promise<FinalSession> {
    return run(() => this.final.setDuration(eventId, grade, durationLimitSec));
  }

  async publishFinalResults(eventId: string, grade: Grade): Promise<FinalSession> {
    return run(() => this.final.publish(eventId, grade));
  }

  async getClassFinalView(eventId: string, classId: string): Promise<ClassFinalView> {
    return run(() => this.final.classView(eventId, classId));
  }

  async startClassFinal(input: StartClassFinalInput): Promise<ClassFinalView> {
    return run(async () => {
      await this.syncClock(input.eventId);
      return this.final.start(input);
    });
  }

  async selectFinalChoice(input: SelectFinalChoiceInput): Promise<ClassFinalView> {
    return run(() => this.final.select(input));
  }

  async applyFinalHint(input: FinalQuestionActionInput): Promise<ClassFinalView> {
    return run(() => this.final.hint(input));
  }

  async confirmFinalAnswer(input: FinalQuestionActionInput): Promise<ClassFinalView> {
    return run(() => this.final.confirm(input));
  }

  async closeExpiredClassFinal(eventId: string, classId: string): Promise<ClassFinalView> {
    return run(() => this.final.closeExpired(eventId, classId));
  }

  async forceCloseClassFinal(input: FinalAdminActionInput): Promise<FinalClassState> {
    return run(() => this.final.forceClose(input));
  }

  async adjustFinalResult(input: AdjustFinalResultInput): Promise<FinalClassState> {
    return run(() => this.final.adjust(input));
  }

  async resetClassFinal(input: FinalAdminActionInput): Promise<FinalClassState> {
    return run(() => this.final.reset(input));
  }
}
