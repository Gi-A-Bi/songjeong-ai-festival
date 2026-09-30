import {
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentData,
} from 'firebase/firestore';
import { CHECK_IN_GRACE_MS, RESULT_GRACE_MS } from '../../config';
import {
  canCheckInAtBooth,
  getBoothActionBlocker,
  getBoothClock,
  getBoothCurrentRound,
  getBoothEndsAt,
  getBoothStatus,
  getNextBoothChangeAt,
  getTeamCurrentRound,
  scopeEventToTeam,
  type BoothAction,
} from '../../domain/boothRound';
import { CARD_PIECES } from '../../domain/cards';
import { CARD_INFO } from '../../domain/catalog';
import { emptyFinalSession } from '../../domain/finalMission';
import {
  getMissionNoForRound,
  getRoundForMission,
  getTeamNoForMission,
  ROUND_NUMBERS,
} from '../../domain/rotation';
import {
  ALERT_LABELS,
  applyCheckIn,
  applyResultFinalized,
  emptyTeamMissionRecord,
  getCheckInRound,
  getTourPhase,
  missionRoundStateId,
  presentMissionRound,
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
  MissionNo,
  MissionRoundState,
  RoundNo,
  Team,
  TeamMissionState,
} from '../../domain/types';
import { missionRoom } from '../../domain/missionRoom';
import { isValidStationCode, normalizeStationCode } from '../../domain/stationCode';
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
  mapTeamMissionRecord,
  newBoothFields,
  type BoothDoc,
} from './mappers';

const ACTIVITY_LIMIT = 30;

const ACTION_LABELS: Record<BoothAction, string> = {
  open: '라운드 열기',
  start: '게임 시작',
  close: '라운드 종료',
  skip: '라운드 건너뛰기',
};

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
}

function boothsById(booths: readonly BoothDoc[]): (id: string) => BoothDoc | undefined {
  const byId = new Map(booths.map((item) => [item.id, item]));
  return (id) => byId.get(id);
}

/**
 * 한 팀이 도는 다섯 부스의 구독. 부스 문서는 선생님이 라운드를 열고, 게임을 시작하고,
 * 순위를 확정하고, 라운드를 종료할 때만 바뀌어 학생 기기가 받는 읽기가 작다.
 */
class TeamLive extends LiveGroup {
  readonly booths: LiveQuery<BoothDoc>;

  constructor(ctx: FirestoreStoreContext, eventId: string, boothIds: string[], onIdle: () => void) {
    super(onIdle);
    this.booths = this.track(
      new LiveQuery(
        query(ctx.sub(eventId, 'missionRoundStates'), where(documentId(), 'in', boothIds)),
        (snapshot, data) => mapBooth(snapshot.id, data),
        () => this.notifier.bump(),
        // 끊긴 구독은 다시 살아나지 않는다. 묶음을 닫아 다음에 새로 붙게 한다.
        () => this.stop(),
      ),
    );
  }
}

/**
 * 한 학년의 팀 이동·부스 구독 묶음.
 * 팀 상태 문서는 QR 체크인 때만, 부스 문서는 라운드 단계가 바뀔 때만 바뀌므로
 * 구독으로 받는 읽기는 "바뀐 문서 수 × 보고 있는 교사 수"에 그친다.
 */
class OpsLive extends LiveGroup {
  readonly event: LiveDoc<FestivalEvent>;
  readonly records: LiveQuery<TeamMissionRecord>;
  readonly booths: LiveQuery<BoothDoc>;
  private submissions: LiveQuery<SubmissionMark> | null = null;
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
    // 끊긴 구독은 다시 살아나지 않는다. 옛 자료를 계속 쓰지 않게 묶음을 닫아 다음에 새로 붙게 한다.
    const fail = () => this.stop();
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
  }

  /**
   * 대시보드에서만 쓰는 구독: 학년의 제출물, 카드 보상, 최종 미션 상태.
   * 부스마다 라운드가 달라 제출물은 학년 전체를 본다(팀 25개 × 미션 5개가 가장 많을 때다).
   */
  async watchDashboard(): Promise<void> {
    const bump = () => this.notifier.bump();
    const fail = () => undefined;
    this.submissions ??= this.track(
      new LiveQuery(
        query(this.ctx.sub(this.eventId, 'submissions'), where('grade', '==', this.grade)),
        (_snapshot, data) => ({
          missionId: String(data.missionId),
          teamId: String(data.teamId),
          submitted: data.status !== 'draft' && typeof data.answer === 'object',
        }),
        bump,
        fail,
      ),
    );
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
    return this.submissions?.docs ?? [];
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
    return {
      event,
      record: (id) => records.get(id),
      booth: boothsById(this.booths.docs),
    };
  }
}

/** 팀 이동(QR 체크인), 부스 상태, 운영 대시보드의 Firestore 구현 */
export class FirestoreTourStore {
  private readonly ctx: FirestoreStoreContext;
  private readonly lives = new Map<string, OpsLive>();
  private readonly teamLives = new Map<string, TeamLive>();

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
    for (const live of [...this.teamLives.values()]) live.stop();
  }

  // ---- 한 팀이 보는 행사 상태 ----

  /** 팀이 1~5라운드에 가는 부스 문서의 ID */
  private teamBoothIds(missions: readonly Mission[], team: Team): string[] {
    return ROUND_NUMBERS.map((roundNo) =>
      missionRoundStateId(this.missionForRound(missions, team, roundNo).id, team.grade, roundNo),
    );
  }

  private boothLookup(
    missions: readonly Mission[],
    grade: Grade,
    boothOf: (id: string) => BoothDoc | undefined,
  ) {
    return (missionNo: MissionNo, roundNo: RoundNo) => {
      const mission = missions.find((item) => item.no === missionNo);
      return mission ? boothOf(missionRoundStateId(mission.id, grade, roundNo)) : undefined;
    };
  }

  /** 그 라운드에 이 팀의 순위가 나왔는지. 부스 문서에 적힌 순위 확정 팀으로 안다. */
  private rankedLookup(
    missions: readonly Mission[],
    team: Team,
    boothOf: (id: string) => BoothDoc | undefined,
  ) {
    return (roundNo: RoundNo) => {
      const mission = this.missionForRound(missions, team, roundNo);
      const booth = boothOf(missionRoundStateId(mission.id, team.grade, roundNo));
      return booth?.resultTeamIds.includes(team.id) ?? false;
    };
  }

  /** 구독 중이면 캐시를, 아니면 한 번 읽는다(많아야 다섯 문서). */
  private async teamBooths(
    eventId: string,
    team: Team,
    missions: readonly Mission[],
  ): Promise<readonly BoothDoc[]> {
    const live = this.teamLives.get(`${eventId}|${team.id}`);
    if (live && !live.isStopped) {
      try {
        await live.ready();
        return live.booths.docs;
      } catch {
        // 구독이 끊겼으면 아래에서 직접 읽는다.
      }
    }
    const snapshot = await getDocs(
      query(
        this.ctx.sub(eventId, 'missionRoundStates'),
        where(documentId(), 'in', this.teamBoothIds(missions, team)),
      ),
    );
    return snapshot.docs.map((item) =>
      mapBooth(item.id, item.data({ serverTimestamps: 'estimate' })),
    );
  }

  /** 한 팀이 보는 행사 상태. 팀이 지금 가야 하는 부스의 단계로 채운다. */
  private async teamEvent(
    eventId: string,
    team: Team,
    missions: readonly Mission[],
    event: FestivalEvent,
  ): Promise<FestivalEvent> {
    const boothOf = boothsById(await this.teamBooths(eventId, team, missions));
    return scopeEventToTeam(
      event,
      team,
      this.boothLookup(missions, team.grade, boothOf),
      this.ctx.serverNow(),
      this.rankedLookup(missions, team, boothOf),
    );
  }

  /**
   * 팀 화면용 구독. 행사 문서와 팀이 도는 다섯 부스 문서가 바뀔 때,
   * 그리고 게임 시간이 끝나는 순간에 팀이 보는 상태를 다시 알린다.
   */
  subscribeTeam(
    eventId: string,
    teamId: string,
    subscribeEvent: (onEvent: (event: FestivalEvent) => void) => Unsubscribe,
    onChange: (event: FestivalEvent) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    const key = `${eventId}|${teamId}`;
    let stopped = false;
    let event: FestivalEvent | null = null;
    let source: { team: Team; missions: Mission[]; live: TeamLive } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let remove: () => void = () => undefined;
    let last = '';

    const emit = () => {
      if (stopped || !event || !source) return;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const now = this.ctx.serverNow();
      const booths = source.live.booths.docs;
      const boothOf = boothsById(booths);
      const scoped = scopeEventToTeam(
        event,
        source.team,
        this.boothLookup(source.missions, source.team.grade, boothOf),
        now,
        this.rankedLookup(source.missions, source.team, boothOf),
      );
      const signature = JSON.stringify(scoped);
      if (signature !== last) {
        last = signature;
        onChange(scoped);
      }
      // 게임 시간이 끝나는 순간에는 문서가 바뀌지 않으므로 그때 다시 계산한다.
      const nextAt = getNextBoothChangeAt(booths, now);
      if (nextAt !== null) timer = setTimeout(emit, Math.max(0, nextAt - now) + 50);
    };

    const stopEvent = subscribeEvent((value) => {
      event = value;
      emit();
    });
    void (async () => {
      await this.ctx.ensureUser();
      const [team, missions] = await Promise.all([
        this.ctx.getTeam(eventId, teamId),
        this.ctx.missions(eventId),
      ]);
      if (stopped) return;
      let live = this.teamLives.get(key);
      if (!live || live.isStopped) {
        live = new TeamLive(this.ctx, eventId, this.teamBoothIds(missions, team), () =>
          this.teamLives.delete(key),
        );
        this.teamLives.set(key, live);
      }
      live.touch();
      try {
        await live.ready();
      } catch (error) {
        live.stop();
        throw error;
      }
      if (stopped) {
        live.touch();
        return;
      }
      source = { team, missions, live };
      remove = live.notifier.add(emit);
      live.touch();
      emit();
    })().catch(onError);

    return () => {
      stopped = true;
      stopEvent();
      remove();
      if (timer !== null) clearTimeout(timer);
      this.teamLives.get(key)?.touch();
    };
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
   * 부스가 게임을 시작했으면 입장한 팀은 진행 중, 순위를 확정한 팀은 완료다.
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
    const clock = getBoothClock(
      data.booth(missionRoundStateId(mission.id, team.grade, roundNo)),
      this.ctx.serverNow(),
    );
    return presentTeamMissionState(this.recordOf(data, team, roundNo, mission), clock);
  }

  private boothStatus(data: TourData, mission: Mission, grade: Grade, roundNo: RoundNo) {
    return getBoothStatus(
      data.booth(missionRoundStateId(mission.id, grade, roundNo)),
      this.ctx.serverNow(),
    );
  }

  private presentBooth(
    data: TourData,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): MissionRoundState {
    const id = missionRoundStateId(missionId, grade, roundNo);
    const stored = data.booth(id);
    return presentMissionRound(
      { id, grade, missionId, roundNo },
      stored,
      stored?.updatedBy ?? null,
      this.ctx.serverNow(),
    );
  }

  /** 구독 없이 한 팀·한 라운드의 체크인 기록과 부스 문서만 읽는다(학생 기기용). */
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
    };
  }

  /** 구독 중이 아닌 학년의 학급 상세를 볼 때: 학년의 부스 문서와 학급의 체크인 기록을 한 번 읽는다. */
  private async classData(
    eventId: string,
    event: FestivalEvent,
    grade: Grade,
    classId: string,
  ): Promise<TourData> {
    const [booths, recordSnap] = await Promise.all([
      this.gradeBooths(eventId, grade),
      getDocs(query(this.ctx.sub(eventId, 'teamMissionStates'), where('classId', '==', classId))),
    ]);
    const records = new Map(
      recordSnap.docs.map((item) => [
        item.id,
        mapTeamMissionRecord(item.id, item.data({ serverTimestamps: 'estimate' })),
      ]),
    );
    return { event, record: (id) => records.get(id), booth: boothsById(booths) };
  }

  /** 한 학년의 부스 문서. 구독 중이면 캐시를, 아니면 한 번 읽는다(많아야 25개). */
  private async gradeBooths(eventId: string, grade: Grade): Promise<readonly BoothDoc[]> {
    const live = this.peek(eventId, grade);
    if (live && !live.isStopped) {
      try {
        await live.ready();
        return live.booths.docs;
      } catch {
        // 구독이 끊겼으면 아래에서 직접 읽는다.
      }
    }
    const snapshot = await getDocs(
      query(this.ctx.sub(eventId, 'missionRoundStates'), where('grade', '==', grade)),
    );
    return snapshot.docs.map((item) =>
      mapBooth(item.id, item.data({ serverTimestamps: 'estimate' })),
    );
  }

  /** 이 학년에 열어 두고 아직 종료하지 않은 부스가 있는지(학년을 바꾸기 전에 확인한다) */
  async hasOpenBooth(eventId: string, grade: Grade): Promise<boolean> {
    const now = this.ctx.serverNow();
    return (await this.gradeBooths(eventId, grade)).some((booth) => {
      const status = getBoothStatus(booth, now);
      return status !== 'ready' && status !== 'completed';
    });
  }

  // ---- 체크인 ----

  private recordData(
    record: TeamMissionRecord,
    checkedInBy: 'team' | 'teacher',
    accessCode: string | null = null,
  ) {
    return {
      grade: record.grade,
      classId: record.classId,
      teamId: record.teamId,
      teamNo: record.teamNo,
      roundNo: record.roundNo,
      expectedMissionId: record.expectedMissionId,
      actualMissionId: record.actualMissionId,
      wrongStationId: null,
      manualReview: record.manualReview,
      // 입장 시각은 서버가 기록한다. 기기 시계가 틀려도 미도착 판정이 흔들리지 않는다.
      checkedInAt: serverTimestamp(),
      checkedInBy,
      // 학생이 넣은 인증코드. 보안 규칙이 교실 코드와 견주어 맞을 때만 기록을 받는다.
      ...(accessCode === null ? {} : { accessCode }),
      updatedAt: serverTimestamp(),
    };
  }

  /**
   * 교실 인증코드로 입장한다. 코드는 교사만 읽을 수 있어 학생 기기는 미리 견주지 못하고,
   * 보안 규칙이 기록을 받을 때 교실 코드와 견준다. 거부되면 코드가 다른 것으로 안내한다.
   */
  async checkIn(input: CheckInInput): Promise<CheckInOutcome> {
    const user = await this.ctx.ensureUser();
    const [team, missions, event, session] = await Promise.all([
      this.ctx.getTeam(input.eventId, input.teamId),
      this.ctx.missions(input.eventId),
      this.ctx.currentEvent(input.eventId),
      getDoc(doc(this.ctx.sub(input.eventId, 'sessions'), user.uid)),
    ]);
    // 다른 팀에 묶인 기기는 보안 규칙이 거부한다. 거부 이유를 "코드가 다르다"로 잘못 알리지 않게 먼저 확인한다.
    if (session.data()?.teamId !== input.teamId) {
      throw new RepositoryError(
        'not-allowed',
        '이 기기가 입장한 팀이 아니에요. 팀 QR로 다시 입장해 주세요.',
      );
    }
    const mission = missions.find((item) => item.id === input.stationId);
    if (!mission) throw new RepositoryError('not-found', '미션 교실을 찾을 수 없어요.');
    const roundNo = getCheckInRound(
      await this.teamEvent(input.eventId, team, missions, event),
      team.grade,
    );
    if (roundNo === null) {
      throw new RepositoryError(
        'not-allowed',
        '지금은 미션 투어 시간이 아니에요. 선생님 안내를 기다려 주세요.',
      );
    }
    const expectedMission = this.missionForRound(missions, team, roundNo);
    if (mission.id !== expectedMission.id) {
      throw new RepositoryError(
        'not-allowed',
        getRoundForMission(team.teamNo, mission.no) < roundNo
          ? `이미 지나간 미션이에요. 우리 팀은 지금 ${roundNo}라운드 ${missionRoom(expectedMission, team.grade)}으로 가요.`
          : `아직 차례가 아닌 미션이에요. 우리 팀은 지금 ${roundNo}라운드 ${missionRoom(expectedMission, team.grade)}으로 가요.`,
      );
    }
    const outcome = (kind: CheckInOutcome['kind'], data: TourData): CheckInOutcome => ({
      kind,
      roundNo,
      mission,
      state: this.present(data, team, roundNo, mission),
    });

    const before = await this.directData(input.eventId, event, team, roundNo, mission);
    const stored = this.recordOf(before, team, roundNo, mission);
    // 이번 라운드 순위가 이미 나왔거나 이미 입장했으면 그대로 둔다.
    if (stored.resultId !== null || stored.checkedInAt !== null) {
      return outcome('already_checked_in', before);
    }
    if (!canCheckInAtBooth(this.boothStatus(before, mission, team.grade, roundNo))) {
      throw new RepositoryError(
        'not-allowed',
        '선생님이 라운드를 열면 들어갈 수 있어요. 교실 앞에서 잠깐 기다려 주세요.',
      );
    }
    const accessCode = normalizeStationCode(input.accessCode);
    if (!isValidStationCode(accessCode)) {
      throw new RepositoryError('invalid-input', '인증코드 숫자 네 자리를 모두 넣어 주세요.');
    }

    const ref = doc(
      this.ctx.sub(input.eventId, 'teamMissionStates'),
      teamMissionStateId(team.classId, team.teamNo, roundNo),
    );
    // 고정 문서 ID + 트랜잭션이라 같은 팀이 여러 번 넣어도 기록은 하나다.
    const attempt = runTransaction(this.ctx.db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      const data = snapshot.data();
      const current = data
        ? mapTeamMissionRecord(ref.id, data)
        : emptyTeamMissionRecord({
            grade: team.grade,
            classId: team.classId,
            teamId: team.id,
            teamNo: team.teamNo,
            roundNo,
            expectedMissionId: mission.id,
          });
      const next = applyCheckIn(current, mission.id, this.ctx.serverNow());
      if (next.kind === 'checked_in') {
        transaction.set(ref, this.recordData(next.record, 'team', accessCode));
      }
      return next.kind === 'checked_in' ? 'checked_in' : 'already_checked_in';
    });
    let kind: CheckInOutcome['kind'];
    try {
      kind = await attempt;
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
      // 거의 동시에 넣은 다른 요청이 먼저 입장을 기록했는지 확인한다.
      const latest = await this.directData(input.eventId, event, team, roundNo, mission);
      if (this.recordOf(latest, team, roundNo, mission).checkedInAt !== null) {
        return outcome('already_checked_in', latest);
      }
      // 부스가 열려 있는데도 거부됐으면 인증코드가 다른 것이다(총괄이 코드를 정하지 않은 때도 같다).
      throw new RepositoryError(
        'invalid-input',
        '인증코드가 달라요. 교실 선생님께 인증코드를 다시 확인해 주세요.',
      );
    }
    return outcome(kind, await this.directData(input.eventId, event, team, roundNo, mission));
  }

  /** 인증코드를 넣지 못한 팀을 교사가 직접 입장 처리한다. */
  async markArrived(input: MarkArrivedInput): Promise<TeamMissionState> {
    await this.ctx.ensureUser();
    this.ctx.requireTeacher();
    const [team, missions, event] = await Promise.all([
      this.ctx.getTeam(input.eventId, input.teamId),
      this.ctx.missions(input.eventId),
      this.ctx.currentEvent(input.eventId),
    ]);
    const mission = this.missionForRound(missions, team, input.roundNo);
    if (mission.id !== input.missionId) {
      throw new RepositoryError('invalid-input', '이 라운드에 이 교실로 오는 팀이 아니에요.');
    }
    const before = await this.directData(input.eventId, event, team, input.roundNo, mission);
    if (this.boothStatus(before, mission, team.grade, input.roundNo) === 'completed') {
      throw new RepositoryError('not-allowed', '이미 종료한 라운드예요.');
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
    const roundNo = getCheckInRound(
      await this.teamEvent(eventId, team, missions, event),
      team.grade,
    );
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

  /** 이 부스의 1~5라운드 상태 */
  async stationRounds(
    eventId: string,
    missionId: string,
    grade: Grade,
  ): Promise<MissionRoundState[]> {
    this.ctx.requireTeacher();
    const live = await this.readyLive(eventId, grade);
    const data = live.data();
    return ROUND_NUMBERS.map((roundNo) => this.presentBooth(data, missionId, grade, roundNo));
  }

  /** 라운드 열기 → 게임 시작 → 라운드 종료. 같은 단계를 다시 눌러도 처음 기록을 그대로 둔다. */
  async advanceStation(action: BoothAction, input: StartStationInput): Promise<MissionRoundState> {
    await this.ctx.ensureUser();
    const teacher = this.ctx.requireTeacher();
    const [missions, event] = await Promise.all([
      this.ctx.missions(input.eventId),
      this.ctx.currentEvent(input.eventId),
    ]);
    const mission = missions.find((item) => item.id === input.missionId);
    if (!mission) throw new RepositoryError('not-found', '미션을 찾을 수 없어요.');
    const booths = this.ctx.sub(input.eventId, 'missionRoundStates');
    const boothRef = doc(booths, missionRoundStateId(mission.id, input.grade, input.roundNo));
    const previousRef =
      input.roundNo === 1
        ? null
        : doc(booths, missionRoundStateId(mission.id, input.grade, (input.roundNo - 1) as RoundNo));
    const isDone = (booth: BoothDoc | undefined) =>
      booth !== undefined &&
      ((action === 'open' && booth.openedAt !== null) ||
        (action === 'start' && booth.startedAt !== null) ||
        ((action === 'close' || action === 'skip') && booth.completedAt !== null));

    await runTransaction(this.ctx.db, async (transaction) => {
      const [boothSnap, previousSnap] = await Promise.all([
        transaction.get(boothRef),
        previousRef ? transaction.get(previousRef) : null,
      ]);
      const stored = boothSnap.data({ serverTimestamps: 'estimate' });
      const booth = stored ? mapBooth(boothRef.id, stored) : undefined;
      if (isDone(booth)) return;

      const previousData = previousSnap?.data({ serverTimestamps: 'estimate' });
      const blocker = getBoothActionBlocker(action, {
        status: getBoothStatus(booth, this.ctx.serverNow()),
        touring: event.activeGrade === input.grade,
        previousCompleted:
          previousRef === null ||
          (previousData !== undefined &&
            mapBooth(previousRef.id, previousData).completedAt !== null),
        rankingFinalized: (booth?.resultFinalizedAt ?? null) !== null,
      });
      if (blocker) throw new RepositoryError('not-allowed', blocker);

      // 시각은 서버가 기록한다. 기기 시계가 틀려도 모든 화면의 타이머가 같다.
      const changes =
        action === 'open'
          ? { openedAt: serverTimestamp() }
          : action === 'start'
            ? { startedAt: serverTimestamp(), durationMs: event.gameDurationMs }
            : action === 'skip'
              ? { completedAt: serverTimestamp(), skipped: true }
              : { completedAt: serverTimestamp() };
      transaction.set(
        boothRef,
        {
          ...(stored ? {} : newBoothFields(event.gameDurationMs)),
          grade: input.grade,
          missionId: mission.id,
          roundNo: input.roundNo,
          ...changes,
          updatedBy: teacher.uid,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    });
    const live = await this.readyLive(input.eventId, input.grade);
    await live.waitFor(() => isDone(live.booths.docs.find((booth) => booth.id === boothRef.id)));
    return this.presentBooth(live.data(), mission.id, input.grade, input.roundNo);
  }

  // ---- 대시보드 ----

  /**
   * roundNo를 주면 그 라운드의 모습을, 주지 않으면 지금 모습을 보여 준다.
   * 부스마다 따로 진행하므로 지금 모습에서는 부스와 팀이 저마다 자기 라운드에 있다.
   */
  async dashboard(eventId: string, grade: Grade, requestedRound?: RoundNo): Promise<OpsDashboard> {
    this.ctx.requireTeacher();
    const [live, missions, classes, teams] = await Promise.all([
      this.readyLive(eventId, grade),
      this.ctx.missions(eventId),
      this.ctx.classes(eventId, grade),
      this.ctx.teams(eventId, grade),
    ]);
    await live.watchDashboard();
    const data = live.data();
    const now = this.ctx.serverNow();
    const boothOf = (missionId: string, roundNo: RoundNo) =>
      data.booth(missionRoundStateId(missionId, grade, roundNo));
    const lookup = this.boothLookup(missions, grade, data.booth);

    const cellOf = (team: Team, round: RoundNo): OpsTeamCell => {
      const mission = this.missionForRound(missions, team, round);
      return { team, mission, state: this.present(data, team, round, mission) };
    };
    const teamsOf = (classId: string) =>
      teams.filter((team) => team.classId === classId).sort((a, b) => a.teamNo - b.teamNo);

    const classRows = classes.map((classInfo) => ({
      classInfo,
      cells: teamsOf(classInfo.id).map((team) =>
        cellOf(
          team,
          requestedRound ??
            getTeamCurrentRound(
              team.teamNo,
              lookup,
              this.rankedLookup(missions, team, data.booth),
            ) ??
            5,
        ),
      ),
    }));
    const submittedKeys = new Set(
      live.submissionMarks
        .filter((mark) => mark.submitted)
        .map((mark) => `${mark.missionId}|${mark.teamId}`),
    );

    const stations: OpsStation[] = missions.map((mission) => {
      const roundNo =
        requestedRound ?? getBoothCurrentRound((round) => boothOf(mission.id, round)) ?? 5;
      const teamNo = getTeamNoForMission(mission.no, roundNo);
      const stationTeams = teams
        .filter((team) => team.teamNo === teamNo)
        .map((team) => cellOf(team, roundNo));
      return {
        mission,
        round: this.presentBooth(data, mission.id, grade, roundNo),
        teams: stationTeams,
        submitted: stationTeams.filter((cell) => submittedKeys.has(`${mission.id}|${cell.team.id}`))
          .length,
      };
    });

    const seen = new Set<string>();
    const watched = [
      ...classRows.flatMap((row) => row.cells),
      ...stations.flatMap((station) => station.teams),
    ].filter((cell) => {
      if (seen.has(cell.state.id)) return false;
      seen.add(cell.state.id);
      return true;
    });
    const alerts: OpsAlert[] = watched.flatMap((cell) =>
      cell.state.alertCodes.map((code) => ({
        id: `${cell.state.id}__${code}`,
        code,
        team: cell.team,
        mission: cell.mission,
        roundNo: cell.state.roundNo,
        message: `${cell.team.displayName} · ${cell.state.roundNo}라운드 ${cell.mission.title}(${missionRoom(cell.mission, grade)}) ${ALERT_LABELS[code]}`,
      })),
    );

    const statuses = missions.flatMap((mission) =>
      ROUND_NUMBERS.map((roundNo) => getBoothStatus(boothOf(mission.id, roundNo), now)),
    );
    const started = statuses.some((status) => status !== 'ready');
    // 부스마다 라운드가 다를 수 있어 가장 늦은 부스의 라운드를 대표로 쓴다.
    const slowestRound = stations.reduce<RoundNo>(
      (slowest, station) => (station.round.roundNo < slowest ? station.round.roundNo : slowest),
      5,
    );
    const summary = summarizeTeamStates(classRows.flatMap((row) => row.cells).map((c) => c.state));
    return {
      summary: {
        grade,
        roundNo: requestedRound ?? (started ? slowestRound : 0),
        phase: getTourPhase(statuses),
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
          message: `${team.displayName} · ${missionRoom(expected, grade)}(${expected.title}) 입장`,
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
          message: `${team.displayName} · ${scanned ? missionRoom(scanned, grade) : '다른 교실'}에 잘못 입장(가야 할 곳: ${missionRoom(expected, grade)})`,
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
      const label = `${mission.title}(${missionRoom(mission, grade)}) ${booth.roundNo}라운드`;
      // 예전 문서는 연 시각이 시작 시각과 같다. 같은 시각의 기록을 두 번 남기지 않는다.
      if (booth.openedAt !== null && booth.openedAt !== booth.startedAt) {
        push({
          ...base,
          id: `open__${booth.id}`,
          type: 'mission_started',
          message: `${label} · ${ACTION_LABELS.open}`,
          at: booth.openedAt,
        });
      }
      if (booth.startedAt !== null) {
        push({
          ...base,
          id: `start__${booth.id}`,
          type: 'mission_started',
          message: `${label} · ${ACTION_LABELS.start}`,
          at: booth.startedAt,
        });
      }
      if (booth.completedAt !== null) {
        push({
          ...base,
          id: `close__${booth.id}`,
          type: 'round_changed',
          message: `${label} · ${booth.skipped ? ACTION_LABELS.skip : ACTION_LABELS.close}`,
          at: booth.completedAt,
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
      const booth = data.booth(missionRoundStateId(alert.mission.id, grade, alert.roundNo));
      const endsAt = getBoothEndsAt(booth);
      if (alert.code === 'not_arrived' && booth && booth.startedAt !== null) {
        at = Math.min(now, booth.startedAt + CHECK_IN_GRACE_MS);
      } else if (alert.code === 'result_missing' && endsAt !== null) {
        at = Math.min(now, endsAt + RESULT_GRACE_MS);
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

    const live = this.peek(eventId, grade);
    if (live) await live.ready().catch(() => undefined);
    const data =
      live && live.event.value ? live.data() : await this.classData(eventId, event, grade, classId);
    const lookup = this.boothLookup(missions, grade, data.booth);
    const now = this.ctx.serverNow();

    return Promise.all(
      teams.map(async (team) => {
        // 부스마다 따로 진행하므로 팀마다 지금 라운드가 다르다.
        const scoped = scopeEventToTeam(
          event,
          team,
          lookup,
          now,
          this.rankedLookup(missions, team, data.booth),
        );
        const roundNo = getCheckInRound(scoped, grade);
        let state: TeamMissionState | null = null;
        let currentMission: Mission | null = null;
        if (roundNo !== null) {
          currentMission = this.missionForRound(missions, team, roundNo);
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
