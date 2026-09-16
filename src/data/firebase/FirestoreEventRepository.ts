import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
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
import { computeClassCardCounts, countClaimedCards, drawCardType } from '../../domain/cards';
import { EXCHANGE_ERROR_MESSAGES, validateExchange } from '../../domain/exchange';
import { getTicketCountForRank } from '../../domain/rewards';
import { getRoundForMission, getTeamNoForMission, ROUND_NUMBERS } from '../../domain/rotation';
import { calculateAutoScore } from '../../domain/scoring';
import type {
  CardType,
  ClassInfo,
  DrawTicket,
  Exchange,
  FestivalEvent,
  Grade,
  Mission,
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
  MissionParticipant,
  MissionProgress,
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
  mapClass,
  mapEvent,
  mapExchange,
  mapMission,
  mapResult,
  mapSubmission,
  mapTeam,
  mapTicket,
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
        submission: submissionSnap.exists() ? mapSubmission(submissionSnap) : null,
        finalized: resultSnap.exists(),
        answerRevealed: revealSnap.data()?.answerRevealed === true,
      };
    });
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
      const roundNo = getRoundForMission(team.teamNo, mission.no);
      const ref = doc(this.sub(input.eventId, 'submissions'), submissionId(mission.id, team.id));

      await runTransaction(this.db, async (transaction) => {
        const existing = await transaction.get(ref);
        const data = existing.data();
        if (data && data.status !== 'draft') {
          // 같은 요청을 다시 보낸 경우(재시도)에는 그대로 둔다.
          if (data.requestId === input.requestId) return;
          throw new RepositoryError('not-allowed', '이미 제출했어요. 선생님께 말해 주세요.');
        }
        transaction.set(ref, {
          teamId: team.id,
          classId: team.classId,
          missionId: mission.id,
          grade: team.grade,
          roundNo,
          status: 'submitted',
          answer: input.answer,
          score: null,
          requestId: input.requestId,
          submittedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      const saved = mapSubmission(await getDoc(ref));
      // 자동 채점 미션의 점수는 교사 화면에서 확인·수정한다(학생은 점수를 쓸 수 없다).
      return { ...saved, score: calculateAutoScore(mission.config, saved.answer) };
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
          query(this.sub(eventId, 'submissions'), where('missionId', '==', missionId)),
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
      return teams.map((team) => ({
        team,
        submission: submissions.find((item) => item.teamId === team.id) ?? null,
        result: results.find((item) => item.teamId === team.id) ?? null,
        ticketCount: ticketCounts[team.id] ?? 0,
      }));
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
      await setDoc(
        doc(this.sub(eventId, 'missionStates'), resultKey(missionId, grade, roundNo)),
        { missionId, grade, roundNo, answerRevealed: revealed, updatedAt: serverTimestamp() },
        { merge: true },
      );
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

  /** 순위 확정과 뽑기권 발급을 한 번에 기록한다. 같은 묶음을 다시 확정해도 늘지 않는다. */
  async finalizeRanking(input: FinalizeRankingInput): Promise<FinalizeRankingOutcome> {
    return run(async () => {
      await this.ensureUser();
      const teacher = this.teacher;
      if (!teacher) throw new RepositoryError('not-allowed', '교사로 로그인해야 할 수 있어요.');

      const existing = await this.fetchAll(
        query(
          this.sub(input.eventId, 'results'),
          where('missionId', '==', input.missionId),
          where('grade', '==', input.grade),
          where('roundNo', '==', input.roundNo),
        ),
        mapResult,
      );
      if (existing.length > 0) {
        const tickets = await this.ticketsForResults(input.eventId, existing);
        return { results: existing, ticketsByTeam: tickets, alreadyFinalized: true };
      }
      if (input.entries.length === 0) {
        throw new RepositoryError('invalid-input', '순위를 확정할 팀이 없어요.');
      }

      const teams = await this.listTeams(input.eventId, input.grade);
      const batch = writeBatch(this.db);
      const results: MissionResult[] = [];
      const ticketsByTeam: Record<string, number> = {};
      const now = Date.now();

      for (const entry of input.entries) {
        const team = teams.find((item) => item.id === entry.teamId);
        if (!team) throw new RepositoryError('invalid-input', '참가하지 않은 팀이 들어 있어요.');
        if (!Number.isInteger(entry.rank) || entry.rank < 1) {
          throw new RepositoryError('invalid-input', '순위는 1 이상의 정수로 입력해 주세요.');
        }
        if (!Number.isFinite(entry.score) || entry.score < 0) {
          throw new RepositoryError('invalid-input', '점수는 0 이상으로 입력해 주세요.');
        }

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
          batch.set(doc(this.sub(input.eventId, 'drawTickets'), `${id}__${index}`), {
            teamId: team.id,
            classId: team.classId,
            sourceResultId: id,
            cardType: drawCardType(Math.random),
            claimedAt: null,
            createdAt: serverTimestamp(),
          });
        }
        batch.set(
          doc(this.sub(input.eventId, 'submissions'), submissionId(input.missionId, team.id)),
          { score: entry.score, status: 'verified', updatedAt: serverTimestamp() },
          { merge: true },
        );
      }

      await batch.commit();
      return { results, ticketsByTeam, alreadyFinalized: false };
    });
  }

  private async ticketsForResults(
    eventId: string,
    results: readonly MissionResult[],
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const result of results) {
      const tickets = await this.fetchAll(
        query(this.sub(eventId, 'drawTickets'), where('sourceResultId', '==', result.id)),
        mapTicket,
      );
      counts[result.teamId] = tickets.length;
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
      for (const ticket of tickets) {
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

      // 문서 ID를 requestId로 고정해 중복 클릭에도 기록이 하나만 생긴다.
      const ref = doc(this.sub(input.eventId, 'exchanges'), input.requestId);
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
