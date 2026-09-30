import type { Mission, OzobotAnswer, OzobotConfig, OzobotSolve } from './types';

/**
 * 로봇 길찾기(오조봇) 도전 과제.
 * 팀은 난이도를 고르면 그 난이도의 카드 하나를 무작위로 받고, 보드판(6×6)에 길 조각을 이어
 * 출발 칸에서 도착 칸까지 길을 만든다. 선생님이 오조봇으로 길을 지나가 보고 성공을 기록한다.
 * 제한 시간 안에 성공한 카드의 별 점수를 더해 순위를 정한다.
 */

export type OzobotLevel = 1 | 2 | 3;

/** 보드판 칸. 행은 A(아래)~F(위), 열은 1(왼쪽)~6(오른쪽) */
export type OzobotRow = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type OzobotCol = 1 | 2 | 3 | 4 | 5 | 6;

export interface OzobotCell {
  row: OzobotRow;
  col: OzobotCol;
}

/** 길 조각 종류: 직선, 꺾인 길, 교차로, 색 코드(좌회전·우회전·직진) */
export type OzobotTileKind = 'straight' | 'corner' | 'cross' | 'left' | 'right' | 'forward';

export interface OzobotChallenge {
  /** 카드 번호(실물 카드의 "Mission N"). 선생님이 실물 카드와 맞춰 볼 수 있게 그대로 쓴다. */
  id: string;
  cardNo: number;
  level: OzobotLevel;
  start: OzobotCell;
  goal: OzobotCell;
  /** 쓸 수 있는 길 조각과 개수(카드 아래쪽에 적힌 그대로) */
  tiles: Partial<Record<OzobotTileKind, number>>;
}

export const OZOBOT_ROWS: readonly OzobotRow[] = ['F', 'E', 'D', 'C', 'B', 'A'];
export const OZOBOT_COLS: readonly OzobotCol[] = [1, 2, 3, 4, 5, 6];
export const OZOBOT_LEVELS: readonly OzobotLevel[] = [1, 2, 3];

/** 별 1개 5점, 2개 10점, 3개 20점 */
export const OZOBOT_POINTS: Record<OzobotLevel, number> = { 1: 5, 2: 10, 3: 20 };

/** 로봇 길찾기 기본 제한 시간(분). 다른 부스의 게임 시간과 따로 정한다. */
export const OZOBOT_DEFAULT_MINUTES = 7;

export const OZOBOT_TILE_ORDER: readonly OzobotTileKind[] = [
  'straight',
  'corner',
  'cross',
  'right',
  'left',
  'forward',
];

export const OZOBOT_TILE_LABELS: Record<OzobotTileKind, string> = {
  straight: '직선',
  corner: '꺾인 길',
  cross: '교차로',
  left: '좌회전',
  right: '우회전',
  forward: '직진',
};

/** 사진으로 찍은 도전 과제 카드 8종(2026-09-30) */
export const OZOBOT_CHALLENGES: readonly OzobotChallenge[] = [
  {
    id: 'card-4',
    cardNo: 4,
    level: 1,
    start: { row: 'B', col: 1 },
    goal: { row: 'C', col: 4 },
    tiles: { straight: 5, corner: 4 },
  },
  {
    id: 'card-5',
    cardNo: 5,
    level: 1,
    start: { row: 'D', col: 1 },
    goal: { row: 'D', col: 6 },
    tiles: { corner: 10 },
  },
  {
    id: 'card-6',
    cardNo: 6,
    level: 2,
    start: { row: 'E', col: 6 },
    goal: { row: 'A', col: 4 },
    tiles: { straight: 5, corner: 6 },
  },
  {
    id: 'card-7',
    cardNo: 7,
    level: 2,
    start: { row: 'E', col: 4 },
    goal: { row: 'B', col: 4 },
    tiles: { straight: 6, corner: 6 },
  },
  {
    id: 'card-9',
    cardNo: 9,
    level: 2,
    start: { row: 'D', col: 3 },
    goal: { row: 'D', col: 5 },
    tiles: { straight: 4, corner: 3, cross: 1, left: 1 },
  },
  {
    id: 'card-11',
    cardNo: 11,
    level: 3,
    start: { row: 'D', col: 1 },
    goal: { row: 'C', col: 6 },
    tiles: { straight: 2, corner: 1, cross: 2, left: 2 },
  },
  {
    id: 'card-12',
    cardNo: 12,
    level: 3,
    start: { row: 'E', col: 3 },
    goal: { row: 'C', col: 1 },
    tiles: { straight: 4, corner: 3, cross: 2, right: 1, forward: 1 },
  },
  {
    id: 'card-15',
    cardNo: 15,
    level: 3,
    start: { row: 'A', col: 6 },
    goal: { row: 'F', col: 1 },
    tiles: { straight: 4, corner: 3, cross: 3, right: 1, left: 1, forward: 1 },
  },
];

export function findOzobotChallenge(id: string): OzobotChallenge | undefined {
  return OZOBOT_CHALLENGES.find((challenge) => challenge.id === id);
}

export function ozobotChallengesOf(level: OzobotLevel): OzobotChallenge[] {
  return OZOBOT_CHALLENGES.filter((challenge) => challenge.level === level);
}

export function formatOzobotCell(cell: OzobotCell): string {
  return `${cell.row}${cell.col}`;
}

export function ozobotStars(level: OzobotLevel): string {
  return '★'.repeat(level);
}

/** 예전 답안(준비 완료만 알리던 것)에는 성공 기록이 없다. */
export function getOzobotSolved(answer: Pick<OzobotAnswer, 'solved'> | null | undefined) {
  return answer?.solved ?? [];
}

/** 성공한 카드의 별 점수 합. 같은 카드는 한 번만 센다. */
export function calculateOzobotScore(solved: readonly OzobotSolve[]): number {
  const seen = new Set<string>();
  let total = 0;
  for (const item of solved) {
    if (seen.has(item.challengeId)) continue;
    seen.add(item.challengeId);
    total += OZOBOT_POINTS[item.level] ?? 0;
  }
  return total;
}

/**
 * 그 난이도에서 아직 성공하지 않은 카드 가운데 하나를 무작위로 고른다.
 * 지금 보고 있는 카드(except)는 다른 카드가 있으면 피한다. 남은 카드가 없으면 null
 */
export function pickOzobotChallenge(
  level: OzobotLevel,
  solvedIds: readonly string[],
  except: string | null = null,
  random: () => number = Math.random,
): OzobotChallenge | null {
  const open = ozobotChallengesOf(level).filter((item) => !solvedIds.includes(item.id));
  if (open.length === 0) return null;
  const others = open.filter((item) => item.id !== except);
  const pool = others.length > 0 ? others : open;
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[index];
}

/** 부스에서 게임을 시작할 때 쓰는 게임 시간. 로봇 길찾기는 따로 정한 시간(기본 7분)을 쓴다. */
export function getMissionGameDurationMs(
  mission: Pick<Mission, 'config'>,
  eventDurationMs: number,
): number {
  if (mission.config.type === 'ozobot') {
    return getOzobotMinutes(mission.config) * 60_000;
  }
  return eventDurationMs;
}

export function getOzobotMinutes(config: Pick<OzobotConfig, 'timeLimitMinutes'>): number {
  const minutes = config.timeLimitMinutes;
  return typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 1 && minutes <= 30
    ? minutes
    : OZOBOT_DEFAULT_MINUTES;
}
