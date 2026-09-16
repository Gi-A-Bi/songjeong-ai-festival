import type { FestivalEvent, MissionPhase, RoundNo, RoundStatus, Submission } from './types';

export interface MissionPhaseInput {
  event: Pick<FestivalEvent, 'status' | 'activeRound'>;
  missionRound: RoundNo;
  roundStatus: RoundStatus;
  submission: Pick<Submission, 'status'> | null;
  finalized: boolean;
}

/** 팀이 보는 미션 상태를 계산한다. */
export function getMissionPhase({
  event,
  roundStatus,
  submission,
  finalized,
}: MissionPhaseInput): MissionPhase {
  if (finalized) return 'closed';
  const submitted = submission !== null && submission.status !== 'draft';
  if (submitted) return roundStatus === 'scoring' ? 'scoring' : 'submitted';
  if (event.status === 'active') return 'active';
  return 'waiting';
}

export function canSubmitInPhase(phase: MissionPhase): boolean {
  return phase === 'active';
}

export const MISSION_PHASE_LABELS: Record<MissionPhase, string> = {
  waiting: '대기 중',
  active: '진행 중',
  submitted: '제출 완료',
  scoring: '채점 중',
  closed: '순위 확정',
};
