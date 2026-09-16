import type { FestivalEvent, Grade, MissionPhase, RoundNo, RoundStatus, Submission } from './types';

type EventRoundState = Pick<FestivalEvent, 'status' | 'activeGrade' | 'activeRound'>;

/** 이 학년·라운드가 행사에서 지금 진행 중인 라운드인지(일시정지 포함) */
export function isCurrentMissionRound(event: EventRoundState, grade: Grade, roundNo: RoundNo) {
  return event.activeGrade === grade && event.activeRound === roundNo;
}

export interface MissionPhaseInput {
  event: EventRoundState;
  grade: Grade;
  missionRound: RoundNo;
  roundStatus: RoundStatus;
  submission: Pick<Submission, 'status' | 'reopened'> | null;
  finalized: boolean;
}

function isReopened(submission: MissionPhaseInput['submission']): boolean {
  return submission !== null && submission.status === 'draft' && submission.reopened;
}

/**
 * 팀이 보는 미션 상태를 계산한다.
 * 제출은 이 미션이 지금 진행 중인 라운드일 때, 또는 교사가 다시 내도록 허락했을 때만 열린다.
 */
export function getMissionPhase({
  event,
  grade,
  missionRound,
  roundStatus,
  submission,
  finalized,
}: MissionPhaseInput): MissionPhase {
  if (finalized) return 'closed';
  const submitted = submission !== null && submission.status !== 'draft';
  if (submitted) {
    return roundStatus === 'scoring' || roundStatus === 'closed' ? 'scoring' : 'submitted';
  }
  if (isReopened(submission)) return 'active';
  if (isCurrentMissionRound(event, grade, missionRound) && event.status === 'active') {
    return 'active';
  }
  return 'waiting';
}

export function canSubmitInPhase(phase: MissionPhase): boolean {
  return phase === 'active';
}

/** 대기 상태일 때 학생에게 알려 줄 이유 */
export type WaitingReason = 'not-started' | 'paused' | 'upcoming' | 'missed';

export function getWaitingReason({
  event,
  grade,
  missionRound,
  roundStatus,
}: Omit<MissionPhaseInput, 'submission' | 'finalized'>): WaitingReason {
  if (event.activeGrade !== grade || event.activeRound === 0) return 'not-started';
  if (missionRound < event.activeRound) return 'missed';
  if (missionRound > event.activeRound) return 'upcoming';
  if (event.status === 'paused') return 'paused';
  if (roundStatus === 'scoring' || roundStatus === 'closed') return 'missed';
  return 'not-started';
}

export interface SubmissionGateInput {
  event: EventRoundState;
  grade: Grade;
  roundNo: RoundNo;
  /** 교사가 제출을 되돌려 다시 낼 수 있는 상태 */
  reopened: boolean;
}

/** 저장소에서 제출을 받을 수 있는지 검사한다. 받을 수 없으면 학생에게 보여 줄 문장을 돌려준다. */
export function getSubmissionBlocker({
  event,
  grade,
  roundNo,
  reopened,
}: SubmissionGateInput): string | null {
  if (reopened) return null;
  if (!isCurrentMissionRound(event, grade, roundNo)) {
    return '지금 라운드의 미션이 아니에요. 팀 홈에서 지금 미션을 확인해 주세요.';
  }
  if (event.status === 'paused') {
    return '잠시 멈췄어요. 선생님이 다시 시작하면 제출해 주세요.';
  }
  if (event.status !== 'active') {
    return '지금은 제출할 수 없어요. 선생님이 라운드를 시작하면 다시 눌러 주세요.';
  }
  return null;
}

export const MISSION_PHASE_LABELS: Record<MissionPhase, string> = {
  waiting: '대기 중',
  active: '진행 중',
  submitted: '제출 완료',
  scoring: '채점 중',
  closed: '순위 확정',
};
