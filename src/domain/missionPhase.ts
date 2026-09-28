import type {
  FestivalEvent,
  Grade,
  MissionPhase,
  MissionRoundStatus,
  RoundNo,
  RoundStatus,
  Submission,
} from './types';

/** 한 팀이 보는 행사 상태(scopeEventToTeam)에서 라운드 판단에 쓰는 값 */
type EventRoundState = Pick<
  FestivalEvent,
  'status' | 'activeGrade' | 'activeRound' | 'boothStatus'
>;

/** 이 학년·라운드가 그 팀이 지금 게임 중인 라운드인지 */
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
  const playing = isCurrentMissionRound(event, grade, missionRound) && event.status === 'active';
  // 게임 시간이 끝났거나 라운드를 종료했으면 더 제출할 수 없다.
  // 미션 정보를 읽은 뒤에 시간이 끝났을 수 있어 팀이 보는 부스 단계도 함께 본다.
  const ended =
    roundStatus === 'scoring' ||
    roundStatus === 'closed' ||
    (playing && event.boothStatus === 'scoring');
  const submitted = submission !== null && submission.status !== 'draft';
  if (submitted) return ended ? 'scoring' : 'submitted';
  if (isReopened(submission)) return 'active';
  if (ended) return 'waiting';
  return playing ? 'active' : 'waiting';
}

export function canSubmitInPhase(phase: MissionPhase): boolean {
  return phase === 'active';
}

/**
 * 대기 상태일 때 학생에게 알려 줄 이유.
 * idle(우리 학년 시간이 아님), not-opened(선생님이 라운드를 열기 전), opened(입장 중, 게임 시작 전),
 * upcoming(아직 차례가 아닌 미션), missed(시간이 끝난 미션)
 */
export type WaitingReason = 'idle' | 'not-opened' | 'opened' | 'upcoming' | 'missed';

export function getWaitingReason({
  event,
  grade,
  missionRound,
  roundStatus,
}: Omit<MissionPhaseInput, 'submission' | 'finalized'>): WaitingReason {
  if (event.activeGrade !== grade) return 'idle';
  if (roundStatus === 'scoring' || roundStatus === 'closed') return 'missed';
  if (isCurrentMissionRound(event, grade, missionRound) && event.boothStatus === 'scoring') {
    return 'missed';
  }
  // 팀이 지금 가야 하는 라운드: 게임 중이면 그 라운드, 부스에 들어가기 전이면 다음 라운드
  const current = event.status === 'active' ? event.activeRound : event.activeRound + 1;
  if (missionRound < current) return 'missed';
  if (missionRound > current) return 'upcoming';
  return event.boothStatus === 'open' ? 'opened' : 'not-opened';
}

export interface SubmissionGateInput {
  /** 이 학년이 지금 진행할 학년인지 */
  touring: boolean;
  /** 이 미션을 하는 부스 라운드의 단계 */
  boothStatus: MissionRoundStatus;
  /** 교사가 제출을 되돌려 다시 낼 수 있는 상태 */
  reopened: boolean;
}

/** 저장소에서 제출을 받을 수 있는지 검사한다. 받을 수 없으면 학생에게 보여 줄 문장을 돌려준다. */
export function getSubmissionBlocker({
  touring,
  boothStatus,
  reopened,
}: SubmissionGateInput): string | null {
  if (reopened) return null;
  if (!touring) return '지금은 미션 투어 시간이 아니에요. 선생님 안내를 기다려 주세요.';
  if (boothStatus === 'active') return null;
  if (boothStatus === 'scoring' || boothStatus === 'completed') {
    return '게임 시간이 끝났어요. 제출하지 못했다면 선생님께 말해 주세요.';
  }
  return '아직 제출할 수 없어요. 선생님이 게임을 시작하면 다시 눌러 주세요.';
}

export const MISSION_PHASE_LABELS: Record<MissionPhase, string> = {
  waiting: '대기 중',
  active: '진행 중',
  submitted: '제출 완료',
  scoring: '채점 중',
  closed: '순위 확정',
};
