import type {
  CircleRegion,
  ErrorHuntConfig,
  GoldenBellAnswer,
  GoldenBellConfig,
  Mission,
  MissionConfig,
  Submission,
  SubmissionAnswer,
} from './types';

/** 골든벨: 맞힌 문제 수. 지금 등록된 문제 기준으로 센다. */
export function countGoldenBellCorrect(config: GoldenBellConfig, answer: GoldenBellAnswer): number {
  return config.questions.filter(
    (question) => answer.selections[question.id] === question.answerIndex,
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

/** 설정에 있는 정답 영역만, 한 번씩만 센다. */
export function countErrorHuntFound(config: ErrorHuntConfig, foundRegionIds: readonly string[]) {
  const valid = new Set(config.regions.map((region) => region.id));
  return new Set(foundRegionIds.filter((id) => valid.has(id))).size;
}

/** 자동 채점 미션만 점수를 계산한다. 교사 판정 미션은 null. */
export function calculateAutoScore(config: MissionConfig, answer: SubmissionAnswer): number | null {
  if (config.type === 'golden_bell' && answer.type === 'golden_bell') {
    return countGoldenBellCorrect(config, answer) * 100;
  }
  if (config.type === 'error_hunt' && answer.type === 'error_hunt') {
    return calculateErrorHuntScore({
      found: countErrorHuntFound(config, answer.foundRegionIds),
      total: config.regions.length,
      remainingSeconds: answer.remainingSeconds,
      wrongTaps: answer.wrongTaps,
    });
  }
  return null;
}

/**
 * 교사 화면에 보여 줄 제출 점수.
 * 순위가 확정된(verified) 제출은 교사가 정한 점수, 그 밖에는 자동 점수를 그때그때 계산한다.
 * 학생은 점수를 쓸 수 없으므로 저장소에는 점수를 넣지 않는다.
 */
export function resolveSubmissionScore(submission: Submission, mission: Mission): number | null {
  if (submission.status === 'verified' && submission.score !== null) return submission.score;
  return calculateAutoScore(mission.config, submission.answer);
}

/**
 * 터치 위치(0~1 비율)가 원형 정답 영역 안인지 판정한다.
 * 반지름은 너비 기준 비율이므로 실제 이미지 비율(aspect = 너비/높이)로 세로 거리를 보정한다.
 */
export function findHitRegion(
  regions: readonly CircleRegion[],
  point: { x: number; y: number },
  aspect: number,
): CircleRegion | null {
  let best: { region: CircleRegion; distance: number } | null = null;
  for (const region of regions) {
    const dx = point.x - region.x;
    const dy = (point.y - region.y) / aspect;
    const distance = Math.hypot(dx, dy);
    if (distance <= region.r && (!best || distance < best.distance)) {
      best = { region, distance };
    }
  }
  return best?.region ?? null;
}
