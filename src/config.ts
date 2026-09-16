import type { Grade, TeamNo } from './domain/types';

/** 개발용 기본 행사 ID(명세 23장) */
export const DEFAULT_EVENT_ID = 'songjeong-ai-festival-2026';

/** 팀 입장 화면에서 처음 선택해 둘 개발용 팀: 4학년 2반 3팀 */
export const DEV_DEFAULT_TEAM: { grade: Grade; classNo: number; teamNo: TeamNo } = {
  grade: 4,
  classNo: 2,
  teamNo: 3,
};
