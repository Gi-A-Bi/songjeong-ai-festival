/** 초를 mm:ss 로 표시한다. */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** 화면 낭독기용 “3분 5초” 표현 */
export function formatSpokenDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  if (minutes === 0) return `${seconds}초`;
  return seconds === 0 ? `${minutes}분` : `${minutes}분 ${seconds}초`;
}

const timeFormatter = new Intl.DateTimeFormat('ko-KR', {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});

/** 제출 시각 같은 시각 표시: “오후 2:31:05” */
export function formatTimeOfDay(epochMs: number | null): string {
  return epochMs === null ? '-' : timeFormatter.format(epochMs);
}
