import { MAX_GAME_DURATION_MINUTES, MIN_GAME_DURATION_MINUTES } from '../config';

/** 게임 시간(분)을 받을 수 없는 이유. 받을 수 있으면 null */
export function getGameDurationError(minutes: number): string | null {
  if (!Number.isInteger(minutes)) return '게임 시간은 분 단위 숫자로 적어 주세요.';
  if (minutes < MIN_GAME_DURATION_MINUTES || minutes > MAX_GAME_DURATION_MINUTES) {
    return `게임 시간은 ${MIN_GAME_DURATION_MINUTES}~${MAX_GAME_DURATION_MINUTES}분으로 정해 주세요.`;
  }
  return null;
}
