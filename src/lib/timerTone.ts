export type TimerTone = 'normal' | 'warning' | 'urgent' | 'over' | 'idle';

/** 마지막 1분은 주의, 마지막 10초는 긴급으로 보여 준다. */
export function getTimerTone(seconds: number | null): TimerTone {
  if (seconds === null) return 'idle';
  if (seconds === 0) return 'over';
  if (seconds <= 10) return 'urgent';
  if (seconds <= 60) return 'warning';
  return 'normal';
}

/** 남은 시간의 비율(0~1). 전체 시간을 모르면 가득 찬 것으로 본다. */
export function getTimerRatio(seconds: number | null, totalSeconds: number | null): number {
  if (seconds === null) return 0;
  if (totalSeconds === null || totalSeconds <= 0) return seconds > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, seconds / totalSeconds));
}
