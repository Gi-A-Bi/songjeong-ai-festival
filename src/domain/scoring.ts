import { getErrorHuntRegions, getRegionRadiusY } from './errorHunt';
import { getGoldenBellQuestions, isGoldenBellCorrect } from './goldenBell';
import { hasLibraryCheckAnswerKey, scoreLibraryCheck } from './libraryCheck';
import type {
  CircleRegion,
  ErrorHuntConfig,
  GoldenBellAnswer,
  GoldenBellConfig,
  Grade,
  Mission,
  MissionConfig,
  Submission,
  SubmissionAnswer,
} from './types';

/**
 * 골든벨: 맞힌 문제 수. 그 학년이 푸는 문제를 지금 등록된 내용 기준으로 센다.
 * 학년을 모르면(null) 공통 문제로 센다.
 */
export function countGoldenBellCorrect(
  config: GoldenBellConfig,
  answer: GoldenBellAnswer,
  grade: Grade | null = null,
): number {
  return getGoldenBellQuestions(config, grade).filter((question) =>
    isGoldenBellCorrect(question, answer),
  ).length;
}

export interface ErrorHuntScoreInput {
  found: number;
  total: number;
  remainingSeconds: number;
  wrongTaps: number;
}

/**
 * 틀린그림 찾기 점수: 찾은 수×100 − 오답×20, 최저 0점.
 * 남은 초×2 시간 보너스는 모두 찾았을 때만 준다.
 * (보너스를 늘 주면 하나도 안 찾고 바로 내는 편이 유리해진다.)
 */
export function calculateErrorHuntScore({
  found,
  total,
  remainingSeconds,
  wrongTaps,
}: ErrorHuntScoreInput) {
  const base = found * 100;
  const allFound = total > 0 && found >= total;
  const timeBonus = allFound ? Math.max(0, Math.floor(remainingSeconds)) * 2 : 0;
  const penalty = wrongTaps * 20;
  return Math.max(0, base + timeBonus - penalty);
}

/** 그 학년이 푸는 그림의 정답 영역만, 한 번씩만 센다. */
export function countErrorHuntFound(
  config: ErrorHuntConfig,
  foundRegionIds: readonly string[],
  grade: Grade | null = null,
) {
  const valid = new Set(getErrorHuntRegions(config, grade).map((region) => region.id));
  return new Set(foundRegionIds.filter((id) => valid.has(id))).size;
}

/** 자동 채점 미션만 점수를 계산한다. 교사 판정 미션은 null. */
export function calculateAutoScore(
  config: MissionConfig,
  answer: SubmissionAnswer,
  grade: Grade | null = null,
): number | null {
  if (config.type === 'golden_bell' && answer.type === 'golden_bell') {
    return countGoldenBellCorrect(config, answer, grade) * 100;
  }
  if (config.type === 'error_hunt' && answer.type === 'error_hunt') {
    return calculateErrorHuntScore({
      found: countErrorHuntFound(config, answer.foundRegionIds, grade),
      total: getErrorHuntRegions(config, grade).length,
      remainingSeconds: answer.remainingSeconds,
      wrongTaps: answer.wrongTaps,
    });
  }
  if (config.type === 'library_check' && answer.type === 'library_check') {
    // 정답을 등록한 뒤에만 자동 채점한다. 등록 전에는 선생님이 직접 채점한다.
    return scoreLibraryCheck(config, answer)?.total ?? null;
  }
  return null;
}

/** 교사가 결과를 확인해 판정하는 미션인지. 도서관 오류찾기는 정답을 등록하면 자동 채점이 된다. */
export function isTeacherJudged(mission: Pick<Mission, 'teacherJudged' | 'config'>): boolean {
  if (mission.config.type === 'library_check') return !hasLibraryCheckAnswerKey(mission.config);
  return mission.teacherJudged;
}

/**
 * 교사 화면에 보여 줄 제출 점수.
 * 순위가 확정된(verified) 제출은 교사가 정한 점수, 그 밖에는 자동 점수를 그때그때 계산한다.
 * 학생은 점수를 쓸 수 없으므로 저장소에는 점수를 넣지 않는다.
 */
export function resolveSubmissionScore(submission: Submission, mission: Mission): number | null {
  if (submission.status === 'verified' && submission.score !== null) return submission.score;
  return calculateAutoScore(mission.config, submission.answer, submission.grade);
}

/**
 * 터치 위치(0~1 비율)가 정답 영역(원 또는 타원) 안인지 판정한다.
 * 원의 반지름은 너비 기준 비율이므로 실제 이미지 비율(aspect = 너비/높이)로 세로 반지름을 구한다.
 * 영역이 겹친 곳을 누르면 가운데가 더 가까운 영역으로 본다.
 */
export function findHitRegion(
  regions: readonly CircleRegion[],
  point: { x: number; y: number },
  aspect: number,
): CircleRegion | null {
  let best: { region: CircleRegion; distance: number } | null = null;
  for (const region of regions) {
    const dx = point.x - region.x;
    const dy = point.y - region.y;
    const ry = getRegionRadiusY(region, aspect);
    if (region.r <= 0 || ry <= 0) continue;
    if ((dx / region.r) ** 2 + (dy / ry) ** 2 > 1) continue;
    // 가운데까지의 거리는 화면에서 보이는 길이(너비 기준)로 견준다.
    const distance = Math.hypot(dx, dy / aspect);
    if (!best || distance < best.distance) best = { region, distance };
  }
  return best?.region ?? null;
}
