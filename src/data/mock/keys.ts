import type { Grade, RoundNo, TeamNo } from '../../domain/types';

export function toClassId(grade: Grade, classNo: number): string {
  return `g${grade}-c${classNo}`;
}

export function toTeamId(grade: Grade, classNo: number, teamNo: TeamNo): string {
  return `${toClassId(grade, classNo)}-t${teamNo}`;
}

export function roundKey(grade: Grade, roundNo: RoundNo): string {
  return `g${grade}-r${roundNo}`;
}

/** 미션·팀별 고정 제출 ID. 같은 제출을 다시 보내도 문서가 늘지 않는다. */
export function submissionId(missionId: string, teamId: string): string {
  return `${missionId}__${teamId}`;
}

/** 한 학년·라운드·미션의 순위 확정 묶음 키 */
export function resultKey(missionId: string, grade: Grade, roundNo: RoundNo): string {
  return `${missionId}__g${grade}__r${roundNo}`;
}

export function resultId(key: string, teamId: string): string {
  return `${key}__${teamId}`;
}
