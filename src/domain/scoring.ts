import type { CircleRegion, MissionConfig, SubmissionAnswer } from './types';

/** 틀린그림 찾기 기본 점수: 찾은 수×100 + 남은 초×2 − 오답×20, 최저 0점 */
export function calculateErrorHuntScore(
  found: number,
  remainingSeconds: number,
  wrongTaps: number,
) {
  const base = found * 100;
  const timeBonus = Math.max(0, Math.floor(remainingSeconds)) * 2;
  const penalty = wrongTaps * 20;
  return Math.max(0, base + timeBonus - penalty);
}

/** 자동 채점 미션만 점수를 계산한다. 교사 판정 미션은 null. */
export function calculateAutoScore(config: MissionConfig, answer: SubmissionAnswer): number | null {
  if (config.type === 'golden_bell' && answer.type === 'golden_bell') {
    return answer.choiceIndex === config.answerIndex ? 100 : 0;
  }
  if (config.type === 'error_hunt' && answer.type === 'error_hunt') {
    return calculateErrorHuntScore(
      answer.foundRegionIds.length,
      answer.remainingSeconds,
      answer.wrongTaps,
    );
  }
  return null;
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
