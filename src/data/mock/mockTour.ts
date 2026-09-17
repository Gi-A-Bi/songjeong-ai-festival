import { getMissionNoForRound, getTeamNoForMission, ROUND_NUMBERS } from '../../domain/rotation';
import {
  ALERT_LABELS,
  applyCheckIn,
  applyResultFinalized,
  applyStationStart,
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
  CardType,
  Grade,
  Mission,
  MissionResult,
  MissionRoundState,
  RoundNo,
  Team,
  TeamMissionState,
} from '../../domain/types';
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

const ACTIVITY_LIMIT = 30;

/** 팀 이동(QR 체크인), 부스 상태, 운영 대시보드의 mock 구현 */
export class MockTourStore {
  private readonly ctx: MockStoreContext;

  constructor(ctx: MockStoreContext) {
    this.ctx = ctx;
  }

  // ---- 팀 이동 기록 ----

  private missionForRound(team: Team, roundNo: RoundNo): Mission {
    const missionNo = getMissionNoForRound(team.teamNo, roundNo);
    const mission = this.ctx.state().missions.find((item) => item.no === missionNo);
    if (!mission) throw new RepositoryError('not-found', '미션을 찾을 수 없어요.');
    return mission;
  }

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
    const clock = getRoundClock(
      this.ctx.state().event,
      team.grade,
      roundNo,
      this.ctx.roundStatusOf(team.grade, roundNo),
      this.ctx.now(),
    );
    return presentTeamMissionState(this.recordOf(team, roundNo), clock);
  }

  // ---- 체크인 ----

  checkIn(team: Team, stationId: string): CheckInOutcome {
    const scannedMission = this.ctx.findMission(stationId);
    const roundNo = getCheckInRound(this.ctx.state().event, team.grade);
    if (roundNo === null) {
      throw new RepositoryError(
        'not-allowed',
        '지금은 미션 투어 시간이 아니에요. 선생님 안내를 기다려 주세요.',
      );
    }
    const expectedMission = this.missionForRound(team, roundNo);
    const before = this.recordOf(team, roundNo);
    if (before.resultId !== null) {
      // 이미 끝낸 미션의 QR을 다시 찍은 경우
      return {
        kind: 'already_checked_in',
        roundNo,
        scannedMission,
        expectedMission,
        state: this.present(team, roundNo),
      };
    }
    const booth = this.storedRound(expectedMission.id, team.grade, roundNo);
    const { record, kind } = applyCheckIn(
      before,
      scannedMission.id,
      this.ctx.now(),
      booth?.status === 'active',
    );
    if (record !== before) this.save(record);

    if (kind === 'checked_in') {
      this.ctx.addActivity({
        id: `check_in__${record.id}`,
        grade: team.grade,
        type: 'check_in',
        message: `${team.displayName} · ${expectedMission.room}(${expectedMission.title}) 입장`,
        classId: team.classId,
        teamId: team.id,
        missionId: expectedMission.id,
        roundNo,
      });
    } else if (kind === 'wrong_station') {
      this.ctx.addActivity({
        id: `wrong__${record.id}__${scannedMission.id}`,
        grade: team.grade,
        type: 'wrong_station',
        message: `${team.displayName} · ${scannedMission.room}에 잘못 입장(가야 할 곳: ${expectedMission.room})`,
        classId: team.classId,
        teamId: team.id,
        missionId: scannedMission.id,
        roundNo,
      });
    }
    if (kind !== 'already_checked_in') this.ctx.notifyOps(team.grade);
    return { kind, roundNo, scannedMission, expectedMission, state: this.present(team, roundNo) };
  }

  /** QR을 찍지 못한 팀을 교사가 직접 입장 처리한다. */
  markArrived(input: MarkArrivedInput): TeamMissionState {
    this.ctx.requireStationAccess(input.missionId);
    const team = this.ctx.findTeam(input.teamId);
    const mission = this.ctx.findMission(input.missionId);
    if (this.missionForRound(team, input.roundNo).id !== mission.id) {
      throw new RepositoryError('invalid-input', '이 라운드에 이 교실로 오는 팀이 아니에요.');
    }
    const before = this.recordOf(team, input.roundNo);
    const booth = this.storedRound(mission.id, team.grade, input.roundNo);
    const { record, kind } = applyCheckIn(
      before,
      mission.id,
      this.ctx.now(),
      booth?.status === 'active',
    );
    if (kind === 'checked_in') {
      this.save(record);
      this.ctx.addActivity({
        id: `check_in__${record.id}`,
        grade: team.grade,
        type: 'check_in',
        message: `${team.displayName} · ${mission.room} 입장(선생님이 직접 처리)`,
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
    const roundNo = getCheckInRound(this.ctx.state().event, team.grade);
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

  private storedRound(missionId: string, grade: Grade, roundNo: RoundNo) {
    return this.ctx.state().missionRoundStates[missionRoundStateId(missionId, grade, roundNo)];
  }

  missionRound(missionId: string, grade: Grade, roundNo: RoundNo): MissionRoundState {
    const mission = this.ctx.findMission(missionId);
    const stored = this.storedRound(mission.id, grade, roundNo);
    // 순위 결과가 원본이다. 결과가 있으면 기록이 없어도 확정한 부스로 본다.
    const prefix = `${resultKey(mission.id, grade, roundNo)}__`;
    const finalized = this.ctx.state().results.find((item) => item.id.startsWith(prefix));
    const base: MissionRoundState = stored ?? {
      id: missionRoundStateId(mission.id, grade, roundNo),
      grade,
      missionId: mission.id,
      roundNo,
      status: 'ready',
      startedAt: null,
      completedAt: null,
      resultFinalizedAt: null,
      updatedBy: null,
    };
    const resultFinalizedAt = base.resultFinalizedAt ?? finalized?.finalizedAt ?? null;
    return {
      ...base,
      resultFinalizedAt,
      completedAt: base.completedAt ?? resultFinalizedAt,
      status: presentMissionRoundStatus(
        { status: base.status, resultFinalizedAt },
        this.ctx.roundStatusOf(grade, roundNo),
      ),
    };
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

  startStation(input: StartStationInput): MissionRoundState {
    const teacher = this.ctx.requireStationAccess(input.missionId);
    const mission = this.ctx.findMission(input.missionId);
    const current = this.missionRound(mission.id, input.grade, input.roundNo);
    // 다시 눌러도 처음 시작 시각을 그대로 쓴다.
    if (current.startedAt !== null || current.status === 'completed') return current;
    if (this.ctx.roundStatusOf(input.grade, input.roundNo) !== 'active') {
      throw new RepositoryError(
        'not-allowed',
        '총괄 선생님이 라운드를 시작한 뒤에 미션을 시작할 수 있어요.',
      );
    }
    const now = this.ctx.now();
    this.ctx.state().missionRoundStates[current.id] = {
      ...current,
      status: 'active',
      startedAt: now,
      updatedBy: teacher.uid,
    };
    for (const team of this.scheduledTeams(mission, input.grade, input.roundNo)) {
      const record = this.recordOf(team, input.roundNo);
      const next = applyStationStart(record, now);
      if (next !== record) this.save(next);
    }
    this.ctx.addActivity({
      id: `start__${current.id}`,
      grade: input.grade,
      type: 'mission_started',
      message: `${input.roundNo}라운드 ${mission.title} 미션 시작`,
      classId: null,
      teamId: null,
      missionId: mission.id,
      roundNo: input.roundNo,
    });
    this.ctx.notifyOps(input.grade);
    return this.missionRound(mission.id, input.grade, input.roundNo);
  }

  /** 순위 확정(또는 수정) 뒤 팀 상태와 부스 상태를 맞춘다. */
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
    const current = this.missionRound(mission.id, grade, roundNo);
    this.ctx.state().missionRoundStates[current.id] = {
      ...current,
      status: 'completed',
      completedAt: current.completedAt ?? now,
      resultFinalizedAt: current.resultFinalizedAt ?? now,
      updatedBy: teacherUid,
    };
    this.ctx.addActivity({
      id: `result__${current.id}`,
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

  /** 대시보드에 보여 줄 라운드: 활동 중이면 지금 라운드, 이동 중이면 다음 라운드(입장 확인용) */
  private displayRound(grade: Grade, requested?: RoundNo): RoundNo {
    if (requested) return requested;
    const event = this.ctx.state().event;
    const target = getCheckInRound(event, grade);
    if (target !== null) return target;
    if (event.activeGrade === grade && event.activeRound !== 0) return event.activeRound;
    // 이 학년이 지금 진행 중이 아니면 마지막으로 진행한 라운드를 보여 준다.
    const played = ROUND_NUMBERS.filter(
      (roundNo) => this.ctx.roundStatusOf(grade, roundNo) !== 'waiting',
    );
    return played.length > 0 ? played[played.length - 1] : 1;
  }

  dashboard(grade: Grade, requestedRound?: RoundNo): OpsDashboard {
    const state = this.ctx.state();
    const roundNo = this.displayRound(grade, requestedRound);
    const missions = [...state.missions].sort((a, b) => a.no - b.no);
    const classes = this.ctx.classesOf(grade);

    const cellOf = (team: Team, round: RoundNo): OpsTeamCell => ({
      team,
      mission: this.missionForRound(team, round),
      state: this.present(team, round),
    });

    const classRows = classes.map((classInfo) => ({
      classInfo,
      cells: this.ctx.teamsOfClass(classInfo.id).map((team) => cellOf(team, roundNo)),
    }));
    const cells = classRows.flatMap((row) => row.cells);

    const stations: OpsStation[] = missions.map((mission) => {
      const teams = cells.filter((cell) => cell.mission.id === mission.id);
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

    // 이동 시간에는 다음 라운드를 보여 주므로, 직전 라운드의 결과 미입력도 함께 알린다.
    const previousCells =
      roundNo > 1 && !requestedRound
        ? classes.flatMap((classInfo) =>
            this.ctx
              .teamsOfClass(classInfo.id)
              .map((team) => cellOf(team, (roundNo - 1) as RoundNo)),
          )
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

    const summary = summarizeTeamStates(cells.map((cell) => cell.state));
    return {
      summary: {
        grade,
        roundNo: state.event.activeGrade === grade && state.event.activeRound === 0 ? 0 : roundNo,
        phase: getRoundPhase(state.event, grade),
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
