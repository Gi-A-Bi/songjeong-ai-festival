import {
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentData,
} from 'firebase/firestore';
import { CHECK_IN_GRACE_MS } from '../../config';
import { CARD_PIECES } from '../../domain/cards';
import { CARD_INFO } from '../../domain/catalog';
import { emptyFinalSession } from '../../domain/finalMission';
import { getMissionNoForRound, getTeamNoForMission, ROUND_NUMBERS } from '../../domain/rotation';
import {
  ALERT_LABELS,
  applyCheckIn,
  applyResultFinalized,
  emptyTeamMissionRecord,
  getCheckInRound,
  getRoundClock,
  getRoundPhase,
  missionRoundStateId,
  presentMissionRoundStatus,
  presentTeamMissionState,
  summarizeTeamStates,
  teamMissionStateId,
  type TeamMissionRecord,
} from '../../domain/tour';
import type {
  ActivityEvent,
  CardAward,
  FestivalEvent,
  FinalClassState,
  FinalSession,
  Grade,
  Mission,
  MissionRoundState,
  RoundNo,
  RoundStatus,
  Team,
  TeamMissionState,
} from '../../domain/types';
import { formatClock } from '../../lib/time';
import { RepositoryError } from '../errors';
import type {
  CheckInInput,
  CheckInOutcome,
  ClassOpsTeam,
  MarkArrivedInput,
  OpsAlert,
  OpsDashboard,
  OpsStation,
  OpsTeamCell,
  StartStationInput,
  StationArrivals,
  TeamTourStatus,
  Unsubscribe,
} from '../EventRepository';
import { isPermissionDenied, LiveGroup, type FirestoreStoreContext } from './firestoreContext';
import { LiveDoc, LiveQuery } from './liveQuery';
import {
  mapBooth,
  mapCardAward,
  mapEvent,
  mapFinalClassState,
  mapFinalSession,
  mapResult,
  mapRound,
  mapTeamMissionRecord,
  type BoothDoc,
  type RoundDoc,
} from './mappers';

const ACTIVITY_LIMIT = 30;
function roundDocId(grade: Grade, roundNo: RoundNo): string {
  return `g${grade}-r${roundNo}`;
}

function resultDocId(missionId: string, grade: Grade, roundNo: RoundNo, teamId: string): string {
  return `${missionId}__g${grade}__r${roundNo}__${teamId}`;
}

interface SubmissionMark {
  missionId: string;
  teamId: string;
  submitted: boolean;
}

/** 팀 상태를 계산할 때 필요한 자료를 어디서 읽었는지와 무관하게 같은 모양으로 쓴다. */
interface TourData {
  event: FestivalEvent;
  record(id: string): TeamMissionRecord | undefined;
  booth(id: string): BoothDoc | undefined;
  roundStatus(grade: Grade, roundNo: RoundNo): RoundStatus;
}

/**
 * 한 학년의 팀 이동·부스·라운드 구독 묶음.
 * 팀 상태 문서는 QR 체크인 때만, 부스 문서는 미션 시작과 결과 확정 때만 바뀌므로
 * 구독으로 받는 읽기는 "바뀐 문서 수 × 보고 있는 교사 수"에 그친다.
 */
class OpsLive extends LiveGroup {
  readonly event: LiveDoc<FestivalEvent>;
  readonly records: LiveQuery<TeamMissionRecord>;
  readonly booths: LiveQuery<BoothDoc>;
  readonly rounds: LiveQuery<RoundDoc>;
  private submissions: { roundNo: RoundNo; live: LiveQuery<SubmissionMark> } | null = null;
  private awards: LiveQuery<CardAward> | null = null;
  private finalSession: LiveDoc<DocumentData> | null = null;
  private finalStates: LiveQuery<{ id: string; data: DocumentData }> | null = null;

  private readonly ctx: FirestoreStoreContext;
  private readonly eventId: string;
  private readonly grade: Grade;

  constructor(ctx: FirestoreStoreContext, eventId: string, grade: Grade, onIdle: () => void) {
    super(onIdle);
    this.ctx = ctx;
    this.eventId = eventId;
    this.grade = grade;
    const bump = () => this.notifier.bump();
    const fail = () => undefined;
    const byGrade = (name: string) => query(ctx.sub(eventId, name), where('grade', '==', grade));
    this.event = this.track(
      new LiveDoc(ctx.eventRef(eventId), (snapshot) => mapEvent(snapshot), bump, fail),
    );
    this.records = this.track(
      new LiveQuery(
        byGrade('teamMissionStates'),
        (snapshot, data) => mapTeamMissionRecord(snapshot.id, data),
        bump,
        fail,
      ),
    );
    this.booths = this.track(
      new LiveQuery(
        byGrade('missionRoundStates'),
        (snapshot, data) => mapBooth(snapshot.id, data),
        bump,
        fail,
      ),
    );
    this.rounds = this.track(
      new LiveQuery(byGrade('rounds'), (_snapshot, data) => mapRound(data), bump, fail),
    );
  }

  /** 대시보드에서만 쓰는 구독: 보고 있는 라운드의 제출물, 학년의 카드 보상, 최종 미션 상태 */
  async watchDashboard(roundNo: RoundNo): Promise<void> {
    const bump = () => this.notifier.bump();
    const fail = () => undefined;
    if (this.submissions?.roundNo !== roundNo) {
      if (this.submissions) this.untrack(this.submissions.live);
      this.submissions = {
        roundNo,
        live: this.track(
          new LiveQuery(
            query(
              this.ctx.sub(this.eventId, 'submissions'),
              where('grade', '==', this.grade),
              where('roundNo', '==', roundNo),
            ),
            (_snapshot, data) => ({
              missionId: String(data.missionId),
              teamId: String(data.teamId),
              submitted: data.status !== 'draft' && typeof data.answer === 'object',
            }),
            bump,
            fail,
          ),
        ),
      };
    }
    this.awards ??= this.track(
      new LiveQuery(
        query(this.ctx.sub(this.eventId, 'cardAwards'), where('grade', '==', this.grade)),
        (snapshot) => mapCardAward(snapshot),
        bump,
        fail,
      ),
    );
    this.finalSession ??= this.track(
      new LiveDoc(
        doc(this.ctx.sub(this.eventId, 'finalSessions'), String(this.grade)),
        (_snapshot, data) => data,
        bump,
        fail,
      ),
    );
    this.finalStates ??= this.track(
      new LiveQuery(
        query(this.ctx.sub(this.eventId, 'finalClassStates'), where('grade', '==', this.grade)),
        (snapshot, data) => ({ id: snapshot.id, data }),
        bump,
        fail,
      ),
    );
    await this.ready();
  }

  get submissionMarks(): readonly SubmissionMark[] {
    return this.submissions?.live.docs ?? [];
  }

  get awardDocs(): readonly CardAward[] {
    return this.awards?.docs ?? [];
  }

  get final(): { session: FinalSession; states: FinalClassState[] } {
    const session = mapFinalSession(this.grade, this.finalSession?.value ?? undefined);
    return {
      session,
      states: (this.finalStates?.docs ?? []).map((item) =>
        mapFinalClassState(item.id, item.data, session.durationLimitSec),
      ),
    };
  }

  data(): TourData {
    const event = this.event.value;
    if (!event) throw new RepositoryError('not-found', '행사 정보를 찾을 수 없어요.');
    const records = new Map(this.records.docs.map((item) => [item.id, item]));
    const booths = new Map(this.booths.docs.map((item) => [item.id, item]));
    const rounds = new Map(
      this.rounds.docs.map((item) => [roundDocId(item.grade, item.roundNo), item.status]),
    );
    return {
      event,
      record: (id) => records.get(id),
      booth: (id) => booths.get(id),
      roundStatus: (grade, roundNo) => rounds.get(roundDocId(grade, roundNo)) ?? 'waiting',
    };
  }

  roundStartedAt(roundNo: RoundNo): number | null {
    return this.rounds.docs.find((item) => item.roundNo === roundNo)?.startedAt ?? null;
  }
}

/** 팀 이동(QR 체크인), 부스 상태, 운영 대시보드의 Firestore 구현 */
export class FirestoreTourStore {
  private readonly ctx: FirestoreStoreContext;
  private readonly lives = new Map<string, OpsLive>();

  constructor(ctx: FirestoreStoreContext) {
    this.ctx = ctx;
  }

  // ---- 구독 ----

  private peek(eventId: string, grade: Grade): OpsLive | undefined {
    return this.lives.get(`${eventId}|${grade}`);
  }

  private use(eventId: string, grade: Grade): OpsLive {
    const key = `${eventId}|${grade}`;
    let live = this.lives.get(key);
    if (!live) {
      live = new OpsLive(this.ctx, eventId, grade, () => this.lives.delete(key));
      this.lives.set(key, live);
    }
    live.touch();
    return live;
  }

  private async readyLive(eventId: string, grade: Grade): Promise<OpsLive> {
    await this.ctx.ensureUser();
    const live = this.use(eventId, grade);
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
  ): Unsubscribe {
    let stopped = false;
    let remove: () => void = () => undefined;
    void this.readyLive(eventId, grade)
      .then((live) => {
        if (stopped) return;
        remove = live.notifier.add(onChange);
        live.touch();
        onChange(live.notifier.current);
      })
      .catch(onError);
    return () => {
      stopped = true;
      remove();
      this.peek(eventId, grade)?.touch();
    };
  }

  /** 로그아웃처럼 권한이 바뀔 때 모든 구독을 끊는다. */
  stopAll(): void {
    for (const live of [...this.lives.values()]) live.stop();
  }

  // ---- 상태 계산 ----

  private missionForRound(missions: readonly Mission[], team: Team, roundNo: RoundNo): Mission {
    const missionNo = getMissionNoForRound(team.teamNo, roundNo);
    const mission = missions.find((item) => item.no === missionNo);
    if (!mission) throw new RepositoryError('not-found', '미션을 찾을 수 없어요.');
    return mission;
  }

  /**
   * 저장된 체크인 기록에 부스 문서를 겹쳐 진행 중·완료를 계산한다.
   * 부스가 미션을 시작했으면 입장한 팀은 진행 중, 순위를 확정한 팀은 완료다.
   */
  private recordOf(data: TourData, team: Team, roundNo: RoundNo, mission: Mission) {
    let record =
      data.record(teamMissionStateId(team.classId, team.teamNo, roundNo)) ??
      emptyTeamMissionRecord({
        grade: team.grade,
        classId: team.classId,
        teamId: team.id,
        teamNo: team.teamNo,
        roundNo,
        expectedMissionId: mission.id,
      });
    const booth = data.booth(missionRoundStateId(mission.id, team.grade, roundNo));
    if (booth?.startedAt != null && record.checkedInAt !== null) {
      record = { ...record, startedAt: Math.max(booth.startedAt, record.checkedInAt) };
    }
    if (booth?.resultTeamIds.includes(team.id)) {
      record = applyResultFinalized(
        record,
        resultDocId(mission.id, team.grade, roundNo, team.id),
        booth.resultFinalizedAt ?? booth.completedAt ?? record.updatedAt,
      );
    }
    return record;
  }

  private present(
    data: TourData,
    team: Team,
    roundNo: RoundNo,
    mission: Mission,
  ): TeamMissionState {
    const clock = getRoundClock(
      data.event,
      team.grade,
      roundNo,
      data.roundStatus(team.grade, roundNo),
      this.ctx.serverNow(),
    );
    return presentTeamMissionState(this.recordOf(data, team, roundNo, mission), clock);
  }

  private presentBooth(
    data: TourData,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): MissionRoundState {
    const id = missionRoundStateId(missionId, grade, roundNo);
    const stored = data.booth(id);
    const resultFinalizedAt = stored?.resultFinalizedAt ?? null;
    return {
      id,
      grade,
      missionId,
      roundNo,
      status: presentMissionRoundStatus(
        stored ? { status: stored.status, resultFinalizedAt } : undefined,
        data.roundStatus(grade, roundNo),
      ),
      startedAt: stored?.startedAt ?? null,
      completedAt: stored?.completedAt ?? resultFinalizedAt,
      resultFinalizedAt,
      updatedBy: stored?.updatedBy ?? null,
    };
  }

  /**
   * 구독 없이 한 팀·한 라운드만 읽는다(학생 기기용). 라운드 상태는 행사 문서로 알 수 있다:
   * 체크인 대상은 지금 라운드(활동 중)이거나 다음 라운드(아직 시작 전)뿐이다.
   */
  private async directData(
    eventId: string,
    event: FestivalEvent,
    team: Team,
    roundNo: RoundNo,
    mission: Mission,
  ): Promise<TourData> {
    const recordId = teamMissionStateId(team.classId, team.teamNo, roundNo);
    const boothId = missionRoundStateId(mission.id, team.grade, roundNo);
    const [recordSnap, boothSnap] = await Promise.all([
      getDoc(doc(this.ctx.sub(eventId, 'teamMissionStates'), recordId)),
      getDoc(doc(this.ctx.sub(eventId, 'missionRoundStates'), boothId)),
    ]);
    const recordData = recordSnap.data({ serverTimestamps: 'estimate' });
    const boothData = boothSnap.data({ serverTimestamps: 'estimate' });
    const record = recordData ? mapTeamMissionRecord(recordId, recordData) : undefined;
    const booth = boothData ? mapBooth(boothId, boothData) : undefined;
    return {
      event,
      record: (id) => (id === recordId ? record : undefined),
      booth: (id) => (id === boothId ? booth : undefined),
      roundStatus: (grade, round) => {
        if (event.activeGrade !== grade || event.activeRound === 0) return 'waiting';
        if (round > event.activeRound) return 'waiting';
        if (round < event.activeRound) return 'closed';
        return event.status === 'active' || event.status === 'paused' ? 'active' : 'scoring';
      },
    };
  }

  // ---- 체크인 ----

  private recordData(record: TeamMissionRecord, checkedInBy: 'team' | 'teacher' | null) {
    return {
      grade: record.grade,
      classId: record.classId,
      teamId: record.teamId,
      teamNo: record.teamNo,
      roundNo: record.roundNo,
      expectedMissionId: record.expectedMissionId,
      actualMissionId: record.actualMissionId,
      wrongStationId: record.wrongStationId,
      manualReview: record.manualReview,
      // 입장 시각은 서버가 기록한다. 기기 시계가 틀려도 미도착 판정이 흔들리지 않는다.
      checkedInAt: record.checkedInAt === null ? null : serverTimestamp(),
      checkedInBy,
      updatedAt: serverTimestamp(),
    };
  }

  async checkIn(input: CheckInInput): Promise<CheckInOutcome> {
    await this.ctx.ensureUser();
    const [team, missions, event] = await Promise.all([
      this.ctx.getTeam(input.eventId, input.teamId),
      this.ctx.missions(input.eventId),
      this.ctx.currentEvent(input.eventId),
    ]);
    const scannedMission = missions.find((mission) => mission.id === input.stationId);
    if (!scannedMission) throw new RepositoryError('not-found', '미션 교실을 찾을 수 없어요.');
    const roundNo = getCheckInRound(event, team.grade);
    if (roundNo === null) {
      throw new RepositoryError(
        'not-allowed',
        '지금은 미션 투어 시간이 아니에요. 선생님 안내를 기다려 주세요.',
      );
    }
    const expectedMission = this.missionForRound(missions, team, roundNo);
    const outcome = (kind: CheckInOutcome['kind'], data: TourData): CheckInOutcome => ({
      kind,
      roundNo,
      scannedMission,
      expectedMission,
      state: this.present(data, team, roundNo, expectedMission),
    });

    const before = await this.directData(input.eventId, event, team, roundNo, expectedMission);
    // 이미 끝낸 미션의 QR을 다시 찍은 경우
    if (this.recordOf(before, team, roundNo, expectedMission).resultId !== null) {
      return outcome('already_checked_in', before);
    }

    const ref = doc(
      this.ctx.sub(input.eventId, 'teamMissionStates'),
      teamMissionStateId(team.classId, team.teamNo, roundNo),
    );
    // 고정 문서 ID + 트랜잭션이라 같은 QR을 여러 번 찍어도 기록은 하나다.
    const attempt = runTransaction(this.ctx.db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      const data = snapshot.data();
      const stored = data
        ? mapTeamMissionRecord(ref.id, data)
        : emptyTeamMissionRecord({
            grade: team.grade,
            classId: team.classId,
            teamId: team.id,
            teamNo: team.teamNo,
            roundNo,
            expectedMissionId: expectedMission.id,
          });
      const next = applyCheckIn(stored, scannedMission.id, this.ctx.serverNow());
      if (next.record !== stored) {
        transaction.set(
          ref,
          this.recordData(next.record, next.kind === 'checked_in' ? 'team' : null),
        );
      }
      return next.kind;
    });
    let kind: CheckInOutcome['kind'];
    try {
      kind = await attempt;
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
      // 거의 동시에 찍은 다른 요청이 먼저 입장을 기록했는지 확인한다.
      const latest = await this.directData(input.eventId, event, team, roundNo, expectedMission);
      if (this.recordOf(latest, team, roundNo, expectedMission).checkedInAt === null) throw error;
      return outcome(
        scannedMission.id === expectedMission.id ? 'already_checked_in' : 'wrong_station',
        latest,
      );
    }
    return outcome(
      kind,
      await this.directData(input.eventId, event, team, roundNo, expectedMission),
    );
  }

  /** QR을 찍지 못한 팀을 교사가 직접 입장 처리한다. */
  async markArrived(input: MarkArrivedInput): Promise<TeamMissionState> {
    await this.ctx.ensureUser();
    this.ctx.requireStationAccess(input.missionId);
    const [team, missions, event] = await Promise.all([
      this.ctx.getTeam(input.eventId, input.teamId),
      this.ctx.missions(input.eventId),
      this.ctx.currentEvent(input.eventId),
    ]);
    const mission = this.missionForRound(missions, team, input.roundNo);
    if (mission.id !== input.missionId) {
      throw new RepositoryError('invalid-input', '이 라운드에 이 교실로 오는 팀이 아니에요.');
    }
    const ref = doc(
      this.ctx.sub(input.eventId, 'teamMissionStates'),
      teamMissionStateId(team.classId, team.teamNo, input.roundNo),
    );
    await runTransaction(this.ctx.db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      const data = snapshot.data();
      const stored = data
        ? mapTeamMissionRecord(ref.id, data)
        : emptyTeamMissionRecord({
            grade: team.grade,
            classId: team.classId,
            teamId: team.id,
            teamNo: team.teamNo,
            roundNo: input.roundNo,
            expectedMissionId: mission.id,
          });
      const next = applyCheckIn(stored, mission.id, this.ctx.serverNow());
      if (next.kind === 'checked_in') transaction.set(ref, this.recordData(next.record, 'teacher'));
    });
    // 입장 현황을 곧바로 다시 읽어도 옛 값이 보이지 않게, 구독 캐시에 반영될 때까지 잠깐 기다린다.
    const live = this.peek(input.eventId, team.grade);
    await live?.waitFor(() =>
      live.records.docs.some((record) => record.id === ref.id && record.checkedInAt !== null),
    );
    const data = await this.directData(input.eventId, event, team, input.roundNo, mission);
    return this.present(data, team, input.roundNo, mission);
  }

  async tourStatus(eventId: string, teamId: string): Promise<TeamTourStatus> {
    await this.ctx.ensureUser();
    const [team, missions, event] = await Promise.all([
      this.ctx.getTeam(eventId, teamId),
      this.ctx.missions(eventId),
      this.ctx.currentEvent(eventId),
    ]);
    const roundNo = getCheckInRound(event, team.grade);
    if (roundNo === null) {
      return { roundNo: null, state: null, expectedMission: null, nextMission: null };
    }
    const expectedMission = this.missionForRound(missions, team, roundNo);
    const data = await this.directData(eventId, event, team, roundNo, expectedMission);
    return {
      roundNo,
      state: this.present(data, team, roundNo, expectedMission),
      expectedMission,
      nextMission:
        roundNo < 5 ? this.missionForRound(missions, team, (roundNo + 1) as RoundNo) : null,
    };
  }

  // ---- 부스 ----

  async missionRound(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): Promise<MissionRoundState> {
    const live = await this.readyLive(eventId, grade);
    return this.presentBooth(live.data(), missionId, grade, roundNo);
  }

  async arrivals(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): Promise<StationArrivals> {
    this.ctx.requireTeacher();
    const [live, missions, teams] = await Promise.all([
      this.readyLive(eventId, grade),
      this.ctx.missions(eventId),
      this.ctx.teams(eventId, grade),
    ]);
    const mission = missions.find((item) => item.id === missionId);
    if (!mission) throw new RepositoryError('not-found', '미션을 찾을 수 없어요.');
    const teamNo = getTeamNoForMission(mission.no, roundNo);
    const data = live.data();
    return {
      booth: this.presentBooth(data, mission.id, grade, roundNo),
      movements: teams
        .filter((team) => team.teamNo === teamNo)
        .map((team) => this.present(data, team, roundNo, mission)),
    };
  }

  async startStation(input: StartStationInput): Promise<MissionRoundState> {
    await this.ctx.ensureUser();
    const teacher = this.ctx.requireStationAccess(input.missionId);
    const boothRef = doc(
      this.ctx.sub(input.eventId, 'missionRoundStates'),
      missionRoundStateId(input.missionId, input.grade, input.roundNo),
    );
    const roundRef = doc(
      this.ctx.sub(input.eventId, 'rounds'),
      roundDocId(input.grade, input.roundNo),
    );
    await runTransaction(this.ctx.db, async (transaction) => {
      const [boothSnap, roundSnap] = await Promise.all([
        transaction.get(boothRef),
        transaction.get(roundRef),
      ]);
      const booth = boothSnap.data();
      // 다시 눌러도 처음 시작 시각을 그대로 쓴다.
      if (booth && (booth.startedAt != null || booth.resultFinalizedAt != null)) return;
      if ((roundSnap.data()?.status as RoundStatus | undefined) !== 'active') {
        throw new RepositoryError(
          'not-allowed',
          '총괄 선생님이 라운드를 시작한 뒤에 미션을 시작할 수 있어요.',
        );
      }
      transaction.set(
        boothRef,
        {
          grade: input.grade,
          missionId: input.missionId,
          roundNo: input.roundNo,
          status: 'active',
          startedAt: serverTimestamp(),
          completedAt: null,
          resultFinalizedAt: null,
          resultTeamIds: [],
          updatedBy: teacher.uid,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    });
    const live = await this.readyLive(input.eventId, input.grade);
    await live.waitFor(() =>
      live.booths.docs.some(
        (booth) =>
          booth.id === boothRef.id &&
          (booth.startedAt !== null || booth.resultFinalizedAt !== null),
      ),
    );
    return this.presentBooth(live.data(), input.missionId, input.grade, input.roundNo);
  }

  // ---- 대시보드 ----

  /** 대시보드에 보여 줄 라운드: 활동 중이면 지금 라운드, 이동 중이면 다음 라운드(입장 확인용) */
  private displayRound(data: TourData, grade: Grade, requested?: RoundNo): RoundNo {
    if (requested) return requested;
    const target = getCheckInRound(data.event, grade);
    if (target !== null) return target;
    if (data.event.activeGrade === grade && data.event.activeRound !== 0) {
      return data.event.activeRound;
    }
    // 이 학년이 지금 진행 중이 아니면 마지막으로 진행한 라운드를 보여 준다.
    const played = ROUND_NUMBERS.filter(
      (roundNo) => data.roundStatus(grade, roundNo) !== 'waiting',
    );
    return played.length > 0 ? played[played.length - 1] : 1;
  }

  async dashboard(eventId: string, grade: Grade, requestedRound?: RoundNo): Promise<OpsDashboard> {
    this.ctx.requireTeacher();
    const [live, missions, classes, teams] = await Promise.all([
      this.readyLive(eventId, grade),
      this.ctx.missions(eventId),
      this.ctx.classes(eventId, grade),
      this.ctx.teams(eventId, grade),
    ]);
    const roundNo = this.displayRound(live.data(), grade, requestedRound);
    await live.watchDashboard(roundNo);
    const data = live.data();

    const cellOf = (team: Team, round: RoundNo): OpsTeamCell => {
      const mission = this.missionForRound(missions, team, round);
      return { team, mission, state: this.present(data, team, round, mission) };
    };
    const teamsOf = (classId: string) =>
      teams.filter((team) => team.classId === classId).sort((a, b) => a.teamNo - b.teamNo);

    const classRows = classes.map((classInfo) => ({
      classInfo,
      cells: teamsOf(classInfo.id).map((team) => cellOf(team, roundNo)),
    }));
    const cells = classRows.flatMap((row) => row.cells);
    const submittedKeys = new Set(
      live.submissionMarks
        .filter((mark) => mark.submitted)
        .map((mark) => `${mark.missionId}|${mark.teamId}`),
    );

    const stations: OpsStation[] = missions.map((mission) => {
      const stationTeams = cells.filter((cell) => cell.mission.id === mission.id);
      return {
        mission,
        round: this.presentBooth(data, mission.id, grade, roundNo),
        teams: stationTeams,
        submitted: stationTeams.filter((cell) => submittedKeys.has(`${mission.id}|${cell.team.id}`))
          .length,
      };
    });

    // 이동 시간에는 다음 라운드를 보여 주므로, 직전 라운드의 결과 미입력도 함께 알린다.
    const previousCells =
      roundNo > 1 && !requestedRound
        ? teams.map((team) => cellOf(team, (roundNo - 1) as RoundNo))
        : [];
    const alerts: OpsAlert[] = [...cells, ...previousCells].flatMap((cell) =>
      cell.state.alertCodes.map((code) => ({
        id: `${cell.state.id}__${code}`,
        code,
        team: cell.team,
        mission: cell.mission,
        roundNo: cell.state.roundNo,
        message: `${cell.team.displayName} · ${cell.state.roundNo}라운드 ${cell.mission.title}(${cell.mission.room}) ${ALERT_LABELS[code]}`,
      })),
    );

    const summary = summarizeTeamStates(cells.map((cell) => cell.state));
    return {
      summary: {
        grade,
        roundNo: data.event.activeGrade === grade && data.event.activeRound === 0 ? 0 : roundNo,
        phase: getRoundPhase(data.event, grade),
        ...summary,
        alertCount: alerts.length,
      },
      stations,
      classRows,
      alerts,
      activity: this.activity(live, data, grade, missions, teams, classes, alerts),
    };
  }

  /**
   * 최근 활동은 따로 저장하지 않고 이미 구독 중인 문서의 시각으로 만든다.
   * 쓰기가 늘지 않고, 같은 일이 두 번 기록될 일도 없다.
   */
  private activity(
    live: OpsLive,
    data: TourData,
    grade: Grade,
    missions: readonly Mission[],
    teams: readonly Team[],
    classes: readonly { id: string; displayName: string }[],
    alerts: readonly OpsAlert[],
  ): ActivityEvent[] {
    const events: ActivityEvent[] = [];
    const missionOf = (id: string | null) => missions.find((mission) => mission.id === id);
    const teamOf = (id: string) => teams.find((team) => team.id === id);
    const push = (event: Omit<ActivityEvent, 'grade'>) => events.push({ ...event, grade });

    for (const record of live.records.docs) {
      const team = teamOf(record.teamId);
      const expected = missionOf(record.expectedMissionId);
      if (!team || !expected) continue;
      if (record.checkedInAt !== null) {
        push({
          id: `check_in__${record.id}`,
          type: 'check_in',
          message: `${team.displayName} · ${expected.room}(${expected.title}) 입장`,
          classId: team.classId,
          teamId: team.id,
          missionId: expected.id,
          roundNo: record.roundNo,
          at: record.checkedInAt,
        });
      } else if (record.wrongStationId !== null) {
        const scanned = missionOf(record.wrongStationId);
        push({
          id: `wrong__${record.id}__${record.wrongStationId}`,
          type: 'wrong_station',
          message: `${team.displayName} · ${scanned?.room ?? '다른 교실'}에 잘못 입장(가야 할 곳: ${expected.room})`,
          classId: team.classId,
          teamId: team.id,
          missionId: record.wrongStationId,
          roundNo: record.roundNo,
          at: record.updatedAt,
        });
      }
    }

    for (const booth of live.booths.docs) {
      const mission = missionOf(booth.missionId);
      if (!mission) continue;
      const base = { classId: null, teamId: null, missionId: mission.id, roundNo: booth.roundNo };
      if (booth.startedAt !== null) {
        push({
          ...base,
          id: `start__${booth.id}`,
          type: 'mission_started',
          message: `${booth.roundNo}라운드 ${mission.title} 미션 시작`,
          at: booth.startedAt,
        });
      }
      if (booth.resultFinalizedAt !== null) {
        push({
          ...base,
          id: `result__${booth.id}`,
          type: 'result_finalized',
          message: `${booth.roundNo}라운드 ${mission.title} 결과 확정(${booth.resultTeamIds.length}팀)`,
          at: booth.resultFinalizedAt,
        });
      }
    }

    for (const round of live.rounds.docs) {
      if (round.startedAt === null) continue;
      push({
        id: `round_start__g${grade}_r${round.roundNo}`,
        type: 'round_changed',
        message: `${grade}학년 ${round.roundNo}라운드 시작`,
        classId: null,
        teamId: null,
        missionId: null,
        roundNo: round.roundNo,
        at: round.startedAt,
      });
    }
    if (data.event.activeGrade === grade && data.event.roundEndedAt !== null) {
      const ended = data.event.activeRound;
      push({
        id: `round_end__g${grade}_r${ended}`,
        type: 'round_changed',
        message: `${grade}학년 ${ended}라운드 종료`,
        classId: null,
        teamId: null,
        missionId: null,
        roundNo: ended === 0 ? null : ended,
        at: data.event.roundEndedAt,
      });
    }

    // 카드 조각 획득과 카드 완성(같은 종류의 네 번째 조각)
    const claimed = live.awardDocs
      .filter((award) => award.status === 'claimed' && award.selectedType && award.claimedAt)
      .sort((a, b) => (a.claimedAt ?? 0) - (b.claimedAt ?? 0));
    const counts = new Map<string, number>();
    for (const award of claimed) {
      const cardType = award.selectedType;
      const team = teamOf(award.teamId);
      if (!cardType || !team) continue;
      const key = `${award.classId}|${cardType}`;
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      const name = CARD_INFO[cardType].name;
      const at = award.claimedAt ?? 0;
      push({
        id: `card__${award.id}`,
        type: 'card_earned',
        message: `${team.displayName} · ${name} 조각 획득(${Math.min(count, CARD_PIECES)}/${CARD_PIECES}${
          count > CARD_PIECES ? `, 중복 +${count - CARD_PIECES}` : ''
        })`,
        classId: award.classId,
        teamId: team.id,
        missionId: null,
        roundNo: null,
        at,
      });
      if (count === CARD_PIECES) {
        const className = classes.find((item) => item.id === award.classId)?.displayName ?? '';
        push({
          id: `card_done__${award.classId}__${cardType}`,
          type: 'card_completed',
          message: `${className} · ${name} 완성!`,
          classId: award.classId,
          teamId: null,
          missionId: null,
          roundNo: null,
          // 조각 획득 바로 위에 보이게 한다.
          at: at + 1,
        });
      }
    }

    // 미도착·결과 미입력 경고는 경고가 시작된 시각으로 기록한다.
    const now = this.ctx.serverNow();
    for (const alert of alerts) {
      if (alert.code === 'wrong_station') continue;
      let at = now;
      if (alert.code === 'not_arrived') {
        const startedAt = live.roundStartedAt(alert.roundNo);
        if (startedAt !== null) at = Math.min(now, startedAt + CHECK_IN_GRACE_MS);
      } else if (alert.code === 'result_missing' && data.event.roundEndedAt !== null) {
        at = Math.min(now, data.event.roundEndedAt + data.event.moveDurationMs);
      }
      push({
        id: `alert__${alert.id}`,
        type: 'alert',
        message: `확인 필요: ${alert.message}`,
        classId: alert.team.classId,
        teamId: alert.team.id,
        missionId: alert.mission.id,
        roundNo: alert.roundNo,
        at,
      });
    }

    // 최종 미션: 열림, 반별 시작과 제출, 결과 공개
    const final = live.final;
    const session = final.session.openedAt === null ? emptyFinalSession(grade) : final.session;
    if (session.openedAt !== null) {
      push({
        id: `final_open__g${grade}`,
        type: 'final_opened',
        message: session.forceOpenReason
          ? `${grade}학년 최종 미션 열림(강제: ${session.forceOpenReason})`
          : `${grade}학년 최종 미션 열림`,
        classId: null,
        teamId: null,
        missionId: null,
        roundNo: null,
        at: session.openedAt,
      });
    }
    for (const state of final.states) {
      const className = classes.find((item) => item.id === state.classId)?.displayName ?? '';
      const base = { classId: state.classId, teamId: null, missionId: null, roundNo: null };
      if (state.startedAt !== null) {
        push({
          ...base,
          id: `final_start__${state.classId}__${state.startedAt}`,
          type: 'final_started',
          message: `${className} 최종 미션 시작(힌트 ${state.hintTotal}개)`,
          at: state.startedAt,
        });
      }
      if (state.submittedAt !== null) {
        push({
          ...base,
          id: `final_submit__${state.classId}__${state.startedAt}`,
          type: 'final_submitted',
          // 점수는 공개 전이라 기록에 남기지 않는다.
          message: `${className} 최종 미션 ${
            state.status === 'timeout' ? '시간 마감' : '제출'
          }(${formatClock((state.durationMs ?? 0) / 1000)})`,
          at: state.submittedAt,
        });
      }
    }
    if (session.resultsPublishedAt !== null) {
      push({
        id: `publish__g${grade}`,
        type: 'results_published',
        message: `${grade}학년 최종 결과 공개`,
        classId: null,
        teamId: null,
        missionId: null,
        roundNo: null,
        at: session.resultsPublishedAt,
      });
    }

    return events.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id)).slice(0, ACTIVITY_LIMIT);
  }

  /** 학급 상세의 팀별 위치·순위·카드. 구독 중인 학년이면 캐시를, 아니면 필요한 문서만 읽는다. */
  async classTeams(
    eventId: string,
    classId: string,
    grade: Grade,
    awards: readonly CardAward[],
  ): Promise<ClassOpsTeam[]> {
    const [missions, allTeams, event] = await Promise.all([
      this.ctx.missions(eventId),
      this.ctx.teams(eventId, grade),
      this.ctx.currentEvent(eventId),
    ]);
    const teams = allTeams
      .filter((team) => team.classId === classId)
      .sort((a, b) => a.teamNo - b.teamNo);
    if (teams.length === 0) return [];

    const results = (
      await getDocs(
        query(
          this.ctx.sub(eventId, 'results'),
          where(
            'teamId',
            'in',
            teams.map((team) => team.id),
          ),
        ),
      )
    ).docs.map((snapshot) => mapResult(snapshot));

    const roundNo = getCheckInRound(event, grade);
    const live = this.peek(eventId, grade);
    if (live) await live.ready().catch(() => undefined);

    return Promise.all(
      teams.map(async (team) => {
        let state: TeamMissionState | null = null;
        let currentMission: Mission | null = null;
        if (roundNo !== null) {
          currentMission = this.missionForRound(missions, team, roundNo);
          const data =
            live && live.event.value
              ? live.data()
              : await this.directData(eventId, event, team, roundNo, currentMission);
          state = this.present(data, team, roundNo, currentMission);
        }
        const teamResults = results
          .filter((result) => result.teamId === team.id)
          .sort((a, b) => a.roundNo - b.roundNo);
        return {
          team,
          currentMission,
          nextMission:
            roundNo !== null && roundNo < 5
              ? this.missionForRound(missions, team, (roundNo + 1) as RoundNo)
              : null,
          state,
          completedCount: teamResults.length,
          results: ROUND_NUMBERS.map((round) => ({
            roundNo: round,
            mission: this.missionForRound(missions, team, round),
            rank: teamResults.find((item) => item.roundNo === round)?.rank ?? null,
          })),
          earnedTypes: awards.flatMap((award) =>
            award.teamId === team.id && award.status === 'claimed' && award.selectedType
              ? [award.selectedType]
              : [],
          ),
        };
      }),
    );
  }
}
