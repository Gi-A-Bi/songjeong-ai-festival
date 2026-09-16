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
  doc,
  getDoc,
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
  computeClassCardCounts,
  countClaimedCards,
  drawCardType,
  isActiveTicket,
  nextTicketIndexes,
  planTicketAdjustment,
} from '../../domain/cards';
import { EXCHANGE_ERROR_MESSAGES, validateExchange } from '../../domain/exchange';
import { getGoldenBellConfigError } from '../../domain/goldenBell';
import { getSubmissionBlocker } from '../../domain/missionPhase';
import { getRankingEntryError, getTicketCountForRank } from '../../domain/rewards';
import { getRoundForMission, getTeamNoForMission, ROUND_NUMBERS } from '../../domain/rotation';
import { resolveSubmissionScore } from '../../domain/scoring';
import type {
  CardType,
  ClassInfo,
  DrawingFile,
  DrawTicket,
  Exchange,
  FestivalEvent,
  Grade,
  Mission,
  MissionConfig,
  MissionResult,
  RoundNo,
  RoundStatus,
  Submission,
  Team,
  TeacherProfile,
} from '../../domain/types';
import type {
  ClassCardRow,
  CreateExchangeInput,
  EventRepository,
  EventSetupSummary,
  FinalizeRankingInput,
  FinalizeRankingOutcome,
  MissionLiveState,
  MissionParticipant,
  MissionProgress,
  ReopenSubmissionInput,
  ReviseRankingOutcome,
  RoundControlAction,
  SaveSubmissionInput,
  TeamCardSummary,
  TeamMissionView,
  TeamSession,
  TicketView,
  Unsubscribe,
} from '../EventRepository';
import { RepositoryError } from '../errors';
// 샘플 행사 구조는 mock과 Firestore가 같은 정의를 쓴다.
import { buildSampleEvent } from '../mock/seed';
import { getFirebase } from './firebaseApp';
import {
  isCompleteSubmission,
  mapClass,
  mapDrawingFile,
  mapEvent,
  mapExchange,
  mapMission,
  mapResult,
  mapSubmission,
  mapTeam,
  mapTicket,
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

  private readonly db: Firestore;
  private authReady: Promise<void> | null = null;
  private teacher: TeacherProfile | null = null;

  constructor() {
    this.db = getFirebase().db;
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
    return {
      uid,
      displayName: String(data.displayName ?? '선생님'),
      role: data.role === 'admin' ? 'admin' : 'teacher',
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
    await signOut(getFirebase().auth);
  }

  private requireTeacher(): TeacherProfile {
    if (!this.teacher) throw new RepositoryError('not-allowed', '교사로 로그인해야 할 수 있어요.');
    return this.teacher;
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

      return {
        created: true,
        classes: structure.classes.length,
        teams: structure.teams.length,
        missions: structure.missions.length,
      };
    });
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

    void this.ensureUser()
      .then(() => {
        if (stopped) return;
        // 진행 상태는 작은 문서 하나만 실시간 구독한다(무료 사용량 보호).
        detach = onSnapshot(
          this.eventRef(eventId),
          (snapshot) => {
            try {
              onChange(mapEvent(snapshot));
            } catch (error) {
              onError(toRepositoryError(error));
            }
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

  async controlRound(eventId: string, action: RoundControlAction): Promise<FestivalEvent> {
    return run(async () => {
      await this.ensureUser();
      const eventRef = this.eventRef(eventId);
      await runTransaction(this.db, async (transaction) => {
        const snapshot = await transaction.get(eventRef);
        const event = mapEvent(snapshot);
        const now = Date.now();
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
          updatedAt: serverTimestamp(),
        });
      });
      return this.getEvent(eventId);
    });
  }

  async setActiveGrade(eventId: string, grade: Grade): Promise<FestivalEvent> {
    return run(async () => {
      await this.ensureUser();
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
      this.requireTeacher();
      const mission = await this.getMission(eventId, missionId);
      if (config.type !== mission.type) {
        throw new RepositoryError('invalid-input', '미션 종류와 설정 형식이 달라요.');
      }
      if (config.type === 'golden_bell') {
        const error = getGoldenBellConfigError(config.questions);
        if (error) throw new RepositoryError('invalid-input', error);
      }
      await updateDoc(doc(this.sub(eventId, 'missions'), missionId), { config });
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
      if (existingTeamId && existingTeamId !== teamId) {
        throw new RepositoryError(
          'not-allowed',
          '이 기기는 다른 팀으로 입장했어요. 선생님께 잠금 해제를 요청해 주세요.',
        );
      }
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
  ): Promise<MissionParticipant[]> {
    return run(async () => {
      await this.ensureUser();
      const mission = await this.getMission(eventId, missionId);
      const teamNo = getTeamNoForMission(mission.no, roundNo);
      const teams = (await this.listTeams(eventId, grade)).filter((team) => team.teamNo === teamNo);
      const [submissions, results] = await Promise.all([
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
      // 확정된 순위가 있을 때만 뽑기권 수를 센다(불필요한 읽기 방지).
      const ticketCounts = results.length > 0 ? await this.ticketsForResults(eventId, results) : {};
      return teams.map((team) => {
        const submission = submissions.find((item) => item.teamId === team.id) ?? null;
        return {
          team,
          submission: submission
            ? { ...submission, score: resolveSubmissionScore(submission, mission) }
            : null,
          result: results.find((item) => item.teamId === team.id) ?? null,
          ticketCount: ticketCounts[team.id]?.active ?? 0,
          claimedTicketCount: ticketCounts[team.id]?.claimed ?? 0,
        };
      });
    });
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
      this.requireTeacher();
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

  private newTicketData(team: Team, sourceResultId: string) {
    return {
      teamId: team.id,
      classId: team.classId,
      sourceResultId,
      cardType: drawCardType(Math.random),
      claimedAt: null,
      revokedAt: null,
      createdAt: serverTimestamp(),
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

  /** 순위 확정과 뽑기권 발급을 한 번에 기록한다. 같은 묶음을 다시 확정해도 늘지 않는다. */
  async finalizeRanking(input: FinalizeRankingInput): Promise<FinalizeRankingOutcome> {
    return run(async () => {
      await this.ensureUser();
      const teacher = this.requireTeacher();

      const existing = await this.resultsOf(input);
      if (existing.length > 0) {
        const tickets = await this.ticketsForResults(input.eventId, existing);
        return {
          results: existing,
          ticketsByTeam: Object.fromEntries(
            Object.entries(tickets).map(([teamId, count]) => [teamId, count.active]),
          ),
          alreadyFinalized: true,
        };
      }

      const teams = await this.validateRankingEntries(input);
      const submittedRefs = await this.submittedRefsByTeam(input.eventId, input.missionId, teams);
      const batch = writeBatch(this.db);
      const results: MissionResult[] = [];
      const ticketsByTeam: Record<string, number> = {};
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
        results.push({
          id,
          missionId: input.missionId,
          grade: input.grade,
          roundNo: input.roundNo,
          teamId: team.id,
          score: entry.score,
          rank: entry.rank,
          finalizedBy: teacher.uid,
          finalizedAt: now,
        });

        const count = getTicketCountForRank(entry.rank);
        ticketsByTeam[team.id] = count;
        for (let index = 1; index <= count; index += 1) {
          batch.set(
            doc(this.sub(input.eventId, 'drawTickets'), `${id}__${index}`),
            this.newTicketData(team, id),
          );
        }
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
      return { results, ticketsByTeam, alreadyFinalized: false };
    });
  }

  async reviseRanking(input: FinalizeRankingInput): Promise<ReviseRankingOutcome> {
    return run(async () => {
      await this.ensureUser();
      const teacher = this.requireTeacher();
      const existing = await this.resultsOf(input);
      if (existing.length === 0) {
        throw new RepositoryError(
          'not-allowed',
          '아직 확정하지 않은 순위예요. 먼저 순위를 확정해 주세요.',
        );
      }
      const teams = await this.validateRankingEntries(input);
      const submittedRefs = await this.submittedRefsByTeam(input.eventId, input.missionId, teams);

      const batch = writeBatch(this.db);
      const results: MissionResult[] = [];
      const ticketsByTeam: Record<string, number> = {};
      let added = 0;
      let revoked = 0;
      let revokedClaimed = 0;

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
        results.push({
          id,
          missionId: input.missionId,
          grade: input.grade,
          roundNo: input.roundNo,
          teamId: team.id,
          score: entry.score,
          rank: entry.rank,
          finalizedBy: teacher.uid,
          finalizedAt: previous?.finalizedAt ?? Date.now(),
        });

        const tickets = await this.fetchAll(
          query(this.sub(input.eventId, 'drawTickets'), where('sourceResultId', '==', id)),
          mapTicket,
        );
        const target = getTicketCountForRank(entry.rank);
        const plan = planTicketAdjustment(tickets, target);
        const newIndexes = nextTicketIndexes(
          tickets.map((ticket) => ticket.id),
          plan.createCount,
        );
        for (const ticketNo of newIndexes) {
          batch.set(
            doc(this.sub(input.eventId, 'drawTickets'), `${id}__${ticketNo}`),
            this.newTicketData(team, id),
          );
        }
        for (const ticketId of plan.revokeIds) {
          batch.update(doc(this.sub(input.eventId, 'drawTickets'), ticketId), {
            revokedAt: serverTimestamp(),
          });
        }
        ticketsByTeam[team.id] = target;
        added += plan.createCount;
        revoked += plan.revokeIds.length;
        revokedClaimed += plan.revokedClaimed;

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
      return { results, ticketsByTeam, added, revoked, revokedClaimed };
    });
  }

  async reopenSubmission(input: ReopenSubmissionInput): Promise<void> {
    return run(async () => {
      await this.ensureUser();
      this.requireTeacher();
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

  /** 순위 결과별로 회수되지 않은 뽑기권 수와 그중 사용한 수 */
  private async ticketsForResults(
    eventId: string,
    results: readonly MissionResult[],
  ): Promise<Record<string, { active: number; claimed: number }>> {
    const counts: Record<string, { active: number; claimed: number }> = {};
    for (const result of results) {
      const tickets = (
        await this.fetchAll(
          query(this.sub(eventId, 'drawTickets'), where('sourceResultId', '==', result.id)),
          mapTicket,
        )
      ).filter(isActiveTicket);
      counts[result.teamId] = {
        active: tickets.length,
        claimed: tickets.filter((ticket) => ticket.claimedAt !== null).length,
      };
    }
    return counts;
  }

  // ---- 카드 ----

  private async teamTickets(eventId: string, teamId: string): Promise<DrawTicket[]> {
    const tickets = await this.fetchAll(
      query(this.sub(eventId, 'drawTickets'), where('teamId', '==', teamId)),
      mapTicket,
    );
    return tickets.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  async listTeamTickets(eventId: string, teamId: string): Promise<TicketView[]> {
    return run(async () => {
      await this.ensureUser();
      const [tickets, missions] = await Promise.all([
        this.teamTickets(eventId, teamId),
        this.listMissions(eventId),
      ]);
      const resultCache = new Map<string, MissionResult | null>();
      const views: TicketView[] = [];
      for (const ticket of tickets.filter(isActiveTicket)) {
        let label = '카드 뽑기권';
        if (ticket.sourceResultId) {
          if (!resultCache.has(ticket.sourceResultId)) {
            const snapshot = await getDoc(doc(this.sub(eventId, 'results'), ticket.sourceResultId));
            resultCache.set(ticket.sourceResultId, snapshot.exists() ? mapResult(snapshot) : null);
          }
          const result = resultCache.get(ticket.sourceResultId) ?? null;
          if (result) {
            const mission = missions.find((item) => item.id === result.missionId);
            label = `${result.roundNo}라운드 ${mission?.title ?? '미션'} ${result.rank}위`;
          }
        }
        views.push({
          id: ticket.id,
          claimed: ticket.claimedAt !== null,
          cardType: ticket.claimedAt !== null ? ticket.cardType : null,
          sourceLabel: label,
        });
      }
      return views;
    });
  }

  async claimTicket(eventId: string, teamId: string, ticketId: string): Promise<CardType> {
    return run(async () => {
      await this.ensureUser();
      const ref = doc(this.sub(eventId, 'drawTickets'), ticketId);
      return runTransaction(this.db, async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists()) throw new RepositoryError('not-found', '뽑기권을 찾을 수 없어요.');
        const ticket = mapTicket(snapshot);
        if (ticket.teamId !== teamId) {
          throw new RepositoryError('not-allowed', '다른 팀의 뽑기권이에요.');
        }
        if (!isActiveTicket(ticket)) {
          throw new RepositoryError('not-found', '선생님이 회수한 뽑기권이에요.');
        }
        if (ticket.claimedAt !== null) throw new RepositoryError('already-claimed');
        transaction.update(ref, { claimedAt: serverTimestamp() });
        return ticket.cardType;
      });
    });
  }

  private async classTickets(eventId: string, classId: string): Promise<DrawTicket[]> {
    return this.fetchAll(
      query(this.sub(eventId, 'drawTickets'), where('classId', '==', classId)),
      mapTicket,
    );
  }

  private async classExchanges(eventId: string, classId: string): Promise<Exchange[]> {
    const [outgoing, incoming] = await Promise.all([
      this.fetchAll(
        query(this.sub(eventId, 'exchanges'), where('fromClassId', '==', classId)),
        mapExchange,
      ),
      this.fetchAll(
        query(this.sub(eventId, 'exchanges'), where('toClassId', '==', classId)),
        mapExchange,
      ),
    ]);
    return [...outgoing, ...incoming];
  }

  async getTeamCardSummary(eventId: string, teamId: string): Promise<TeamCardSummary> {
    return run(async () => {
      await this.ensureUser();
      const team = await this.getTeam(eventId, teamId);
      const [teamTickets, classTickets, exchanges, classSnapshot] = await Promise.all([
        this.teamTickets(eventId, teamId),
        this.classTickets(eventId, team.classId),
        this.classExchanges(eventId, team.classId),
        getDoc(doc(this.sub(eventId, 'classes'), team.classId)),
      ]);
      return {
        team: countClaimedCards(teamTickets),
        class: computeClassCardCounts(team.classId, classTickets, exchanges),
        classDisplayName: classSnapshot.exists()
          ? mapClass(classSnapshot).displayName
          : team.classId,
      };
    });
  }

  async listClassCardRows(eventId: string, grade: Grade): Promise<ClassCardRow[]> {
    return run(async () => {
      await this.ensureUser();
      const classes = await this.listClasses(eventId, grade);
      const classIds = classes.map((classInfo) => classInfo.id);
      const [tickets, exchanges] = await Promise.all([
        classIds.length > 0
          ? this.fetchAll(
              query(this.sub(eventId, 'drawTickets'), where('classId', 'in', classIds)),
              mapTicket,
            )
          : Promise.resolve([]),
        this.listExchanges(eventId, grade),
      ]);
      return classes.map((classInfo) => ({
        classInfo,
        counts: computeClassCardCounts(classInfo.id, tickets, exchanges),
      }));
    });
  }

  async listExchanges(eventId: string, grade: Grade): Promise<Exchange[]> {
    return run(async () => {
      await this.ensureUser();
      const classes = await this.listClasses(eventId, grade);
      const classIds = classes.map((classInfo) => classInfo.id);
      if (classIds.length === 0) return [];
      const exchanges = await this.fetchAll(
        query(this.sub(eventId, 'exchanges'), where('fromClassId', 'in', classIds)),
        mapExchange,
      );
      return exchanges.sort((a, b) => b.createdAt - a.createdAt);
    });
  }

  async createExchange(input: CreateExchangeInput): Promise<Exchange> {
    return run(async () => {
      await this.ensureUser();
      const teacher = this.teacher;
      if (!teacher) throw new RepositoryError('not-allowed', '교사로 로그인해야 할 수 있어요.');

      // 문서 ID를 requestId로 고정해 중복 클릭·재시도에도 기록이 하나만 생긴다.
      // 재시도는 카드가 이미 옮겨진 뒤이므로 수량 검사보다 먼저 확인한다.
      const ref = doc(this.sub(input.eventId, 'exchanges'), input.requestId);
      const alreadyRecorded = await getDoc(ref);
      if (alreadyRecorded.exists()) return mapExchange(alreadyRecorded);

      const [fromSnap, toSnap] = await Promise.all([
        getDoc(doc(this.sub(input.eventId, 'classes'), input.fromClassId)),
        getDoc(doc(this.sub(input.eventId, 'classes'), input.toClassId)),
      ]);
      if (!fromSnap.exists() || !toSnap.exists()) {
        throw new RepositoryError('invalid-input', EXCHANGE_ERROR_MESSAGES['missing-class']);
      }
      const fromClass = mapClass(fromSnap);
      const toClass = mapClass(toSnap);
      if (fromClass.grade !== toClass.grade) {
        throw new RepositoryError('invalid-input', '같은 학년 학급끼리만 교환할 수 있어요.');
      }

      const [tickets, exchanges] = await Promise.all([
        this.classTickets(input.eventId, fromClass.id),
        this.classExchanges(input.eventId, fromClass.id),
      ]);
      const counts = computeClassCardCounts(fromClass.id, tickets, exchanges);
      const validationError = validateExchange(input, counts);
      if (validationError) {
        throw new RepositoryError(
          validationError === 'insufficient-cards' ? 'insufficient-cards' : 'invalid-input',
          EXCHANGE_ERROR_MESSAGES[validationError],
        );
      }

      await runTransaction(this.db, async (transaction) => {
        const existing = await transaction.get(ref);
        if (existing.exists()) return;
        transaction.set(ref, {
          requestId: input.requestId,
          fromClassId: input.fromClassId,
          toClassId: input.toClassId,
          cardType: input.cardType,
          quantity: input.quantity,
          status: 'completed',
          createdBy: teacher.uid,
          createdAt: serverTimestamp(),
          reversesExchangeId: null,
        });
      });
      return mapExchange(await getDoc(ref));
    });
  }
}
