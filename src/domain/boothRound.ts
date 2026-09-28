import { DEFAULT_GAME_DURATION_MS, RESULT_GRACE_MS } from '../config';
import { getMissionNoForRound, ROUND_NUMBERS } from './rotation';
import type {
  FestivalEvent,
  Grade,
  MissionNo,
  MissionRoundState,
  MissionRoundStatus,
  RoundNo,
  RoundStatus,
  TeamNo,
} from './types';

/**
 * 저장된 부스 라운드 기록. 단계는 저장하지 않고 시각으로 계산한다.
 * 게임 시간이 끝나는 순간을 데이터베이스에 따로 쓰지 않아도 모든 화면이 같은 단계를 본다.
 */
export interface BoothTimes {
  openedAt: number | null;
  startedAt: number | null;
  /** 게임을 시작할 때 정한 게임 시간(ms) */
  durationMs: number;
  resultFinalizedAt: number | null;
  /** 라운드를 종료한 시각 */
  completedAt: number | null;
}

export const EMPTY_BOOTH: BoothTimes = {
  openedAt: null,
  startedAt: null,
  durationMs: DEFAULT_GAME_DURATION_MS,
  resultFinalizedAt: null,
  completedAt: null,
};

/** 게임이 끝나는 시각. 아직 시작하지 않았으면 null */
export function getBoothEndsAt(booth: BoothTimes | undefined): number | null {
  if (!booth || booth.startedAt === null) return null;
  return booth.startedAt + booth.durationMs;
}

export function getBoothStatus(booth: BoothTimes | undefined, now: number): MissionRoundStatus {
  if (!booth) return 'ready';
  if (booth.completedAt !== null) return 'completed';
  const endsAt = getBoothEndsAt(booth);
  if (endsAt !== null) {
    // 순위를 확정했으면 시간이 남아 있어도 더 받을 제출이 없다.
    return now >= endsAt || booth.resultFinalizedAt !== null ? 'scoring' : 'active';
  }
  // 게임을 시작하지 않고 순위부터 확정한 부스(수동 복구)는 채점 단계로 본다.
  if (booth.resultFinalizedAt !== null) return 'scoring';
  return booth.openedAt !== null ? 'open' : 'ready';
}

/**
 * 화면이 부스 상태를 읽은 뒤 시간이 흘러 게임 시간이 끝났으면 채점 단계로 본다.
 * 게임이 끝나는 순간에는 저장된 값이 바뀌지 않아 화면이 스스로 계산한다.
 */
export function getLiveRoundStatus(
  round: Pick<MissionRoundState, 'status' | 'endsAt'>,
  now: number,
): MissionRoundStatus {
  return round.status === 'active' && round.endsAt !== null && now >= round.endsAt
    ? 'scoring'
    : round.status;
}

/** 팀 상태 계산과 학생 화면이 쓰는 라운드 상태 모양으로 바꾼다. */
export function toRoundStatus(status: MissionRoundStatus): RoundStatus {
  if (status === 'active') return 'active';
  if (status === 'scoring') return 'scoring';
  if (status === 'completed') return 'closed';
  return 'waiting';
}

/** 학생이 지금 이 부스에 입장(QR 체크인)할 수 있는지. 라운드를 연 뒤부터 종료 전까지다. */
export function canCheckInAtBooth(status: MissionRoundStatus): boolean {
  return status === 'open' || status === 'active' || status === 'scoring';
}

export type BoothAction = 'open' | 'start' | 'close';

export interface BoothActionContext {
  status: MissionRoundStatus;
  /** 이 학년이 지금 진행할 학년인지 */
  touring: boolean;
  /** 이 부스가 바로 앞 라운드를 끝냈는지(1라운드는 늘 true) */
  previousCompleted: boolean;
  rankingFinalized: boolean;
}

/** 부스에서 지금 이 일을 할 수 없는 이유. 할 수 있으면 null */
export function getBoothActionBlocker(
  action: BoothAction,
  { status, touring, previousCompleted, rankingFinalized }: BoothActionContext,
): string | null {
  if (status === 'completed') return '이미 종료한 라운드예요.';
  if (!touring) return '총괄 선생님이 이 학년을 진행 학년으로 골라야 시작할 수 있어요.';
  if (action === 'open') {
    if (!previousCompleted) return '앞 라운드를 종료한 뒤에 다음 라운드를 열 수 있어요.';
    return null;
  }
  if (action === 'start') {
    if (status === 'ready') return '라운드를 먼저 열어 주세요.';
    return null;
  }
  if (status === 'ready' || status === 'open') return '게임을 시작한 뒤에 종료할 수 있어요.';
  if (!rankingFinalized) return '순위를 확정한 뒤에 라운드를 종료할 수 있어요.';
  return null;
}

/** 이 부스가 지금 진행할 라운드: 아직 종료하지 않은 첫 라운드. 5라운드를 모두 끝냈으면 null */
export function getBoothCurrentRound(
  boothOf: (roundNo: RoundNo) => BoothTimes | undefined,
): RoundNo | null {
  return ROUND_NUMBERS.find((roundNo) => (boothOf(roundNo)?.completedAt ?? null) === null) ?? null;
}

type BoothLookup = (missionNo: MissionNo, roundNo: RoundNo) => BoothTimes | undefined;

/**
 * 한 팀의 지금 라운드: 팀이 도는 순서대로 부스를 보며 아직 종료하지 않은 첫 라운드.
 * 5라운드를 모두 끝냈으면 null
 */
export function getTeamCurrentRound(teamNo: TeamNo, boothOf: BoothLookup): RoundNo | null {
  return (
    ROUND_NUMBERS.find(
      (roundNo) =>
        (boothOf(getMissionNoForRound(teamNo, roundNo), roundNo)?.completedAt ?? null) === null,
    ) ?? null
  );
}

const NO_ROUND = {
  activeRound: 0,
  roundEndsAt: null,
  roundEndedAt: null,
  boothStatus: null,
} as const;

/** 전체 행사 상태. 팀이 보는 라운드 값은 비운다. */
export function toGlobalEvent(event: FestivalEvent): FestivalEvent {
  return { ...event, ...NO_ROUND, status: event.activeGrade === null ? 'ready' : 'active' };
}

/**
 * 한 팀이 보는 행사 상태를 만든다. 라운드는 부스마다 따로 진행하므로 팀마다 다르다.
 * - 부스에 들어가기 전(열기 전·입장 중): 앞 라운드를 끝내고 이동하는 상태
 * - 게임 중·채점 중: 지금 라운드가 진행 중(채점 중에는 종료 시각이 지나 있다)
 */
export function scopeEventToTeam(
  event: FestivalEvent,
  team: { grade: Grade; teamNo: TeamNo },
  boothOf: BoothLookup,
  now: number,
): FestivalEvent {
  const base: FestivalEvent = { ...event, ...NO_ROUND, status: 'ready' };
  if (event.activeGrade !== team.grade) return base;

  const roundNo = getTeamCurrentRound(team.teamNo, boothOf);
  if (roundNo === null) {
    const last = boothOf(getMissionNoForRound(team.teamNo, 5), 5);
    return { ...base, activeRound: 5, roundEndedAt: last?.completedAt ?? null };
  }
  const booth = boothOf(getMissionNoForRound(team.teamNo, roundNo), roundNo);
  const boothStatus = getBoothStatus(booth, now);
  if (boothStatus === 'active' || boothStatus === 'scoring') {
    return {
      ...base,
      status: 'active',
      activeRound: roundNo,
      roundEndsAt: getBoothEndsAt(booth),
      boothStatus,
    };
  }
  const previousRound = (roundNo - 1) as 0 | RoundNo;
  const previous =
    previousRound === 0
      ? undefined
      : boothOf(getMissionNoForRound(team.teamNo, previousRound), previousRound);
  return {
    ...base,
    activeRound: previousRound,
    roundEndedAt: previous?.completedAt ?? null,
    boothStatus,
  };
}

/**
 * 시간이 흘러 팀이 보는 상태가 바뀌는 다음 시각(게임 종료 시각). 없으면 null.
 * 구독 중인 화면이 그때 상태를 다시 계산한다.
 */
export function getNextBoothChangeAt(booths: readonly BoothTimes[], now: number): number | null {
  const times = booths
    .filter((booth) => booth.completedAt === null && booth.resultFinalizedAt === null)
    .map(getBoothEndsAt)
    .filter((endsAt): endsAt is number => endsAt !== null && endsAt > now);
  return times.length > 0 ? Math.min(...times) : null;
}

export interface RoundClock {
  /** 게임을 아직 시작하지 않았는지, 게임 중인지, 끝났는지 */
  phase: 'before' | 'active' | 'ended';
  /** 라운드를 종료해 팀이 다음 교실로 이동하는지 */
  closed: boolean;
  /** 게임을 시작한 뒤 흐른 시간 */
  activeElapsedMs: number;
  /** 게임이 끝난 뒤 흐른 시간 */
  endedElapsedMs: number;
  /** 결과 미입력 경고를 띄우기까지 기다리는 시간 */
  resultGraceMs: number;
}

/** 한 팀·한 라운드의 상태를 계산할 때 쓰는 시계. 그 라운드의 부스가 기준이다. */
export function getBoothClock(booth: BoothTimes | undefined, now: number): RoundClock {
  const status = getBoothStatus(booth, now);
  const base = { resultGraceMs: RESULT_GRACE_MS, closed: status === 'completed' };
  const endsAt = getBoothEndsAt(booth);
  if (!booth || status === 'ready' || status === 'open') {
    return { ...base, phase: 'before', activeElapsedMs: 0, endedElapsedMs: 0 };
  }
  if (status === 'active') {
    return {
      ...base,
      phase: 'active',
      activeElapsedMs: Math.max(0, now - (booth.startedAt ?? now)),
      endedElapsedMs: 0,
    };
  }
  const endedAt = Math.min(
    endsAt ?? Number.POSITIVE_INFINITY,
    booth.resultFinalizedAt ?? Number.POSITIVE_INFINITY,
    booth.completedAt ?? Number.POSITIVE_INFINITY,
  );
  return {
    ...base,
    phase: 'ended',
    activeElapsedMs: booth.durationMs,
    endedElapsedMs: Number.isFinite(endedAt) ? Math.max(0, now - endedAt) : 0,
  };
}

/**
 * 부스 진행 순서(BOOTH_STEPS)에서 끝낸 단계 수. 이 번호의 단계가 지금 할 일이다.
 * 순위는 게임 중에도 확정할 수 있어 단계와 따로 받는다.
 */
export function getBoothStepIndex(status: MissionRoundStatus, rankingFinalized: boolean): number {
  if (status === 'ready') return 0;
  if (status === 'open') return 1;
  if (status === 'completed') return 4;
  return rankingFinalized ? 3 : 2;
}

export const BOOTH_STEPS: readonly { status: MissionRoundStatus; label: string }[] = [
  { status: 'open', label: '라운드 열기' },
  { status: 'active', label: '게임 시작' },
  { status: 'scoring', label: '순위 매기기' },
  { status: 'completed', label: '라운드 종료' },
];
