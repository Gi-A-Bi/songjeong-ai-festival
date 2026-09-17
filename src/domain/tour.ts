import { CHECK_IN_GRACE_MS } from '../config';
import type {
  AlertCode,
  FestivalEvent,
  Grade,
  MissionRoundState,
  MissionRoundStatus,
  RoundNo,
  RoundStatus,
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

/** 부스 교사가 미션을 시작하면 입장한 팀이 진행 중이 된다. */
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

/** 한 팀 상태를 계산할 때 필요한 라운드 시계 */
export interface RoundClock {
  /** 이 라운드가 아직 시작 전인지, 활동 중인지, 끝났는지 */
  phase: 'before' | 'active' | 'ended';
  /** 활동을 시작한 뒤 흐른 시간(일시정지 시간 제외) */
  activeElapsedMs: number;
  /** 라운드가 끝난 뒤 흐른 시간. 다음 라운드가 이미 시작됐으면 Infinity */
  endedElapsedMs: number;
  /** 결과 미입력 경고를 띄우기까지 기다리는 시간(이동 시간) */
  resultGraceMs: number;
}

export function getRoundClock(
  event: FestivalEvent,
  grade: Grade,
  roundNo: RoundNo,
  roundStatus: RoundStatus,
  now: number,
): RoundClock {
  const isCurrent = event.activeGrade === grade && event.activeRound === roundNo;
  const base = { resultGraceMs: event.moveDurationMs };
  if (roundStatus === 'waiting') {
    return { ...base, phase: 'before', activeElapsedMs: 0, endedElapsedMs: 0 };
  }
  if (roundStatus === 'active') {
    let remaining = event.roundDurationMs;
    if (isCurrent && event.status === 'paused') {
      remaining = event.pausedRemainingMs ?? remaining;
    } else if (isCurrent && event.roundEndsAt !== null) {
      remaining = Math.max(0, event.roundEndsAt - now);
    }
    return {
      ...base,
      phase: 'active',
      activeElapsedMs: Math.max(0, event.roundDurationMs - remaining),
      endedElapsedMs: 0,
    };
  }
  const endedElapsedMs =
    isCurrent && event.roundEndedAt !== null
      ? Math.max(0, now - event.roundEndedAt)
      : Number.POSITIVE_INFINITY;
  return { ...base, phase: 'ended', activeElapsedMs: event.roundDurationMs, endedElapsedMs };
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
    return clock.phase === 'ended' ? 'moving' : 'completed';
  }
  if (alerts.length > 0) return 'attention';
  // 라운드가 끝난 뒤 결과를 기다리는 동안은 "결과 입력 중"으로 진행 중 색을 쓴다.
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

/** 부스 상태: 라운드가 끝났는데 결과를 확정하지 않았으면 채점 중 */
export function presentMissionRoundStatus(
  stored: Pick<MissionRoundState, 'status' | 'resultFinalizedAt'> | undefined,
  roundStatus: RoundStatus,
): MissionRoundStatus {
  if (stored?.resultFinalizedAt != null) return 'completed';
  if (roundStatus === 'scoring' || roundStatus === 'closed') return 'scoring';
  return stored?.status === 'active' ? 'active' : 'ready';
}

/**
 * 지금 QR을 찍으면 몇 라운드 입장인지. 이동 시간에는 다음 라운드 교실에 미리 입장한다.
 * 이 학년의 투어 중이 아니거나 5라운드까지 끝났으면 null
 */
export function getCheckInRound(event: FestivalEvent, grade: Grade): RoundNo | null {
  if (event.activeGrade !== grade) return null;
  if (event.activeRound === 0) return 1;
  if (event.status === 'active' || event.status === 'paused') return event.activeRound;
  return event.activeRound < 5 ? ((event.activeRound + 1) as RoundNo) : null;
}

export type RoundPhase = 'ready' | 'active' | 'moving' | 'ended';

/** 대시보드 상단의 라운드 상태: 준비, 활동 중, 이동 중, 종료 */
export function getRoundPhase(event: FestivalEvent, grade: Grade): RoundPhase {
  if (event.activeGrade !== grade || event.activeRound === 0) return 'ready';
  if (event.status === 'active' || event.status === 'paused') return 'active';
  return event.activeRound === 5 ? 'ended' : 'moving';
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
  ready: '준비',
  active: '진행 중',
  scoring: '결과 입력 중',
  completed: '결과 확정',
};

export const ROUND_PHASE_LABELS: Record<RoundPhase, string> = {
  ready: '준비',
  active: '활동 중',
  moving: '이동 중',
  ended: '종료',
};
