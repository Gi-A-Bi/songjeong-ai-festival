import { DEFAULT_ERROR_HUNT_PUZZLES } from './errorHuntPuzzles';
import { isMissionContentHidden, type WaitingReason } from './missionPhase';
import type {
  CircleRegion,
  ErrorHuntBand,
  ErrorHuntConfig,
  ErrorHuntPuzzle,
  Grade,
  MissionPhase,
} from './types';

export const ERROR_HUNT_BAND_LABELS: Record<ErrorHuntBand, string> = {
  grade3: '3학년',
  grade4: '4학년',
  grade56: '5·6학년',
};

/** 골든벨과 같은 묶음: 3학년, 4학년, 5·6학년 */
export function getErrorHuntBand(grade: Grade): ErrorHuntBand {
  if (grade === 3) return 'grade3';
  if (grade === 4) return 'grade4';
  return 'grade56';
}

/**
 * 그 학년이 차례로 푸는 그림.
 * 미션 설정에 학년별 그림이 있으면 그것을, 없으면 프로그램에 든 기본 묶음을 쓴다.
 * 학년을 모르면(null) 학년 공통 그림 한 장이다.
 */
export function getErrorHuntPuzzles(
  config: ErrorHuntConfig,
  grade: Grade | null,
): readonly ErrorHuntPuzzle[] {
  if (grade !== null) {
    const own = config.gradePuzzles?.[grade];
    if (own && own.length > 0) return own;
    const defaults = DEFAULT_ERROR_HUNT_PUZZLES[getErrorHuntBand(grade)];
    if (defaults.length > 0) return defaults;
  }
  return [{ id: 'common', title: '그림', imageKey: config.imageKey, regions: config.regions }];
}

/** 그 학년이 찾아야 하는 곳 전체 */
export function getErrorHuntRegions(config: ErrorHuntConfig, grade: Grade | null): CircleRegion[] {
  return getErrorHuntPuzzles(config, grade).flatMap((puzzle) => puzzle.regions);
}

/** 세로 반지름(높이에 대한 비율). 원이면 가로 반지름을 이미지 비율로 바꾼 값이다. */
export function getRegionRadiusY(region: Pick<CircleRegion, 'r' | 'ry'>, aspect: number): number {
  return region.ry ?? region.r * aspect;
}

/**
 * 게임을 시작하기 전에는 그림을 보여 주지 않는다(모든 미션이 같은 규칙을 쓴다).
 * 남은 시간이 점수가 되므로, 미리 본 팀이 유리해지지 않게 한다.
 */
export function isErrorHuntPictureHidden(phase: MissionPhase, reason: WaitingReason): boolean {
  return isMissionContentHidden(phase, reason);
}

/** 그림 한 장에서 찾은 곳의 수 */
export function countFoundInPuzzle(
  puzzle: Pick<ErrorHuntPuzzle, 'regions'>,
  foundRegionIds: readonly string[],
): number {
  return puzzle.regions.filter((region) => foundRegionIds.includes(region.id)).length;
}

/** 아직 다 찾지 못한 첫 그림의 번호(0부터). 모두 찾았으면 마지막 그림이다. */
export function getFirstOpenPuzzleIndex(
  puzzles: readonly Pick<ErrorHuntPuzzle, 'regions'>[],
  foundRegionIds: readonly string[],
): number {
  const index = puzzles.findIndex(
    (puzzle) => countFoundInPuzzle(puzzle, foundRegionIds) < puzzle.regions.length,
  );
  return index === -1 ? Math.max(0, puzzles.length - 1) : index;
}

/** 그림 묶음을 검사한다. 문제가 없으면 null */
export function getErrorHuntPuzzlesError(puzzles: readonly ErrorHuntPuzzle[]): string | null {
  const ids = new Set<string>();
  for (const [index, puzzle] of puzzles.entries()) {
    const name = `${index + 1}번 그림`;
    if (puzzle.regions.length === 0) return `${name}에 찾을 곳이 없어요.`;
    for (const region of puzzle.regions) {
      if (!region.id || ids.has(region.id)) return `${name}의 정답 ID가 비었거나 겹쳐요.`;
      ids.add(region.id);
      if (!region.label.trim()) return `${name}의 정답 이름이 비었어요.`;
      const ry = region.ry ?? region.r;
      const inside =
        region.x - region.r >= -0.05 &&
        region.x + region.r <= 1.05 &&
        region.y - ry >= -0.05 &&
        region.y + ry <= 1.05;
      if (region.r <= 0 || ry <= 0 || !inside) {
        return `${name}의 “${region.label}” 위치가 그림 밖이에요.`;
      }
    }
  }
  return null;
}
