import {
  canCheckInAtBooth,
  getBoothActionBlocker,
  getBoothClock,
  getBoothCurrentRound,
  getBoothStatus,
  getTeamCurrentRound,
  scopeEventToTeam,
  type BoothAction,
} from '../../domain/boothRound';
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
  applyStationStart,
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
  CardType,
  FestivalEvent,
  Grade,
  Mission,
  MissionNo,
  MissionResult,
  MissionRoundState,
  RoundNo,
  Team,
  TeamMissionState,
} from '../../domain/types';
import { missionRoom } from '../../domain/missionRoom';
import { matchesStationCode } from '../../domain/stationCode';
import { RepositoryError } from '../errors';
import type {
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
} from '../EventRepository';
import { resultId, resultKey, submissionId } from './keys';
import type { MockStoreContext } from './mockContext';
import type { MockBooth } from './seed';

const ACTIVITY_LIMIT = 30;

const ACTION_LABELS: Record<BoothAction, string> = {
  open: '라운드 열기',
  start: '게임 시작',
  close: '라운드 종료',
  skip: '라운드 건너뛰기',
};

/** 팀 이동(교실 입장), 부스 라운드, 운영 대시보드의 mock 구현 */
export class MockTourStore {
  private readonly ctx: MockStoreContext;

  constructor(ctx: MockStoreContext) {
    this.ctx = ctx;
  }

  // ---- 부스 기록 ----

  private missionByNo(missionNo: MissionNo): Mission {
    const mission = this.ctx.state().missions.find((item) => item.no === missionNo);
    if (!mission) throw new RepositoryError('not-found', '미션을 찾을 수 없어요.');
    return mission;
  }

  private missionForRound(team: Team, roundNo: RoundNo): Mission {
    return this.missionByNo(getMissionNoForRound(team.teamNo, roundNo));
  }

  /**
   * 저장된 부스 기록. 순위 결과가 원본이므로, 기록이 없어도 결과가 있으면 순위를 확정한 부스로 본다.
   */
  boothOf(missionId: string, grade: Grade, roundNo: RoundNo): MockBooth | undefined {
    const id = missionRoundStateId(missionId, grade, roundNo);
    const stored = this.ctx.state().missionRoundStates[id];
    if (stored?.resultFinalizedAt != null) return stored;
    const prefix = `${resultKey(missionId, grade, roundNo)}__`;
    const finalized = this.ctx.state().results.find((item) => item.id.startsWith(prefix));
    if (!finalized) return stored;
    const base = stored ?? this.emptyBooth(missionId, grade, roundNo);
    return { ...base, resultFinalizedAt: finalized.finalizedAt };
  }

  private emptyBooth(missionId: string, grade: Grade, roundNo: RoundNo): MockBooth {
    return {
      id: missionRoundStateId(missionId, grade, roundNo),
      grade,
      missionId,
      roundNo,
      openedAt: null,
      startedAt: null,
      durationMs: this.ctx.state().event.gameDurationMs,
      resultFinalizedAt: null,
      completedAt: null,
      skipped: false,
      updatedBy: null,
    };
  }

  /** 그 라운드에 이 팀의 순위가 나왔는지 */
  private rankedOf(team: Team) {
    return (roundNo: RoundNo) =>
      this.resultOf(team, this.missionForRound(team, roundNo), roundNo) !== undefined;
  }

  private boothByNo(grade: Grade) {
    return (missionNo: MissionNo, roundNo: RoundNo) =>
      this.boothOf(this.missionByNo(missionNo).id, grade, roundNo);
  }

  /** 이 학년의 모든 부스·라운드가 끝났는지(최종 미션을 열 수 있는지 볼 때 쓴다) */
  allRoundsCompleted(grade: Grade): boolean {
    return this.ctx
      .state()
      .missions.every((mission) =>
        ROUND_NUMBERS.every(
          (roundNo) => (this.boothOf(mission.id, grade, roundNo)?.completedAt ?? null) !== null,
        ),
      );
  }

  /** 이 학년에 열어 두고 아직 종료하지 않은 부스가 있는지(학년을 바꾸기 전에 확인한다) */
  hasOpenBooth(grade: Grade): boolean {
    const now = this.ctx.now();
    return this.ctx.state().missions.some((mission) =>
      ROUND_NUMBERS.some((roundNo) => {
        const status = getBoothStatus(this.boothOf(mission.id, grade, roundNo), now);
        return status !== 'ready' && status !== 'completed';
      }),
    );
  }

  /** 한 팀이 보는 행사 상태. 팀이 지금 가야 하는 부스의 단계로 채운다. */
  teamEvent(team: Team): FestivalEvent {
    return scopeEventToTeam(
      this.ctx.state().event,
      team,
      this.boothByNo(team.grade),
      this.ctx.now(),
      this.rankedOf(team),
    );
  }

  // ---- 팀 이동 기록 ----

  private resultOf(team: Team, mission: Mission, roundNo: RoundNo): MissionResult | undefined {
    const id = resultId(resultKey(mission.id, team.grade, roundNo), team.id);
    return this.ctx.state().results.find((item) => item.id === id);
  }

  /**
   * 저장된 기록이 없으면 빈 기록을 돌려준다. 순위 결과가 원본이므로
   * 기록이 없어도 결과가 있으면 완료한 것으로 맞춘다.
   */
  recordOf(team: Team, roundNo: RoundNo): TeamMissionRecord {
    const mission = this.missionForRound(team, roundNo);
    const stored =
      this.ctx.state().teamMissionRecords[teamMissionStateId(team.classId, team.teamNo, roundNo)];
    const record =
      stored ??
      emptyTeamMissionRecord({
        grade: team.grade,
        classId: team.classId,
        teamId: team.id,
        teamNo: team.teamNo,
        roundNo,
        expectedMissionId: mission.id,
      });
    const result = this.resultOf(team, mission, roundNo);
    return result ? applyResultFinalized(record, result.id, result.finalizedAt) : record;
  }

  private save(record: TeamMissionRecord): void {
    this.ctx.state().teamMissionRecords[record.id] = record;
  }

  present(team: Team, roundNo: RoundNo): TeamMissionState {
    const mission = this.missionForRound(team, roundNo);
    const clock = getBoothClock(this.boothOf(mission.id, team.grade, roundNo), this.ctx.now());
    return presentTeamMissionState(this.recordOf(team, roundNo), clock);
  }

  // ---- 체크인 ----

  private boothStatus(mission: Mission, grade: Grade, roundNo: RoundNo) {
    return getBoothStatus(this.boothOf(mission.id, grade, roundNo), this.ctx.now());
  }

  /**
   * 교실 인증코드로 입장한다. 이번 라운드에 가야 할 교실이어야 하고,
   * 선생님이 라운드를 열었어야 하며, 코드가 맞아야 기록한다.
   */
  checkIn(team: Team, stationId: string, accessCode: string): CheckInOutcome {
    const mission = this.ctx.findMission(stationId);
    const roundNo = getCheckInRound(this.teamEvent(team), team.grade);
    if (roundNo === null) {
      throw new RepositoryError(
        'not-allowed',
        '지금은 미션 투어 시간이 아니에요. 선생님 안내를 기다려 주세요.',
      );
    }
    const expectedMission = this.missionForRound(team, roundNo);
    if (mission.id !== expectedMission.id) {
      throw new RepositoryError(
        'not-allowed',
        getRoundForMission(team.teamNo, mission.no) < roundNo
          ? `이미 지나간 미션이에요. 우리 팀은 지금 ${roundNo}라운드 ${missionRoom(expectedMission, team.grade)}으로 가요.`
          : `아직 차례가 아닌 미션이에요. 우리 팀은 지금 ${roundNo}라운드 ${missionRoom(expectedMission, team.grade)}으로 가요.`,
      );
    }
    const before = this.recordOf(team, roundNo);
    // 이번 라운드 순위가 이미 나왔으면 입장한 것으로 본다.
    if (before.resultId !== null || before.checkedInAt !== null) {
      return { kind: 'already_checked_in', roundNo, mission, state: this.present(team, roundNo) };
    }
    const status = this.boothStatus(mission, team.grade, roundNo);
    if (!canCheckInAtBooth(status)) {
      throw new RepositoryError(
        'not-allowed',
        '선생님이 라운드를 열면 들어갈 수 있어요. 교실 앞에서 잠깐 기다려 주세요.',
      );
    }
    if (!matchesStationCode(this.ctx.state().stationCodes[mission.id] ?? null, accessCode)) {
      throw new RepositoryError(
        'invalid-input',
        '인증코드가 달라요. 교실 선생님께 인증코드를 다시 확인해 주세요.',
      );
    }
    const { record, kind } = applyCheckIn(before, mission.id, this.ctx.now(), status === 'active');
    if (kind !== 'checked_in') {
      return { kind: 'already_checked_in', roundNo, mission, state: this.present(team, roundNo) };
    }
    this.save(record);
    this.ctx.addActivity({
      id: `check_in__${record.id}`,
      grade: team.grade,
      type: 'check_in',
      message: `${team.displayName} · ${missionRoom(mission, team.grade)}(${mission.title}) 입장`,
      classId: team.classId,
      teamId: team.id,
      missionId: mission.id,
      roundNo,
    });
    this.ctx.notifyOps(team.grade);
    return { kind, roundNo, mission, state: this.present(team, roundNo) };
  }

  /** 인증코드를 넣지 못한 팀을 교사가 직접 입장 처리한다. */
  markArrived(input: MarkArrivedInput): TeamMissionState {
    this.ctx.requireTeacher();
    const team = this.ctx.findTeam(input.teamId);
    const mission = this.ctx.findMission(input.missionId);
    if (this.missionForRound(team, input.roundNo).id !== mission.id) {
      throw new RepositoryError('invalid-input', '이 라운드에 이 교실로 오는 팀이 아니에요.');
    }
    const status = this.boothStatus(mission, team.grade, input.roundNo);
    if (status === 'completed') {
      throw new RepositoryError('not-allowed', '이미 종료한 라운드예요.');
    }
    const before = this.recordOf(team, input.roundNo);
    const { record, kind } = applyCheckIn(before, mission.id, this.ctx.now(), status === 'active');
    if (kind === 'checked_in') {
      this.save(record);
      this.ctx.addActivity({
        id: `check_in__${record.id}`,
        grade: team.grade,
        type: 'check_in',
        message: `${team.displayName} · ${missionRoom(mission, team.grade)} 입장(선생님이 직접 처리)`,
        classId: team.classId,
        teamId: team.id,
        missionId: mission.id,
        roundNo: input.roundNo,
      });
      this.ctx.notifyOps(team.grade);
    }
    return this.present(team, input.roundNo);
  }

  tourStatus(team: Team): TeamTourStatus {
    const roundNo = getCheckInRound(this.teamEvent(team), team.grade);
    if (roundNo === null) {
      return { roundNo: null, state: null, expectedMission: null, nextMission: null };
    }
    return {
      roundNo,
      state: this.present(team, roundNo),
      expectedMission: this.missionForRound(team, roundNo),
      nextMission: roundNo < 5 ? this.missionForRound(team, (roundNo + 1) as RoundNo) : null,
    };
  }

  // ---- 부스 ----

  missionRound(missionId: string, grade: Grade, roundNo: RoundNo): MissionRoundState {
    const mission = this.ctx.findMission(missionId);
    const booth = this.boothOf(mission.id, grade, roundNo);
    return presentMissionRound(
      {
        id: missionRoundStateId(mission.id, grade, roundNo),
        grade,
        missionId: mission.id,
        roundNo,
      },
      booth,
      booth?.updatedBy ?? null,
      this.ctx.now(),
    );
  }

  /** 이 부스의 1~5라운드 상태 */
  stationRounds(missionId: string, grade: Grade): MissionRoundState[] {
    return ROUND_NUMBERS.map((roundNo) => this.missionRound(missionId, grade, roundNo));
  }

  arrivals(missionId: string, grade: Grade, roundNo: RoundNo): StationArrivals {
    const mission = this.ctx.findMission(missionId);
    return {
      booth: this.missionRound(mission.id, grade, roundNo),
      movements: this.scheduledTeams(mission, grade, roundNo).map((team) =>
        this.present(team, roundNo),
      ),
    };
  }

  /**
   * 라운드 열기 → 게임 시작 → 라운드 종료(또는 건너뛰기).
   * 같은 단계를 다시 눌러도 처음 기록을 그대로 둔다.
   */
  advanceStation(action: BoothAction, input: StartStationInput): MissionRoundState {
    const teacher = this.ctx.requireTeacher();
    const mission = this.ctx.findMission(input.missionId);
    const state = this.ctx.state();
    const id = missionRoundStateId(mission.id, input.grade, input.roundNo);
    const current =
      this.boothOf(mission.id, input.grade, input.roundNo) ??
      this.emptyBooth(mission.id, input.grade, input.roundNo);
    const done =
      (action === 'open' && current.openedAt !== null) ||
      (action === 'start' && current.startedAt !== null) ||
      ((action === 'close' || action === 'skip') && current.completedAt !== null);
    if (done) return this.missionRound(mission.id, input.grade, input.roundNo);

    const previous =
      input.roundNo === 1
        ? undefined
        : this.boothOf(mission.id, input.grade, (input.roundNo - 1) as RoundNo);
    const blocker = getBoothActionBlocker(action, {
      status: getBoothStatus(current, this.ctx.now()),
      touring: state.event.activeGrade === input.grade,
      previousCompleted: input.roundNo === 1 || (previous?.completedAt ?? null) !== null,
      rankingFinalized: current.resultFinalizedAt !== null,
    });
    if (blocker) throw new RepositoryError('not-allowed', blocker);

    const now = this.ctx.now();
    const next: MockBooth = { ...current, updatedBy: teacher.uid };
    if (action === 'open') next.openedAt = now;
    if (action === 'start') {
      next.openedAt ??= now;
      next.startedAt = now;
      next.durationMs = state.event.gameDurationMs;
      for (const team of this.scheduledTeams(mission, input.grade, input.roundNo)) {
        const record = this.recordOf(team, input.roundNo);
        const started = applyStationStart(record, now);
        if (started !== record) this.save(started);
      }
    }
    if (action === 'close') next.completedAt = now;
    if (action === 'skip') {
      next.completedAt = now;
      next.skipped = true;
    }
    state.missionRoundStates[id] = next;

    this.ctx.addActivity({
      id: `${action}__${id}`,
      grade: input.grade,
      type: action === 'close' || action === 'skip' ? 'round_changed' : 'mission_started',
      message: `${mission.title}(${missionRoom(mission, input.grade)}) ${input.roundNo}라운드 · ${ACTION_LABELS[action]}`,
      classId: null,
      teamId: null,
      missionId: mission.id,
      roundNo: input.roundNo,
    });
    this.ctx.notifyOps(input.grade);
    return this.missionRound(mission.id, input.grade, input.roundNo);
  }

  /** 순위 확정(또는 수정) 뒤 팀 상태와 부스 상태를 맞춘다. 라운드는 선생님이 따로 종료한다. */
  onRankingFinalized(
    mission: Mission,
    results: readonly MissionResult[],
    teacherUid: string,
  ): void {
    if (results.length === 0) return;
    const { grade, roundNo } = results[0];
    const now = this.ctx.now();
    for (const result of results) {
      const team = this.ctx.findTeam(result.teamId);
      this.save(applyResultFinalized(this.recordOf(team, roundNo), result.id, now));
    }
    const id = missionRoundStateId(mission.id, grade, roundNo);
    const current =
      this.boothOf(mission.id, grade, roundNo) ?? this.emptyBooth(mission.id, grade, roundNo);
    this.ctx.state().missionRoundStates[id] = {
      ...current,
      resultFinalizedAt: current.resultFinalizedAt ?? now,
      updatedBy: teacherUid,
    };
    this.ctx.addActivity({
      id: `result__${id}`,
      grade,
      type: 'result_finalized',
      message: `${roundNo}라운드 ${mission.title} 결과 확정(${results.length}팀)`,
      classId: null,
      teamId: null,
      missionId: mission.id,
      roundNo,
    });
    this.ctx.notifyOps(grade);
  }

  /** 카드 조각 획득·카드 완성 기록 */
  onCardEarned(team: Team, awardId: string, cardType: CardType, cardName: string): void {
    const progress = this.ctx.classProgress(team.classId).cards[cardType];
    this.ctx.addActivity({
      id: `card__${awardId}`,
      grade: team.grade,
      type: 'card_earned',
      message: `${team.displayName} · ${cardName} 조각 획득(${progress.pieces}/4${
        progress.duplicates > 0 ? `, 중복 +${progress.duplicates}` : ''
      })`,
      classId: team.classId,
      teamId: team.id,
      missionId: null,
      roundNo: null,
    });
    if (progress.complete && progress.duplicates === 0) {
      this.ctx.addActivity({
        id: `card_done__${team.classId}__${cardType}`,
        grade: team.grade,
        type: 'card_completed',
        message: `${this.ctx.findClass(team.classId).displayName} · ${cardName} 완성!`,
        classId: team.classId,
        teamId: null,
        missionId: null,
        roundNo: null,
      });
    }
    this.ctx.notifyOps(team.grade);
  }

  private scheduledTeams(mission: Mission, grade: Grade, roundNo: RoundNo): Team[] {
    const teamNo = getTeamNoForMission(mission.no, roundNo);
    return this.ctx
      .classesOf(grade)
      .flatMap((classInfo) =>
        this.ctx.teamsOfClass(classInfo.id).filter((team) => team.teamNo === teamNo),
      );
  }

  // ---- 대시보드 ----

  /** 이 부스가 지금 진행할 라운드. 다섯 라운드를 모두 끝냈으면 5라운드를 보여 준다. */
  stationRound(mission: Mission, grade: Grade): RoundNo {
    return getBoothCurrentRound((roundNo) => this.boothOf(mission.id, grade, roundNo)) ?? 5;
  }

  private teamRound(team: Team): RoundNo {
    return getTeamCurrentRound(team.teamNo, this.boothByNo(team.grade), this.rankedOf(team)) ?? 5;
  }

  /**
   * roundNo를 주면 그 라운드의 모습을, 주지 않으면 지금 모습을 보여 준다.
   * 부스마다 따로 진행하므로 지금 모습에서는 부스와 팀이 저마다 자기 라운드에 있다.
   */
  dashboard(grade: Grade, requestedRound?: RoundNo): OpsDashboard {
    const state = this.ctx.state();
    const now = this.ctx.now();
    const missions = [...state.missions].sort((a, b) => a.no - b.no);
    const classes = this.ctx.classesOf(grade);

    const cellOf = (team: Team, round: RoundNo): OpsTeamCell => ({
      team,
      mission: this.missionForRound(team, round),
      state: this.present(team, round),
    });

    const classRows = classes.map((classInfo) => ({
      classInfo,
      cells: this.ctx
        .teamsOfClass(classInfo.id)
        .map((team) => cellOf(team, requestedRound ?? this.teamRound(team))),
    }));

    const stations: OpsStation[] = missions.map((mission) => {
      const roundNo = requestedRound ?? this.stationRound(mission, grade);
      const teams = this.scheduledTeams(mission, grade, roundNo).map((team) =>
        cellOf(team, roundNo),
      );
      return {
        mission,
        round: this.missionRound(mission.id, grade, roundNo),
        teams,
        submitted: teams.filter((cell) => {
          const submission = state.submissions[submissionId(mission.id, cell.team.id)];
          return submission !== undefined && submission.status !== 'draft';
        }).length,
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
    // 시각으로 계산한 경고는 처음 발견했을 때 한 번만 활동 기록에 남긴다.
    for (const alert of alerts) {
      if (alert.code === 'wrong_station') continue;
      this.ctx.addActivity({
        id: `alert__${alert.id}`,
        grade,
        type: 'alert',
        message: `확인 필요: ${alert.message}`,
        classId: alert.team.classId,
        teamId: alert.team.id,
        missionId: alert.mission.id,
        roundNo: alert.roundNo,
      });
    }

    const statuses = missions.flatMap((mission) =>
      ROUND_NUMBERS.map((roundNo) => getBoothStatus(this.boothOf(mission.id, grade, roundNo), now)),
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
      activity: this.recentActivity(grade),
    };
  }

  recentActivity(grade: Grade): ActivityEvent[] {
    return Object.values(this.ctx.state().activityEvents)
      .filter((event) => event.grade === grade)
      .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
      .slice(0, ACTIVITY_LIMIT);
  }

  /** 학급 상세의 팀별 위치·순위·카드 */
  classTeams(classId: string): ClassOpsTeam[] {
    const state = this.ctx.state();
    return this.ctx.teamsOfClass(classId).map((team) => {
      const status = this.tourStatus(team);
      const results = state.results
        .filter((result) => result.teamId === team.id)
        .sort((a, b) => a.roundNo - b.roundNo);
      return {
        team,
        currentMission: status.expectedMission,
        nextMission: status.nextMission,
        state: status.state,
        completedCount: results.length,
        results: ROUND_NUMBERS.map((roundNo) => {
          const mission = this.missionForRound(team, roundNo);
          const result = results.find((item) => item.roundNo === roundNo);
          return { roundNo, mission, rank: result?.rank ?? null };
        }),
        earnedTypes: state.cardAwards.flatMap((award) =>
          award.teamId === team.id && award.status === 'claimed' && award.selectedType
            ? [award.selectedType]
            : [],
        ),
      };
    });
  }
}
