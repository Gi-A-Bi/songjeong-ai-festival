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

const pad = (value: number) => String(value).padStart(2, '0');

/** 시각 입력 칸(type="time", step=1)에 넣을 “14:31:05”. 값이 없으면 빈 문자열 */
export function toTimeInputValue(epochMs: number | null): string {
  if (epochMs === null) return '';
  const date = new Date(epochMs);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** “14:31:05”를 기준 시각과 같은 날짜의 epoch ms로 바꾼다. 잘못된 값이면 null */
export function fromTimeInputValue(value: string, baseEpochMs: number): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [hours, minutes, seconds = '0'] = match.slice(1);
  const date = new Date(baseEpochMs);
  date.setHours(Number(hours), Number(minutes), Number(seconds), 0);
  return date.getTime();
}
