import { CHECK_IN_GRACE_MS } from '../config';
import { getBoothEndsAt, getBoothStatus, type BoothTimes, type RoundClock } from './boothRound';
import type {
  AlertCode,
  FestivalEvent,
  Grade,
  MissionRoundState,
  MissionRoundStatus,
  RoundNo,
  TeamMissionState,
  TeamMissionStatus,
  TeamNo,
} from './types';

/** 학급·팀·라운드별 고정 ID. 같은 QR을 다시 찍어도 기록이 하나만 남는다. */
export function teamMissionStateId(classId: string, teamNo: TeamNo, roundNo: RoundNo): string {
  return `${classId}_${teamNo}_${roundNo}`;
}

/** 부스의 학년·라운드별 고정 ID */
export function missionRoundStateId(missionId: string, grade: Grade, roundNo: RoundNo): string {
  return `${missionId}_g${grade}_r${roundNo}`;
}

/**
 * 저장하는 팀 이동 기록. 화면에 보이는 상태와 시간 경고는 읽을 때 계산한다
 * (타이머를 데이터베이스에 매초 쓰지 않기 위해서다).
 */
export interface TeamMissionRecord {
  id: string;
  grade: Grade;
  classId: string;
  teamId: string;
  teamNo: TeamNo;
  roundNo: RoundNo;
  expectedMissionId: string;
  actualMissionId: string | null;
  /** 예정과 다른 교실 QR을 찍은 기록. 올바른 교실에 입장하면 지운다. */
  wrongStationId: string | null;
  /** 총괄 운영자가 직접 확인이 필요하다고 표시한 경우 */
  manualReview: boolean;
  checkedInAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  resultId: string | null;
  updatedAt: number;
}

export function emptyTeamMissionRecord(
  input: Pick<TeamMissionRecord, 'grade' | 'classId' | 'teamId' | 'teamNo' | 'roundNo'> & {
    expectedMissionId: string;
  },
): TeamMissionRecord {
  return {
    ...input,
    id: teamMissionStateId(input.classId, input.teamNo, input.roundNo),
    actualMissionId: null,
    wrongStationId: null,
    manualReview: false,
    checkedInAt: null,
    startedAt: null,
    completedAt: null,
    resultId: null,
    updatedAt: 0,
  };
}

export type CheckInKind = 'checked_in' | 'already_checked_in' | 'wrong_station';

/**
 * 미션 교실 QR 체크인. 예정 교실이면 입장, 다시 찍으면 그대로, 다른 교실이면 경고만 남긴다.
 * boothActive면 이미 시작한 부스에 늦게 들어온 것이므로 바로 진행 중으로 본다.
 */
export function applyCheckIn(
  record: TeamMissionRecord,
  scannedMissionId: string,
  now: number,
  boothActive = false,
): { record: TeamMissionRecord; kind: CheckInKind } {
  if (scannedMissionId !== record.expectedMissionId) {
    // 이미 올바른 교실에 입장한 팀이 다른 QR을 찍은 것은 위치 기록을 바꾸지 않는다.
    if (record.checkedInAt !== null) return { record, kind: 'wrong_station' };
    return {
      record: {
        ...record,
        actualMissionId: scannedMissionId,
        wrongStationId: scannedMissionId,
        updatedAt: now,
      },
      kind: 'wrong_station',
    };
  }
  if (record.checkedInAt !== null) return { record, kind: 'already_checked_in' };
  return {
    record: {
      ...record,
      actualMissionId: scannedMissionId,
      wrongStationId: null,
      checkedInAt: now,
      startedAt: boothActive ? now : record.startedAt,
      updatedAt: now,
    },
    kind: 'checked_in',
  };
}

/** 부스에서 미션을 시작하면 입장한 팀이 진행 중이 된다. */
export function applyStationStart(record: TeamMissionRecord, now: number): TeamMissionRecord {
  if (record.checkedInAt === null || record.startedAt !== null || record.resultId !== null) {
    return record;
  }
  return { ...record, startedAt: now, updatedAt: now };
}

/** 결과 확정. 체크인을 놓친 팀도 결과가 있으면 완료로 본다. */
export function applyResultFinalized(
  record: TeamMissionRecord,
  resultId: string,
  now: number,
): TeamMissionRecord {
  if (record.resultId === resultId) return record;
  return {
    ...record,
    resultId,
    completedAt: record.completedAt ?? now,
    wrongStationId: null,
    updatedAt: now,
  };
}

/** 저장된 경고(오입장·수동 확인)와 시각으로 계산한 경고(미도착·결과 미입력) */
export function getTeamAlerts(
  record: TeamMissionRecord,
  clock: RoundClock,
  graceMs: number = CHECK_IN_GRACE_MS,
): AlertCode[] {
  if (record.resultId !== null) return record.manualReview ? ['manual_review'] : [];
  const alerts: AlertCode[] = [];
  if (record.wrongStationId !== null && record.checkedInAt === null) alerts.push('wrong_station');
  if (clock.phase === 'active' && record.checkedInAt === null && clock.activeElapsedMs >= graceMs) {
    alerts.push('not_arrived');
  }
  if (clock.phase === 'ended' && clock.endedElapsedMs >= clock.resultGraceMs) {
    alerts.push('result_missing');
  }
  if (record.manualReview) alerts.push('manual_review');
  return alerts;
}

/** scheduled → checked_in → active → completed → moving, 예외는 attention */
export function getTeamMissionStatus(
  record: TeamMissionRecord,
  clock: RoundClock,
  alerts: readonly AlertCode[],
): TeamMissionStatus {
  if (record.resultId !== null) {
    if (alerts.length > 0) return 'attention';
    // 순위를 확정하면 완료, 선생님이 라운드를 종료하면 다음 교실로 이동한다.
    return clock.closed ? 'moving' : 'completed';
  }
  if (alerts.length > 0) return 'attention';
  // 게임이 끝난 뒤 결과를 기다리는 동안은 "결과 입력 중"으로 진행 중 색을 쓴다.
  if (record.startedAt !== null || (clock.phase === 'ended' && record.checkedInAt !== null)) {
    return 'active';
  }
  if (record.checkedInAt !== null) return 'checked_in';
  return 'scheduled';
}

export function presentTeamMissionState(
  record: TeamMissionRecord,
  clock: RoundClock,
  graceMs: number = CHECK_IN_GRACE_MS,
): TeamMissionState {
  const alertCodes = getTeamAlerts(record, clock, graceMs);
  return {
    id: record.id,
    grade: record.grade,
    classId: record.classId,
    teamId: record.teamId,
    teamNo: record.teamNo,
    roundNo: record.roundNo,
    expectedMissionId: record.expectedMissionId,
    actualMissionId: record.actualMissionId,
    status: getTeamMissionStatus(record, clock, alertCodes),
    alertCodes,
    checkedInAt: record.checkedInAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    resultId: record.resultId,
    updatedAt: record.updatedAt,
  };
}

/** 저장된 부스 기록에 지금 시각으로 계산한 단계를 붙여 화면에 보낸다. */
export function presentMissionRound(
  key: Pick<MissionRoundState, 'id' | 'grade' | 'missionId' | 'roundNo'>,
  booth: BoothTimes | undefined,
  updatedBy: string | null,
  now: number,
): MissionRoundState {
  return {
    ...key,
    status: getBoothStatus(booth, now),
    openedAt: booth?.openedAt ?? null,
    startedAt: booth?.startedAt ?? null,
    endsAt: getBoothEndsAt(booth),
    completedAt: booth?.completedAt ?? null,
    resultFinalizedAt: booth?.resultFinalizedAt ?? null,
    skipped: booth?.skipped ?? false,
    updatedBy,
  };
}

/**
 * 팀이 지금 가야 하는 라운드. event는 그 팀이 보는 행사 상태(scopeEventToTeam)여야 한다.
 * 부스에 들어가기 전에는 다음 라운드, 게임 중에는 지금 라운드다.
 * 이 학년의 투어 중이 아니거나 5라운드까지 끝났으면 null
 */
export function getCheckInRound(event: FestivalEvent, grade: Grade): RoundNo | null {
  if (event.activeGrade !== grade) return null;
  if (event.activeRound === 0) return 1;
  if (event.status === 'active') return event.activeRound;
  return event.activeRound < 5 ? ((event.activeRound + 1) as RoundNo) : null;
}

export type RoundPhase = 'ready' | 'active' | 'moving' | 'ended';

/**
 * 대시보드 상단의 학년 진행 상태. 부스마다 따로 진행하므로 모든 부스·라운드의 단계를 모아 본다.
 * 준비(아무 부스도 열지 않음), 진행 중(열린 부스가 있음), 이동 중(열린 부스 없이 다음 라운드를 기다림), 종료
 */
export function getTourPhase(statuses: readonly MissionRoundStatus[]): RoundPhase {
  if (statuses.length > 0 && statuses.every((status) => status === 'completed')) return 'ended';
  if (statuses.some((status) => status !== 'ready' && status !== 'completed')) return 'active';
  return statuses.some((status) => status === 'completed') ? 'moving' : 'ready';
}

export interface TourSummary {
  expectedTeams: number;
  checkedInTeams: number;
  completedTeams: number;
  alertCount: number;
}

export function summarizeTeamStates(
  states: readonly Pick<TeamMissionState, 'checkedInAt' | 'resultId' | 'status'>[],
): TourSummary {
  return {
    expectedTeams: states.length,
    checkedInTeams: states.filter((state) => state.checkedInAt !== null || state.resultId !== null)
      .length,
    completedTeams: states.filter((state) => state.resultId !== null).length,
    alertCount: states.filter((state) => state.status === 'attention').length,
  };
}

export const TEAM_MISSION_STATUS_LABELS: Record<TeamMissionStatus, string> = {
  scheduled: '입장 전',
  checked_in: '입장 완료',
  active: '진행 중',
  completed: '완료',
  moving: '이동 중',
  attention: '확인 필요',
};

export const ALERT_LABELS: Record<AlertCode, string> = {
  not_arrived: '미도착',
  wrong_station: '잘못된 교실',
  result_missing: '결과 미입력',
  duplicate_scan: '중복 스캔',
  manual_review: '직접 확인',
};

export const MISSION_ROUND_STATUS_LABELS: Record<MissionRoundStatus, string> = {
  ready: '열기 전',
  open: '입장 중',
  active: '게임 중',
  scoring: '순위 매기는 중',
  completed: '라운드 종료',
};

export const ROUND_PHASE_LABELS: Record<RoundPhase, string> = {
  ready: '준비',
  active: '진행 중',
  moving: '이동 중',
  ended: '종료',
};
