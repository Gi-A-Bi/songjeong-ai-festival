import type { Grade, TeamNo } from './domain/types';

/** 개발용 기본 행사 ID(명세 23장) */
export const DEFAULT_EVENT_ID = 'songjeong-ai-festival-2026';

/** 팀 입장 화면에서 처음 선택해 둘 개발용 팀: 4학년 2반 3팀 */
export const DEV_DEFAULT_TEAM: { grade: Grade; classNo: number; teamNo: TeamNo } = {
  grade: 4,
  classNo: 2,
  teamNo: 3,
};

/** 게임 시간 기본값. 부스에서 “게임 시작”을 누른 때부터 센다. 총괄 운영자가 행사 설정에서 바꿀 수 있다. */
export const DEFAULT_GAME_DURATION_MS = 10 * 60_000;
export const MIN_GAME_DURATION_MINUTES = 3;
export const MAX_GAME_DURATION_MINUTES = 30;

/** 게임 시작 뒤 이 시간이 지나도 체크인하지 않으면 미도착 경고를 띄운다. */
export const CHECK_IN_GRACE_MS = 2 * 60_000;

/** 게임 시간이 끝난 뒤 이 시간이 지나도 순위를 확정하지 않으면 결과 미입력 경고를 띄운다. */
export const RESULT_GRACE_MS = 3 * 60_000;

/** 학급 최종 미션 문제 수 */
export const FINAL_QUESTION_COUNT = 10;

/** 학급 최종 미션 기본 제한 시간(초). 총괄 운영자가 학년별로 바꿀 수 있다. */
export const FINAL_DEFAULT_DURATION_SEC = 12 * 60;

/** 최종 미션 시작 전 “3, 2, 1, 시작!” 카운트다운(초) */
export const FINAL_COUNTDOWN_SECONDS = 3;

/** 완성 카드 종류 수만큼 주는 공통 힌트의 최대 개수 */
export const FINAL_MAX_HINTS = 5;
