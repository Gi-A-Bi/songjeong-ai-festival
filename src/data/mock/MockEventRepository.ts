import {
  CardAwardError,
  claimCardAward as applyCardClaim,
  computeClassCardProgress,
  createCardAward,
  reconcileCardProgress,
  reofferCardAward,
} from '../../domain/cards';
import { toDeviceCode } from '../../domain/device';
import { getGoldenBellConfigError } from '../../domain/goldenBell';
import { getSubmissionBlocker } from '../../domain/missionPhase';
import { getRankingEntryError } from '../../domain/rewards';
import { getRoundForMission, getTeamNoForMission, ROUND_NUMBERS } from '../../domain/rotation';
import { resolveSubmissionScore } from '../../domain/scoring';
import { CARD_INFO } from '../../domain/catalog';
import {
  getFinalStartBlocker,
  getHintTotal,
  presentFinalClassStatus,
  redactFinalClassState,
} from '../../domain/finalMission';
import type {
  ActivityEvent,
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
  TeacherRole,
  TeamMissionState,
} from '../../domain/types';
import { RepositoryError } from '../errors';
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
  DevTools,
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
  TeamMissionView,
  TeamRewardView,
  TeamDevice,
  TeamSession,
  TeamTourStatus,
  Unsubscribe,
} from '../EventRepository';
import { resultId, resultKey, roundKey, submissionId, toTeamId } from './keys';
import type { MockStoreContext } from './mockContext';
import { MockFinalStore } from './mockFinal';
import { MockTourStore } from './mockTour';
import { createSeedState, DEV_TEACHER, THIS_DEVICE_ID, type MockState } from './seed';

export interface MockEventRepositoryOptions {
  /** 네트워크 지연 흉내(ms). 테스트에서는 0 */
  latencyMs?: number;
  now?: () => number;
  random?: () => number;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneDrawing(file: DrawingFile): DrawingFile {
  return { ...file, bytes: new Uint8Array(file.bytes) };
}

/**
 * 메모리 안에서만 동작하는 저장소. 새로고침하면 샘플 상태로 돌아간다.
 * 반환값은 복사본이라 화면에서 바꿔도 저장소 상태가 변하지 않는다.
 */
export class MockEventRepository implements EventRepository, DevTools {
  readonly mode = 'mock' as const;
  readonly capabilities = { liveOps: true, classFinal: true };

  private state: MockState;
  private readonly latencyMs: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly eventListeners = new Set<(event: FestivalEvent) => void>();
  private readonly missionStateListeners = new Map<string, Set<() => void>>();
  private readonly stationListeners = new Map<string, Set<(revision: number) => void>>();
  private readonly opsListeners = new Map<Grade, Set<(revision: number) => void>>();
  private readonly finalListeners = new Map<Grade, Set<(revision: number) => void>>();
  private liveRevision = 0;
  private readonly tour: MockTourStore;
  private readonly final: MockFinalStore;
  private shouldFailNext = false;
  private teacher: TeacherProfile | null = null;

  constructor(options: MockEventRepositoryOptions = {}) {
    this.latencyMs = options.latencyMs ?? 0;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.state = createSeedState(this.now());
    const context = this.createContext();
    this.tour = new MockTourStore(context);
    this.final = new MockFinalStore(context);
  }

  // ---- 개발 도구 ----

  failNextRequest(): void {
    this.shouldFailNext = true;
  }

  resetData(): void {
    this.state = createSeedState(this.now());
    this.shouldFailNext = false;
    this.notifyEvent();
    for (const key of this.missionStateListeners.keys()) this.notifyMissionState(key);
    for (const key of this.stationListeners.keys()) this.notifyStation(key);
    for (const grade of this.opsListeners.keys()) this.notifyOps(grade);
    for (const grade of this.finalListeners.keys()) this.notifyFinal(grade);
  }

  signInAs(
    role: TeacherRole,
    assignment: { missionId?: string; classId?: string } = {},
  ): TeacherProfile {
    const names: Record<TeacherRole, string> = {
      admin: '개발용 총괄 선생님',
      station_teacher: '개발용 부스 선생님',
      homeroom_teacher: '개발용 담임 선생님',
    };
    this.teacher = {
      uid: `dev-${role}`,
      displayName: names[role],
      role,
      missionId: role === 'station_teacher' ? (assignment.missionId ?? null) : null,
      classId: role === 'homeroom_teacher' ? (assignment.classId ?? null) : null,
    };
    return { ...this.teacher };
  }

  /** mock은 브라우저 메모리가 곧 서버라 저장소의 시계를 서버 시각으로 쓴다. */
  serverNow(): number {
    return this.now();
  }

  // ---- 행사 준비 ----

  /** mock은 항상 샘플 행사가 준비되어 있어 현재 구조만 알려 준다. */
  async setupEvent(eventId: string): Promise<EventSetupSummary> {
    await this.request();
    this.assertEvent(eventId);
    this.requireTeacher();
    return {
      created: false,
      classes: this.state.classes.length,
      teams: this.state.teams.length,
      missions: this.state.missions.length,
    };
  }

  // ---- 행사 상태 ----

  async getEvent(eventId: string): Promise<FestivalEvent> {
    await this.request();
    this.assertEvent(eventId);
    return clone(this.state.event);
  }

  subscribeEvent(
    eventId: string,
    onChange: (event: FestivalEvent) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    let active = true;
    const listener = (event: FestivalEvent) => {
      if (active) onChange(clone(event));
    };
    const timer = setTimeout(() => {
      if (!active) return;
      if (eventId !== this.state.event.id) {
        onError(
          new RepositoryError('not-found', '행사를 찾을 수 없어요. QR 주소를 다시 확인해 주세요.'),
        );
        return;
      }
      this.eventListeners.add(listener);
      listener(this.state.event);
    }, this.latencyMs);
    return () => {
      active = false;
      clearTimeout(timer);
      this.eventListeners.delete(listener);
    };
  }

  async controlRound(eventId: string, action: RoundControlAction): Promise<FestivalEvent> {
    await this.request();
    this.assertEvent(eventId);
    this.requireAdmin();
    const event = this.state.event;
    const now = this.now();

    if (action === 'pause') {
      if (event.status !== 'active' || event.roundEndsAt === null) {
        throw new RepositoryError('not-allowed', '진행 중인 라운드만 일시정지할 수 있어요.');
      }
      this.updateEvent({
        status: 'paused',
        pausedRemainingMs: Math.max(0, event.roundEndsAt - now),
        roundEndsAt: null,
      });
    } else if (action === 'end') {
      if (
        (event.status !== 'active' && event.status !== 'paused') ||
        event.activeGrade === null ||
        event.activeRound === 0
      ) {
        throw new RepositoryError('not-allowed', '진행 중인 라운드가 없어요.');
      }
      this.state.roundStatuses[roundKey(event.activeGrade, event.activeRound)] = 'scoring';
      this.updateEvent({
        status: 'ready',
        roundEndsAt: null,
        pausedRemainingMs: null,
        roundEndedAt: now,
      });
      this.logRound(event.activeGrade, event.activeRound, '종료', `end`);
    } else if (event.status === 'paused') {
      this.updateEvent({
        status: 'active',
        roundEndsAt: now + (event.pausedRemainingMs ?? event.roundDurationMs),
        pausedRemainingMs: null,
      });
    } else if (event.status !== 'active') {
      const grade = event.activeGrade;
      if (grade === null) {
        throw new RepositoryError('not-allowed', '먼저 진행할 학년을 골라 주세요.');
      }
      let roundNo = event.activeRound;
      const currentStatus = roundNo === 0 ? null : this.roundStatusOf(grade, roundNo);
      if (roundNo === 0 || currentStatus === 'scoring' || currentStatus === 'closed') {
        if (roundNo === 5) {
          throw new RepositoryError('not-allowed', '5라운드가 모두 끝났어요.');
        }
        if (roundNo !== 0) this.state.roundStatuses[roundKey(grade, roundNo)] = 'closed';
        roundNo = (roundNo + 1) as RoundNo;
      }
      this.state.roundStatuses[roundKey(grade, roundNo)] = 'active';
      this.updateEvent({
        status: 'active',
        activeRound: roundNo,
        roundEndsAt: now + event.roundDurationMs,
        pausedRemainingMs: null,
        roundEndedAt: null,
      });
      this.logRound(grade, roundNo, '시작', 'start');
    }
    if (this.state.event.activeGrade !== null) this.notifyOps(this.state.event.activeGrade);
    return clone(this.state.event);
  }

  async setActiveGrade(eventId: string, grade: Grade): Promise<FestivalEvent> {
    await this.request();
    this.assertEvent(eventId);
    this.requireAdmin();
    const event = this.state.event;
    if (event.status === 'active' || event.status === 'paused') {
      throw new RepositoryError('not-allowed', '라운드를 종료한 뒤 학년을 바꿀 수 있어요.');
    }
    let lastRound: 0 | RoundNo = 0;
    for (const roundNo of ROUND_NUMBERS) {
      if (this.roundStatusOf(grade, roundNo) !== 'waiting') lastRound = roundNo;
    }
    this.updateEvent({
      activeGrade: grade,
      activeRound: lastRound,
      status: 'ready',
      roundEndsAt: null,
      pausedRemainingMs: null,
      roundEndedAt: null,
    });
    return clone(this.state.event);
  }

  async getRoundStatus(eventId: string, grade: Grade, roundNo: RoundNo): Promise<RoundStatus> {
    await this.request();
    this.assertEvent(eventId);
    return this.roundStatusOf(grade, roundNo);
  }

  // ---- 미션·학급·팀 ----

  async listMissions(eventId: string): Promise<Mission[]> {
    await this.request();
    this.assertEvent(eventId);
    return clone([...this.state.missions].sort((a, b) => a.no - b.no));
  }

  async getMission(eventId: string, missionId: string): Promise<Mission> {
    await this.request();
    this.assertEvent(eventId);
    return clone(this.findMission(missionId));
  }

  async updateMissionConfig(
    eventId: string,
    missionId: string,
    config: MissionConfig,
  ): Promise<Mission> {
    await this.request();
    this.assertEvent(eventId);
    this.requireStationAccess(missionId);
    const mission = this.findMission(missionId);
    if (config.type !== mission.type) {
      throw new RepositoryError('invalid-input', '미션 종류와 설정 형식이 달라요.');
    }
    if (config.type === 'golden_bell') {
      const error = getGoldenBellConfigError(config.questions);
      if (error) throw new RepositoryError('invalid-input', error);
    }
    mission.config = clone(config);
    return clone(mission);
  }

  async listClasses(eventId: string, grade: Grade): Promise<ClassInfo[]> {
    await this.request();
    this.assertEvent(eventId);
    return clone(this.classesOf(grade));
  }

  async listTeams(eventId: string, grade: Grade): Promise<Team[]> {
    await this.request();
    this.assertEvent(eventId);
    return clone(this.state.teams.filter((team) => team.grade === grade));
  }

  async getTeam(eventId: string, teamId: string): Promise<Team> {
    await this.request();
    this.assertEvent(eventId);
    return clone(this.findTeam(teamId));
  }

  async joinTeam(eventId: string, teamId: string): Promise<TeamSession> {
    await this.request();
    this.assertEvent(eventId);
    const team = this.findTeam(teamId);
    const now = this.now();
    // 실제 저장소처럼 첫 입장 기기를 한 팀에 묶는다.
    const current = this.state.devices[THIS_DEVICE_ID];
    if (current && current.teamId !== team.id) throw new RepositoryError('device-locked');
    const joinedAt = current?.joinedAt ?? now;
    this.state.devices[THIS_DEVICE_ID] = {
      id: THIS_DEVICE_ID,
      teamId: team.id,
      joinedAt,
      lastSeenAt: now,
    };
    this.state.deviceTeamId = team.id;
    return { eventId, teamId: team.id, joinedAt };
  }

  async getMyDevice(eventId: string): Promise<DeviceInfo> {
    await this.request();
    this.assertEvent(eventId);
    const teamId = this.state.devices[THIS_DEVICE_ID]?.teamId;
    return {
      code: toDeviceCode(THIS_DEVICE_ID),
      team: teamId ? clone(this.findTeam(teamId)) : null,
    };
  }

  async listClassDevices(eventId: string, classId: string): Promise<TeamDevice[]> {
    await this.request();
    this.assertEvent(eventId);
    this.requireTeacher();
    const teams = this.teamsOfClass(this.findClass(classId).id);
    return Object.values(this.state.devices)
      .flatMap((device) => {
        const team = teams.find((item) => item.id === device.teamId);
        return team ? [{ device, teamNo: team.teamNo }] : [];
      })
      .sort((a, b) => a.teamNo - b.teamNo || a.device.joinedAt - b.device.joinedAt)
      .map(({ device }) => ({ ...device, code: toDeviceCode(device.id) }));
  }

  async unlockDevice(eventId: string, deviceId: string): Promise<void> {
    await this.request();
    this.assertEvent(eventId);
    this.requireTeacher();
    // 이미 풀린 기기를 다시 풀어도 오류가 아니다.
    delete this.state.devices[deviceId];
    if (deviceId === THIS_DEVICE_ID) this.state.deviceTeamId = null;
  }

  // ---- 제출 ----

  async getTeamMissionView(
    eventId: string,
    teamId: string,
    missionId: string,
  ): Promise<TeamMissionView> {
    await this.request();
    this.assertEvent(eventId);
    const team = this.findTeam(teamId);
    const mission = this.findMission(missionId);
    const roundNo = getRoundForMission(team.teamNo, mission.no);
    const key = resultKey(mission.id, team.grade, roundNo);
    return clone({
      team,
      mission,
      roundNo,
      roundStatus: this.roundStatusOf(team.grade, roundNo),
      submission: this.state.submissions[submissionId(mission.id, team.id)] ?? null,
      finalized: this.isFinalized(mission.id, team.grade, roundNo),
      answerRevealed: this.state.missionStates[key]?.answerRevealed ?? false,
    });
  }

  subscribeMissionState(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
    onChange: (state: MissionLiveState) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    let active = true;
    const key = resultKey(missionId, grade, roundNo);
    const listener = () => {
      if (active) onChange(this.missionLiveState(missionId, grade, roundNo));
    };
    const timer = setTimeout(() => {
      if (!active) return;
      if (eventId !== this.state.event.id) {
        onError(new RepositoryError('not-found'));
        return;
      }
      const listeners = this.missionStateListeners.get(key) ?? new Set();
      listeners.add(listener);
      this.missionStateListeners.set(key, listeners);
      listener();
    }, this.latencyMs);
    return () => {
      active = false;
      clearTimeout(timer);
      this.missionStateListeners.get(key)?.delete(listener);
    };
  }

  async listTeamSubmissions(eventId: string, teamId: string): Promise<Submission[]> {
    await this.request();
    this.assertEvent(eventId);
    const team = this.findTeam(teamId);
    return clone(Object.values(this.state.submissions).filter((item) => item.teamId === team.id));
  }

  async saveSubmission(input: SaveSubmissionInput): Promise<Submission> {
    await this.request();
    this.assertEvent(input.eventId);
    const team = this.findTeam(input.teamId);
    const mission = this.findMission(input.missionId);
    if (input.answer.type !== mission.type) {
      throw new RepositoryError('invalid-input', '미션 종류와 답안 형식이 달라요.');
    }
    if ((mission.type === 'drawing') !== (input.drawing !== undefined)) {
      throw new RepositoryError('invalid-input', '그림 파일이 없어요. 다시 제출해 주세요.');
    }

    const id = submissionId(mission.id, team.id);
    const existing = this.state.submissions[id];
    if (existing && existing.status !== 'draft') {
      // 같은 요청을 다시 보낸 경우에는 같은 결과를 돌려준다.
      if (this.state.processedRequests[input.requestId] === id) return clone(existing);
      throw new RepositoryError(
        'not-allowed',
        '이미 제출했어요. 다시 내려면 선생님께 말해 주세요.',
      );
    }

    const roundNo = getRoundForMission(team.teamNo, mission.no);
    if (this.isFinalized(mission.id, team.grade, roundNo)) {
      throw new RepositoryError('not-allowed', '순위가 이미 확정되어 제출할 수 없어요.');
    }
    const blocker = getSubmissionBlocker({
      event: this.state.event,
      grade: team.grade,
      roundNo,
      reopened: existing?.status === 'draft' && existing.reopened,
    });
    if (blocker) throw new RepositoryError('not-allowed', blocker);

    const now = this.now();
    if (input.drawing) {
      this.state.drawings[team.id] = {
        teamId: team.id,
        missionId: mission.id,
        promptId: input.drawing.promptId,
        mimeType: input.drawing.mimeType,
        byteSize: input.drawing.bytes.length,
        width: input.drawing.width,
        height: input.drawing.height,
        bytes: new Uint8Array(input.drawing.bytes),
        submittedAt: now,
      };
    }
    const submission: Submission = {
      id,
      teamId: team.id,
      classId: team.classId,
      missionId: mission.id,
      grade: team.grade,
      roundNo,
      status: 'submitted',
      answer: clone(input.answer),
      score: null,
      reopened: false,
      submittedAt: now,
      updatedAt: now,
    };
    this.state.submissions[id] = submission;
    this.state.processedRequests[input.requestId] = id;
    this.notifyStation(resultKey(mission.id, team.grade, roundNo));
    return clone(submission);
  }

  async getRoundProgress(
    eventId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): Promise<MissionProgress[]> {
    await this.request();
    this.assertEvent(eventId);
    const classes = this.classesOf(grade);
    return this.state.missions.map((mission) => {
      const teamNo = getTeamNoForMission(mission.no, roundNo);
      const submitted = classes.filter((classInfo) => {
        const item =
          this.state.submissions[
            submissionId(mission.id, toTeamId(grade, classInfo.classNo, teamNo))
          ];
        return item !== undefined && item.status !== 'draft';
      }).length;
      return {
        missionId: mission.id,
        submitted,
        total: classes.length,
        finalized: this.isFinalized(mission.id, grade, roundNo),
      };
    });
  }

  // ---- 교사 운영 ----

  async listMissionParticipants(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): Promise<MissionParticipant[]> {
    await this.request();
    this.assertEvent(eventId);
    this.requireTeacher();
    const mission = this.findMission(missionId);
    const teamNo = getTeamNoForMission(mission.no, roundNo);
    const key = resultKey(mission.id, grade, roundNo);
    return clone(
      this.classesOf(grade).map((classInfo) => {
        const team = this.findTeam(toTeamId(grade, classInfo.classNo, teamNo));
        const result =
          this.state.results.find((item) => item.id === resultId(key, team.id)) ?? null;
        const stored = this.state.submissions[submissionId(mission.id, team.id)] ?? null;
        return {
          team,
          submission: stored ? { ...stored, score: resolveSubmissionScore(stored, mission) } : null,
          result,
          award: result ? (this.awardOf(result.id) ?? null) : null,
          movement: this.tour.present(team, roundNo),
        };
      }),
    );
  }

  subscribeStationSubmissions(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
    onChange: (revision: number) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    let active = true;
    const key = resultKey(missionId, grade, roundNo);
    const listener = (revision: number) => {
      if (active) onChange(revision);
    };
    const timer = setTimeout(() => {
      if (!active) return;
      if (eventId !== this.state.event.id) {
        onError(new RepositoryError('not-found'));
        return;
      }
      if (!this.teacher) {
        onError(new RepositoryError('not-allowed', '교사로 로그인해야 할 수 있어요.'));
        return;
      }
      const listeners = this.stationListeners.get(key) ?? new Set();
      listeners.add(listener);
      this.stationListeners.set(key, listeners);
      listener(this.liveRevision);
    }, this.latencyMs);
    return () => {
      active = false;
      clearTimeout(timer);
      this.stationListeners.get(key)?.delete(listener);
    };
  }

  async setAnswerRevealed(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
    revealed: boolean,
  ): Promise<void> {
    await this.request();
    this.assertEvent(eventId);
    this.requireStationAccess(missionId);
    const mission = this.findMission(missionId);
    this.touchMissionState(mission.id, grade, roundNo, { answerRevealed: revealed });
  }

  async isAnswerRevealed(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): Promise<boolean> {
    await this.request();
    this.assertEvent(eventId);
    return this.state.missionStates[resultKey(missionId, grade, roundNo)]?.answerRevealed ?? false;
  }

  async finalizeRanking(input: FinalizeRankingInput): Promise<FinalizeRankingOutcome> {
    await this.request();
    this.assertEvent(input.eventId);
    const teacher = this.requireStationAccess(input.missionId);
    const mission = this.findMission(input.missionId);
    const key = resultKey(mission.id, input.grade, input.roundNo);

    // 이미 확정된 묶음은 다시 만들지 않는다(중복 클릭·재시도 안전).
    const existing = this.state.results.filter((item) => item.id.startsWith(`${key}__`));
    if (existing.length > 0) {
      return clone({
        results: existing,
        awards: this.awardsOf(existing),
        alreadyFinalized: true,
      });
    }

    this.validateRankingEntries(input, mission);

    const now = this.now();
    const results: MissionResult[] = input.entries.map((entry) => ({
      id: resultId(key, entry.teamId),
      missionId: mission.id,
      grade: input.grade,
      roundNo: input.roundNo,
      teamId: entry.teamId,
      score: entry.score,
      rank: entry.rank,
      finalizedBy: teacher.uid,
      finalizedAt: now,
    }));

    // 결과 하나당 카드 보상 하나. ID가 결과 ID와 같아 다시 만들어지지 않는다.
    const awards = results.map((result) => {
      const team = this.findTeam(result.teamId);
      this.markVerified(mission.id, team.id, result.score, now);
      return createCardAward({ result, team, now, random: this.random });
    });
    this.state.results.push(...results);
    this.state.cardAwards.push(...awards);
    this.state.processedRequests[input.requestId] = key;
    this.refreshProgress(awards.map((award) => award.classId));
    this.tour.onRankingFinalized(mission, results, teacher.uid);
    for (const award of awards) this.logCardEarned(award);
    this.touchMissionState(mission.id, input.grade, input.roundNo, {});

    return clone({ results, awards, alreadyFinalized: false });
  }

  async reviseRanking(input: FinalizeRankingInput): Promise<ReviseRankingOutcome> {
    await this.request();
    this.assertEvent(input.eventId);
    const teacher = this.requireStationAccess(input.missionId);
    const mission = this.findMission(input.missionId);
    const key = resultKey(mission.id, input.grade, input.roundNo);
    if (!this.isFinalized(mission.id, input.grade, input.roundNo)) {
      throw new RepositoryError(
        'not-allowed',
        '아직 확정하지 않은 순위예요. 먼저 순위를 확정해 주세요.',
      );
    }
    this.validateRankingEntries(input, mission);

    const now = this.now();
    let reoffered = 0;
    let keptClaimed = 0;
    const results: MissionResult[] = [];
    const awards: CardAward[] = [];
    for (const entry of input.entries) {
      const team = this.findTeam(entry.teamId);
      const id = resultId(key, team.id);
      const index = this.state.results.findIndex((item) => item.id === id);
      const result: MissionResult = {
        id,
        missionId: mission.id,
        grade: input.grade,
        roundNo: input.roundNo,
        teamId: team.id,
        score: entry.score,
        rank: entry.rank,
        finalizedBy: teacher.uid,
        finalizedAt: index === -1 ? now : this.state.results[index].finalizedAt,
      };
      if (index === -1) this.state.results.push(result);
      else this.state.results[index] = result;
      results.push(result);

      const awardIndex = this.state.cardAwards.findIndex((award) => award.id === id);
      if (awardIndex === -1) {
        const created = createCardAward({ result, team, now, random: this.random });
        this.state.cardAwards.push(created);
        awards.push(created);
      } else {
        const previous = this.state.cardAwards[awardIndex];
        const next = reofferCardAward(previous, entry.rank, now, this.random);
        if (next.changed && previous.status === 'pending') reoffered += 1;
        if (next.keptClaimed) keptClaimed += 1;
        this.state.cardAwards[awardIndex] = next.award;
        awards.push(next.award);
      }
      this.markVerified(mission.id, team.id, entry.score, now);
    }
    this.state.processedRequests[input.requestId] = key;
    this.refreshProgress(awards.map((award) => award.classId));
    this.tour.onRankingFinalized(mission, results, teacher.uid);
    for (const award of awards) this.logCardEarned(award);
    this.touchMissionState(mission.id, input.grade, input.roundNo, {});

    return clone({ results, awards, reoffered, keptClaimed });
  }

  async reopenSubmission(input: ReopenSubmissionInput): Promise<void> {
    await this.request();
    this.assertEvent(input.eventId);
    this.requireStationAccess(input.missionId);
    const mission = this.findMission(input.missionId);
    const team = this.findTeam(input.teamId);
    const id = submissionId(mission.id, team.id);
    const existing = this.state.submissions[id];
    if (!existing || existing.status === 'draft') {
      throw new RepositoryError('not-allowed', '되돌릴 제출이 없어요.');
    }
    if (this.isFinalized(mission.id, existing.grade, existing.roundNo)) {
      throw new RepositoryError(
        'not-allowed',
        '순위를 확정한 뒤에는 제출을 되돌릴 수 없어요. 순위 수정으로 바꿔 주세요.',
      );
    }
    this.state.submissions[id] = {
      ...existing,
      status: 'draft',
      reopened: true,
      score: null,
      updatedAt: this.now(),
    };
    this.touchMissionState(mission.id, existing.grade, existing.roundNo, {});
  }

  async listDrawingFiles(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): Promise<DrawingFile[]> {
    await this.request();
    this.assertEvent(eventId);
    this.requireTeacher();
    const mission = this.findMission(missionId);
    const teamNo = getTeamNoForMission(mission.no, roundNo);
    return this.classesOf(grade).flatMap((classInfo) => {
      const file = this.state.drawings[toTeamId(grade, classInfo.classNo, teamNo)];
      return file && file.missionId === mission.id ? [cloneDrawing(file)] : [];
    });
  }

  // ---- 카드 보상과 네 조각 성장 ----

  async getTeamRewardView(eventId: string, teamId: string): Promise<TeamRewardView> {
    await this.request();
    this.assertEvent(eventId);
    const team = this.findTeam(teamId);
    const awards = this.state.cardAwards
      .filter((award) => award.teamId === team.id)
      .sort(
        (a, b) =>
          Number(a.status === 'claimed') - Number(b.status === 'claimed') ||
          b.roundNo - a.roundNo ||
          b.createdAt - a.createdAt,
      );
    return clone({
      classInfo: this.findClass(team.classId),
      progress: this.classProgress(team.classId),
      awards: awards.map((award) => this.toAwardView(award)),
    });
  }

  async claimCardAward(input: ClaimCardAwardInput): Promise<ClaimCardAwardOutcome> {
    await this.request();
    this.assertEvent(input.eventId);
    const team = this.findTeam(input.teamId);
    const index = this.state.cardAwards.findIndex(
      (award) => award.id === input.awardId && award.teamId === team.id,
    );
    if (index === -1) throw new RepositoryError('not-found', '카드 보상을 찾을 수 없어요.');
    const current = this.state.cardAwards[index];

    // 같은 요청을 다시 보낸 경우(연타·재시도)는 이미 받은 결과를 그대로 돌려준다.
    if (
      current.status === 'claimed' &&
      current.selectedType &&
      this.state.processedRequests[input.requestId] === current.id
    ) {
      const progress = this.classProgress(current.classId);
      const same = progress.cards[current.selectedType];
      return clone({ award: this.toAwardView(current), before: same, after: same, progress });
    }

    const before = this.classProgress(current.classId).cards[input.selectedType];
    let claimed: CardAward;
    try {
      claimed = applyCardClaim(current, input.selectedType, this.now());
    } catch (error) {
      if (error instanceof CardAwardError) {
        throw error.reason === 'already-claimed'
          ? new RepositoryError('already-claimed', '이미 받은 카드 보상이에요.')
          : new RepositoryError('invalid-input', '제시된 카드 중에서만 고를 수 있어요.');
      }
      throw error;
    }
    this.state.cardAwards[index] = claimed;
    this.state.processedRequests[input.requestId] = claimed.id;
    const [progress] = this.refreshProgress([claimed.classId]);
    this.logCardEarned(claimed);
    return clone({
      award: this.toAwardView(claimed),
      before,
      after: progress.cards[input.selectedType],
      progress,
    });
  }

  async listClassCardBoards(eventId: string, grade: Grade): Promise<ClassCardBoard[]> {
    await this.request();
    this.assertEvent(eventId);
    return clone(
      this.classesOf(grade).map((classInfo) => ({
        classInfo,
        progress: this.classProgress(classInfo.id),
      })),
    );
  }

  async getTeacherClassCards(eventId: string, classId: string): Promise<TeacherClassCards> {
    await this.request();
    this.assertEvent(eventId);
    this.requireTeacher();
    const classInfo = this.findClass(classId);
    return clone({
      classInfo,
      teams: this.teamsOfClass(classInfo.id),
      progress: this.classProgress(classInfo.id),
      awards: this.state.cardAwards
        .filter((award) => award.classId === classInfo.id)
        .sort((a, b) => a.roundNo - b.roundNo || a.teamId.localeCompare(b.teamId))
        .map((award) => this.toAwardView(award)),
    });
  }

  // ---- 팀 이동과 QR 체크인 ----

  async getMyTeam(eventId: string): Promise<Team | null> {
    await this.request();
    this.assertEvent(eventId);
    const teamId = this.state.deviceTeamId;
    return teamId ? clone(this.findTeam(teamId)) : null;
  }

  async checkInStation(input: CheckInInput): Promise<CheckInOutcome> {
    await this.request();
    this.assertEvent(input.eventId);
    return clone(this.tour.checkIn(this.findTeam(input.teamId), input.stationId));
  }

  async getTeamTourStatus(eventId: string, teamId: string): Promise<TeamTourStatus> {
    await this.request();
    this.assertEvent(eventId);
    return clone(this.tour.tourStatus(this.findTeam(teamId)));
  }

  // ---- 실시간 운영 대시보드 ----

  async getOpsDashboard(eventId: string, grade: Grade, roundNo?: RoundNo): Promise<OpsDashboard> {
    await this.request();
    this.assertEvent(eventId);
    this.requireTeacher();
    return clone(this.tour.dashboard(grade, roundNo));
  }

  async getClassOpsDetail(eventId: string, classId: string): Promise<ClassOpsDetail> {
    await this.request();
    this.assertEvent(eventId);
    const teacher = this.requireTeacher();
    const classInfo = this.findClass(classId);
    const session = this.final.sessionOf(classInfo.grade);
    const finalState = this.final.stateOf(classInfo);
    const progress = this.classProgress(classInfo.id);
    const canView =
      teacher.role === 'admin' ||
      session.status === 'results_published' ||
      session.status === 'closed';
    return clone({
      classInfo,
      teams: this.tour.classTeams(classInfo.id),
      progress,
      hintPreview: getHintTotal(progress),
      session,
      finalState: redactFinalClassState(finalState, canView),
      finalStatus: presentFinalClassStatus(session, finalState, this.now()),
      canRunFinal: this.canRunClassFinal(classInfo.id),
      startBlocker: getFinalStartBlocker(session, finalState),
    });
  }

  subscribeOps(
    eventId: string,
    grade: Grade,
    onChange: (revision: number) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    return this.subscribeLive(this.opsListeners, eventId, grade, onChange, onError);
  }

  async getMissionRoundState(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): Promise<MissionRoundState> {
    await this.request();
    this.assertEvent(eventId);
    return clone(this.tour.missionRound(missionId, grade, roundNo));
  }

  async getStationArrivals(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): Promise<StationArrivals> {
    await this.request();
    this.assertEvent(eventId);
    this.requireTeacher();
    return clone(this.tour.arrivals(missionId, grade, roundNo));
  }

  async startStationRound(input: StartStationInput): Promise<MissionRoundState> {
    await this.request();
    this.assertEvent(input.eventId);
    return clone(this.tour.startStation(input));
  }

  async markTeamArrived(input: MarkArrivedInput): Promise<TeamMissionState> {
    await this.request();
    this.assertEvent(input.eventId);
    return clone(this.tour.markArrived(input));
  }

  // ---- 학급 전체 최종 미션 ----

  async getFinalBoard(eventId: string, grade: Grade): Promise<FinalBoard> {
    await this.request();
    this.assertEvent(eventId);
    return clone(this.final.board(grade));
  }

  // mock은 읽기 비용이 없어 학급 범위(classId)를 따로 나누지 않고 학년 단위로 알린다.
  subscribeFinal(
    eventId: string,
    grade: Grade,
    onChange: (revision: number) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    return this.subscribeLive(this.finalListeners, eventId, grade, onChange, onError);
  }

  async openFinal(input: OpenFinalInput): Promise<FinalSession> {
    await this.request();
    this.assertEvent(input.eventId);
    return clone(this.final.open(input));
  }

  async setFinalDuration(
    eventId: string,
    grade: Grade,
    durationLimitSec: number,
  ): Promise<FinalSession> {
    await this.request();
    this.assertEvent(eventId);
    return clone(this.final.setDuration(grade, durationLimitSec));
  }

  async publishFinalResults(eventId: string, grade: Grade): Promise<FinalSession> {
    await this.request();
    this.assertEvent(eventId);
    return clone(this.final.publish(grade));
  }

  async getClassFinalView(eventId: string, classId: string): Promise<ClassFinalView> {
    await this.request();
    this.assertEvent(eventId);
    return clone(this.final.classView(classId));
  }

  async startClassFinal(input: StartClassFinalInput): Promise<ClassFinalView> {
    await this.request();
    this.assertEvent(input.eventId);
    return clone(this.final.start(input));
  }

  async selectFinalChoice(input: SelectFinalChoiceInput): Promise<ClassFinalView> {
    await this.request();
    this.assertEvent(input.eventId);
    return clone(this.final.select(input));
  }

  async applyFinalHint(input: FinalQuestionActionInput): Promise<ClassFinalView> {
    await this.request();
    this.assertEvent(input.eventId);
    return clone(this.final.hint(input));
  }

  async confirmFinalAnswer(input: FinalQuestionActionInput): Promise<ClassFinalView> {
    await this.request();
    this.assertEvent(input.eventId);
    return clone(this.final.confirm(input));
  }

  async closeExpiredClassFinal(eventId: string, classId: string): Promise<ClassFinalView> {
    await this.request();
    this.assertEvent(eventId);
    return clone(this.final.closeExpired(classId));
  }

  async forceCloseClassFinal(input: FinalAdminActionInput): Promise<FinalClassState> {
    await this.request();
    this.assertEvent(input.eventId);
    return clone(this.final.forceClose(input));
  }

  async adjustFinalResult(input: AdjustFinalResultInput): Promise<FinalClassState> {
    await this.request();
    this.assertEvent(input.eventId);
    return clone(this.final.adjust(input));
  }

  async resetClassFinal(input: FinalAdminActionInput): Promise<FinalClassState> {
    await this.request();
    this.assertEvent(input.eventId);
    return clone(this.final.reset(input));
  }

  // ---- 교사 인증(목업) ----

  getCurrentTeacher(): TeacherProfile | null {
    return this.teacher ? { ...this.teacher } : null;
  }

  /** mock은 메모리에만 로그인 상태를 두므로 새로고침하면 다시 로그인해야 한다. */
  async restoreTeacher(): Promise<TeacherProfile | null> {
    return this.getCurrentTeacher();
  }

  async signInTeacher(): Promise<TeacherProfile> {
    await this.request();
    this.teacher = { ...DEV_TEACHER };
    return { ...this.teacher };
  }

  async signOutTeacher(): Promise<void> {
    this.teacher = null;
  }

  // ---- 내부 도우미 ----

  private async request(): Promise<void> {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
    if (this.shouldFailNext) {
      this.shouldFailNext = false;
      throw new RepositoryError('unavailable');
    }
  }

  private assertEvent(eventId: string): void {
    if (eventId !== this.state.event.id) {
      throw new RepositoryError(
        'not-found',
        '행사를 찾을 수 없어요. QR 주소를 다시 확인해 주세요.',
      );
    }
  }

  private requireTeacher(): TeacherProfile {
    if (!this.teacher) {
      throw new RepositoryError('not-allowed', '교사로 로그인해야 할 수 있어요.');
    }
    return this.teacher;
  }

  private updateEvent(patch: Partial<FestivalEvent>): void {
    this.state.event = { ...this.state.event, ...patch, updatedAt: this.now() };
    this.notifyEvent();
  }

  private notifyEvent(): void {
    for (const listener of this.eventListeners) listener(this.state.event);
  }

  private missionLiveState(missionId: string, grade: Grade, roundNo: RoundNo): MissionLiveState {
    const stored = this.state.missionStates[resultKey(missionId, grade, roundNo)];
    return {
      answerRevealed: stored?.answerRevealed ?? false,
      finalized: this.isFinalized(missionId, grade, roundNo),
      updatedAt: stored?.updatedAt ?? 0,
    };
  }

  /** 학생 화면이 구독하는 미션 상태를 바꾸고 알린다. */
  private touchMissionState(
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
    patch: { answerRevealed?: boolean },
  ): void {
    const key = resultKey(missionId, grade, roundNo);
    const previous = this.state.missionStates[key];
    this.state.missionStates[key] = {
      answerRevealed: patch.answerRevealed ?? previous?.answerRevealed ?? false,
      updatedAt: Math.max(this.now(), (previous?.updatedAt ?? 0) + 1),
    };
    this.notifyMissionState(key);
    // 교사의 재제출 허용·순위 확정·수정도 부스 화면이 바로 다시 그리게 알린다.
    this.notifyStation(key);
  }

  private notifyMissionState(key: string): void {
    for (const listener of this.missionStateListeners.get(key) ?? []) listener();
  }

  /** 부스 화면이 구독하는 제출 변화(키는 미션·학년·라운드) */
  private notifyStation(key: string): void {
    this.liveRevision += 1;
    for (const listener of this.stationListeners.get(key) ?? []) listener(this.liveRevision);
  }

  private validateRankingEntries(input: FinalizeRankingInput, mission: Mission): void {
    if (input.entries.length === 0) {
      throw new RepositoryError('invalid-input', '순위를 확정할 팀이 없어요.');
    }
    const teamNo = getTeamNoForMission(mission.no, input.roundNo);
    const seen = new Set<string>();
    for (const entry of input.entries) {
      const team = this.state.teams.find((item) => item.id === entry.teamId);
      if (!team || team.grade !== input.grade || team.teamNo !== teamNo) {
        throw new RepositoryError('invalid-input', '이 미션에 참가하지 않은 팀이 들어 있어요.');
      }
      if (seen.has(team.id)) {
        throw new RepositoryError('invalid-input', '같은 팀이 두 번 들어 있어요.');
      }
      seen.add(team.id);
      const error = getRankingEntryError(entry);
      if (error) throw new RepositoryError('invalid-input', error);
    }
  }

  /** 제출한 팀만 확인 상태로 바꾼다. 제출하지 않은 팀의 빈 제출 문서는 만들지 않는다. */
  private markVerified(missionId: string, teamId: string, score: number, now: number): void {
    const submission = this.state.submissions[submissionId(missionId, teamId)];
    if (!submission || submission.status === 'draft') return;
    this.state.submissions[submission.id] = {
      ...submission,
      score,
      status: 'verified',
      updatedAt: now,
    };
  }

  private requireAdmin(): TeacherProfile {
    const teacher = this.requireTeacher();
    if (teacher.role !== 'admin') {
      throw new RepositoryError('not-allowed', '총괄 선생님만 할 수 있어요.');
    }
    return teacher;
  }

  private requireStationAccess(missionId: string): TeacherProfile {
    const teacher = this.requireTeacher();
    const allowed =
      teacher.role === 'admin' ||
      (teacher.role === 'station_teacher' &&
        (teacher.missionId === null || teacher.missionId === missionId));
    if (!allowed) {
      throw new RepositoryError('not-allowed', '담당 미션만 운영할 수 있어요.');
    }
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

  private requireClassAccess(classId: string): TeacherProfile {
    const teacher = this.requireTeacher();
    if (!this.canRunClassFinal(classId)) {
      throw new RepositoryError('not-allowed', '담당 학급의 최종 미션만 진행할 수 있어요.');
    }
    return teacher;
  }

  private createContext(): MockStoreContext {
    return {
      state: () => this.state,
      now: () => this.now(),
      teacher: () => this.teacher,
      requireTeacher: () => this.requireTeacher(),
      requireAdmin: () => this.requireAdmin(),
      requireStationAccess: (missionId) => this.requireStationAccess(missionId),
      requireClassAccess: (classId) => this.requireClassAccess(classId),
      canRunClassFinal: (classId) => this.canRunClassFinal(classId),
      findTeam: (teamId) => this.findTeam(teamId),
      findClass: (classId) => this.findClass(classId),
      findMission: (missionId) => this.findMission(missionId),
      classesOf: (grade) => this.classesOf(grade),
      teamsOfClass: (classId) => this.teamsOfClass(classId),
      classProgress: (classId) => this.classProgress(classId),
      roundStatusOf: (grade, roundNo) => this.roundStatusOf(grade, roundNo),
      addActivity: (event) => this.addActivity(event),
      notifyOps: (grade) => this.notifyOps(grade),
      notifyFinal: (grade) => this.notifyFinal(grade),
    };
  }

  /** 같은 ID의 활동은 한 번만 남긴다(중복 클릭·재시도·새로고침 안전). */
  private addActivity(event: Omit<ActivityEvent, 'at'> & { at?: number }): void {
    if (this.state.activityEvents[event.id]) return;
    this.state.activityEvents[event.id] = { ...event, at: event.at ?? this.now() };
  }

  private logRound(grade: Grade, roundNo: RoundNo, label: string, action: string): void {
    this.addActivity({
      id: `round__g${grade}__r${roundNo}__${action}__${this.now()}`,
      grade,
      type: 'round_changed',
      message: `${grade}학년 ${roundNo}라운드 ${label}`,
      classId: null,
      teamId: null,
      missionId: null,
      roundNo,
    });
  }

  private logCardEarned(award: CardAward): void {
    if (award.status !== 'claimed' || !award.selectedType) return;
    this.tour.onCardEarned(
      this.findTeam(award.teamId),
      award.id,
      award.selectedType,
      CARD_INFO[award.selectedType].name,
    );
  }

  private subscribeLive(
    registry: Map<Grade, Set<(revision: number) => void>>,
    eventId: string,
    grade: Grade,
    onChange: (revision: number) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    let active = true;
    const listener = (revision: number) => {
      if (active) onChange(revision);
    };
    const timer = setTimeout(() => {
      if (!active) return;
      if (eventId !== this.state.event.id) {
        onError(new RepositoryError('not-found'));
        return;
      }
      const listeners = registry.get(grade) ?? new Set();
      listeners.add(listener);
      registry.set(grade, listeners);
      listener(this.liveRevision);
    }, this.latencyMs);
    return () => {
      active = false;
      clearTimeout(timer);
      registry.get(grade)?.delete(listener);
    };
  }

  private notifyOps(grade: Grade): void {
    this.liveRevision += 1;
    for (const listener of this.opsListeners.get(grade) ?? []) listener(this.liveRevision);
  }

  private notifyFinal(grade: Grade): void {
    this.liveRevision += 1;
    for (const listener of this.finalListeners.get(grade) ?? []) listener(this.liveRevision);
  }

  private teamsOfClass(classId: string): Team[] {
    return this.state.teams
      .filter((team) => team.classId === classId)
      .sort((a, b) => a.teamNo - b.teamNo);
  }

  private awardOf(awardId: string): CardAward | undefined {
    return this.state.cardAwards.find((award) => award.id === awardId);
  }

  private awardsOf(results: readonly MissionResult[]): CardAward[] {
    return results.flatMap((result) => this.awardOf(result.id) ?? []);
  }

  private findMission(missionId: string): Mission {
    const mission = this.state.missions.find((item) => item.id === missionId);
    if (!mission) throw new RepositoryError('not-found', '미션을 찾을 수 없어요.');
    return mission;
  }

  private findTeam(teamId: string): Team {
    const team = this.state.teams.find((item) => item.id === teamId);
    if (!team)
      throw new RepositoryError('not-found', '팀을 찾을 수 없어요. QR 주소를 다시 확인해 주세요.');
    return team;
  }

  private findClass(classId: string): ClassInfo {
    const classInfo = this.state.classes.find((item) => item.id === classId);
    if (!classInfo) throw new RepositoryError('not-found', '학급을 찾을 수 없어요.');
    return classInfo;
  }

  private classesOf(grade: Grade): ClassInfo[] {
    return this.state.classes
      .filter((classInfo) => classInfo.grade === grade)
      .sort((a, b) => a.classNo - b.classNo);
  }

  private roundStatusOf(grade: Grade, roundNo: RoundNo): RoundStatus {
    return this.state.roundStatuses[roundKey(grade, roundNo)] ?? 'waiting';
  }

  private isFinalized(missionId: string, grade: Grade, roundNo: RoundNo): boolean {
    const prefix = `${resultKey(missionId, grade, roundNo)}__`;
    return this.state.results.some((item) => item.id.startsWith(prefix));
  }

  /**
   * 학급 카드 진행도. 받은 보상 원장으로 계산하고,
   * 화면 편의용 캐시가 원장과 다르면 원장 값으로 바꿔 둔다.
   */
  private classProgress(classId: string): ClassCardProgress {
    const ledger = computeClassCardProgress(classId, this.state.cardAwards);
    const { progress, stale } = reconcileCardProgress(
      this.state.cardProgressCache[classId],
      ledger,
    );
    if (stale) this.state.cardProgressCache[classId] = progress;
    return progress;
  }

  private refreshProgress(classIds: readonly string[]): ClassCardProgress[] {
    return [...new Set(classIds)].map((classId) => this.classProgress(classId));
  }

  private toAwardView(award: CardAward): CardAwardView {
    const mission = this.state.missions.find((item) => item.id === award.missionId);
    return {
      ...award,
      sourceLabel: `${award.roundNo}라운드 ${mission?.title ?? '미션'} ${award.rank}위`,
    };
  }
}
