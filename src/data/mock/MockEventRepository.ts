import {
  claimTicket as applyTicketClaim,
  computeClassCardCounts,
  countClaimedCards,
  drawCardType,
  isActiveTicket,
  nextTicketIndexes,
  planTicketAdjustment,
  TicketAlreadyClaimedError,
} from '../../domain/cards';
import { EXCHANGE_ERROR_MESSAGES, validateExchange } from '../../domain/exchange';
import { getGoldenBellConfigError } from '../../domain/goldenBell';
import { getSubmissionBlocker } from '../../domain/missionPhase';
import { getRankingEntryError, getTicketCountForRank } from '../../domain/rewards';
import { getRoundForMission, getTeamNoForMission, ROUND_NUMBERS } from '../../domain/rotation';
import { resolveSubmissionScore } from '../../domain/scoring';
import type {
  CardCounts,
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
import { RepositoryError } from '../errors';
import type {
  ClassCardRow,
  CreateExchangeInput,
  DevTools,
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
import { resultId, resultKey, roundKey, submissionId, toTeamId } from './keys';
import { createSeedState, DEV_TEACHER, type MockState } from './seed';

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

  private state: MockState;
  private readonly latencyMs: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly eventListeners = new Set<(event: FestivalEvent) => void>();
  private readonly missionStateListeners = new Map<string, Set<() => void>>();
  private shouldFailNext = false;
  private teacher: TeacherProfile | null = null;

  constructor(options: MockEventRepositoryOptions = {}) {
    this.latencyMs = options.latencyMs ?? 0;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.state = createSeedState(this.now());
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
    this.requireTeacher();
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
      this.updateEvent({ status: 'ready', roundEndsAt: null, pausedRemainingMs: null });
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
      });
    }
    return clone(this.state.event);
  }

  async setActiveGrade(eventId: string, grade: Grade): Promise<FestivalEvent> {
    await this.request();
    this.assertEvent(eventId);
    this.requireTeacher();
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
    this.requireTeacher();
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
    const joinedAt = this.now();
    this.state.sessions[team.id] = joinedAt;
    return { eventId, teamId: team.id, joinedAt };
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
        const tickets = result ? this.activeTicketsOf(result.id) : [];
        return {
          team,
          submission: stored ? { ...stored, score: resolveSubmissionScore(stored, mission) } : null,
          result,
          ticketCount: tickets.length,
          claimedTicketCount: tickets.filter((ticket) => ticket.claimedAt !== null).length,
        };
      }),
    );
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
    this.requireTeacher();
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
    const teacher = this.requireTeacher();
    const mission = this.findMission(input.missionId);
    const key = resultKey(mission.id, input.grade, input.roundNo);

    // 이미 확정된 묶음은 다시 만들지 않는다(중복 클릭·재시도 안전).
    const existing = this.state.results.filter((item) => item.id.startsWith(`${key}__`));
    if (existing.length > 0) {
      return clone({
        results: existing,
        ticketsByTeam: this.ticketsByTeam(existing),
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

    for (const result of results) {
      const team = this.findTeam(result.teamId);
      const count = getTicketCountForRank(result.rank);
      for (let index = 1; index <= count; index += 1) {
        this.state.tickets.push(this.newTicket(result.id, index, team, now));
      }
      this.markVerified(mission.id, team.id, result.score, now);
    }
    this.state.results.push(...results);
    this.state.processedRequests[input.requestId] = key;
    this.touchMissionState(mission.id, input.grade, input.roundNo, {});

    return clone({ results, ticketsByTeam: this.ticketsByTeam(results), alreadyFinalized: false });
  }

  async reviseRanking(input: FinalizeRankingInput): Promise<ReviseRankingOutcome> {
    await this.request();
    this.assertEvent(input.eventId);
    const teacher = this.requireTeacher();
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
    let added = 0;
    let revoked = 0;
    let revokedClaimed = 0;
    const results: MissionResult[] = [];
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

      const tickets = this.state.tickets.filter((ticket) => ticket.sourceResultId === id);
      const plan = planTicketAdjustment(tickets, getTicketCountForRank(entry.rank));
      const indexes = nextTicketIndexes(
        tickets.map((ticket) => ticket.id),
        plan.createCount,
      );
      for (const ticketNo of indexes)
        this.state.tickets.push(this.newTicket(id, ticketNo, team, now));
      const revokeIds = new Set(plan.revokeIds);
      this.state.tickets = this.state.tickets.map((ticket) =>
        revokeIds.has(ticket.id) ? { ...ticket, revokedAt: now } : ticket,
      );
      added += plan.createCount;
      revoked += plan.revokeIds.length;
      revokedClaimed += plan.revokedClaimed;
      this.markVerified(mission.id, team.id, entry.score, now);
    }
    this.state.processedRequests[input.requestId] = key;
    this.touchMissionState(mission.id, input.grade, input.roundNo, {});

    return clone({
      results,
      ticketsByTeam: this.ticketsByTeam(results),
      added,
      revoked,
      revokedClaimed,
    });
  }

  async reopenSubmission(input: ReopenSubmissionInput): Promise<void> {
    await this.request();
    this.assertEvent(input.eventId);
    this.requireTeacher();
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

  // ---- 카드 ----

  async listTeamTickets(eventId: string, teamId: string): Promise<TicketView[]> {
    await this.request();
    this.assertEvent(eventId);
    const team = this.findTeam(teamId);
    return this.state.tickets
      .filter((ticket) => ticket.teamId === team.id && isActiveTicket(ticket))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map((ticket) => ({
        id: ticket.id,
        claimed: ticket.claimedAt !== null,
        cardType: ticket.claimedAt !== null ? ticket.cardType : null,
        sourceLabel: this.describeTicketSource(ticket),
      }));
  }

  async claimTicket(eventId: string, teamId: string, ticketId: string): Promise<CardType> {
    await this.request();
    this.assertEvent(eventId);
    const index = this.state.tickets.findIndex(
      (ticket) => ticket.id === ticketId && ticket.teamId === teamId,
    );
    if (index === -1 || !isActiveTicket(this.state.tickets[index])) {
      throw new RepositoryError('not-found', '뽑기권을 찾을 수 없어요.');
    }
    try {
      const claimed = applyTicketClaim(this.state.tickets[index], this.now());
      this.state.tickets[index] = claimed;
      return claimed.cardType;
    } catch (error) {
      if (error instanceof TicketAlreadyClaimedError) throw new RepositoryError('already-claimed');
      throw error;
    }
  }

  async getTeamCardSummary(eventId: string, teamId: string): Promise<TeamCardSummary> {
    await this.request();
    this.assertEvent(eventId);
    const team = this.findTeam(teamId);
    const classInfo = this.findClass(team.classId);
    return {
      team: countClaimedCards(this.state.tickets.filter((ticket) => ticket.teamId === team.id)),
      class: this.classCounts(classInfo.id),
      classDisplayName: classInfo.displayName,
    };
  }

  async listClassCardRows(eventId: string, grade: Grade): Promise<ClassCardRow[]> {
    await this.request();
    this.assertEvent(eventId);
    return this.classesOf(grade).map((classInfo) => ({
      classInfo: clone(classInfo),
      counts: this.classCounts(classInfo.id),
    }));
  }

  async listExchanges(eventId: string, grade: Grade): Promise<Exchange[]> {
    await this.request();
    this.assertEvent(eventId);
    const classIds = new Set(this.classesOf(grade).map((classInfo) => classInfo.id));
    return clone(
      this.state.exchanges
        .filter((exchange) => classIds.has(exchange.fromClassId))
        .sort((a, b) => b.createdAt - a.createdAt),
    );
  }

  async createExchange(input: CreateExchangeInput): Promise<Exchange> {
    await this.request();
    this.assertEvent(input.eventId);
    const teacher = this.requireTeacher();

    const processedId = this.state.processedRequests[input.requestId];
    const processed = this.state.exchanges.find((exchange) => exchange.id === processedId);
    if (processed) return clone(processed);

    const from = this.state.classes.find((item) => item.id === input.fromClassId);
    const to = this.state.classes.find((item) => item.id === input.toClassId);
    if (!from || !to) {
      throw new RepositoryError('invalid-input', EXCHANGE_ERROR_MESSAGES['missing-class']);
    }
    if (from.grade !== to.grade) {
      throw new RepositoryError('invalid-input', '같은 학년 학급끼리만 교환할 수 있어요.');
    }
    const validationError = validateExchange(input, this.classCounts(from.id));
    if (validationError) {
      throw new RepositoryError(
        validationError === 'insufficient-cards' ? 'insufficient-cards' : 'invalid-input',
        EXCHANGE_ERROR_MESSAGES[validationError],
      );
    }

    const exchange: Exchange = {
      id: `exchange-${this.state.exchanges.length + 1}`,
      requestId: input.requestId,
      fromClassId: from.id,
      toClassId: to.id,
      cardType: input.cardType,
      quantity: input.quantity,
      status: 'completed',
      createdBy: teacher.uid,
      createdAt: this.now(),
      reversesExchangeId: null,
    };
    this.state.exchanges.push(exchange);
    this.state.processedRequests[input.requestId] = exchange.id;
    return clone(exchange);
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
  }

  private notifyMissionState(key: string): void {
    for (const listener of this.missionStateListeners.get(key) ?? []) listener();
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

  private newTicket(sourceResultId: string, index: number, team: Team, now: number): DrawTicket {
    return {
      id: `${sourceResultId}__${index}`,
      teamId: team.id,
      classId: team.classId,
      sourceResultId,
      cardType: drawCardType(this.random),
      claimedAt: null,
      revokedAt: null,
      createdAt: now,
    };
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

  private activeTicketsOf(sourceResultId: string): DrawTicket[] {
    return this.state.tickets.filter(
      (ticket) => ticket.sourceResultId === sourceResultId && isActiveTicket(ticket),
    );
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

  private classCounts(classId: string): CardCounts {
    return computeClassCardCounts(classId, this.state.tickets, this.state.exchanges);
  }

  private ticketsByTeam(results: readonly MissionResult[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const result of results) {
      counts[result.teamId] = this.activeTicketsOf(result.id).length;
    }
    return counts;
  }

  private describeTicketSource(ticket: DrawTicket): string {
    const result = this.state.results.find((item) => item.id === ticket.sourceResultId);
    if (!result) return '개발용 시작 카드';
    const mission = this.state.missions.find((item) => item.id === result.missionId);
    return `${result.roundNo}라운드 ${mission?.title ?? '미션'} ${result.rank}위`;
  }
}
