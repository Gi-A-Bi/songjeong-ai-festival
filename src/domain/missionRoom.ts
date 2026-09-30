import type { Grade, Mission } from './types';

/**
 * 교실 이름에 넣는 학년 자리표시. "{학년} 1반 교실"은 4학년에게 "4학년 1반 교실"로 보인다.
 * 미션 1~4는 각 학년의 1~4반 교실에서 하므로 학년마다 교실이 다르다.
 */
export const GRADE_PLACEHOLDER = '{학년}';

/** 각 학년의 N반 교실 */
export function classroomName(classNo: number): string {
  return `${GRADE_PLACEHOLDER} ${classNo}반 교실`;
}

/** 교실 이름의 학년 자리표시를 학년으로 바꾼다. 학년을 모르면 "각 학년"으로 보여 준다. */
export function formatMissionRoom(room: string, grade: Grade | null): string {
  return room.split(GRADE_PLACEHOLDER).join(grade === null ? '각 학년' : `${grade}학년`);
}

/** 화면에 보여 줄 미션 교실 이름 */
export function missionRoom(mission: Pick<Mission, 'room'>, grade: Grade | null): string {
  return formatMissionRoom(mission.room, grade);
}

/** 총괄이 고치는 미션 이름·교실·한 줄 소개 */
export interface MissionInfoInput {
  title: string;
  room: string;
  summary: string;
}

export const MISSION_INFO_MAX_LENGTH = 40;

/** 미션 이름·교실 입력을 검사한다. 문제가 없으면 null */
export function getMissionInfoError(info: MissionInfoInput): string | null {
  if (!info.title.trim()) return '미션 이름을 적어 주세요.';
  if (!info.room.trim()) return '교실 이름을 적어 주세요.';
  if (info.title.trim().length > MISSION_INFO_MAX_LENGTH) {
    return `미션 이름은 ${MISSION_INFO_MAX_LENGTH}자 안으로 적어 주세요.`;
  }
  if (info.room.trim().length > MISSION_INFO_MAX_LENGTH) {
    return `교실 이름은 ${MISSION_INFO_MAX_LENGTH}자 안으로 적어 주세요.`;
  }
  if (info.summary.trim().length > 80) return '한 줄 소개는 80자 안으로 적어 주세요.';
  return null;
}

export function normalizeMissionInfo(info: MissionInfoInput): MissionInfoInput {
  return { title: info.title.trim(), room: info.room.trim(), summary: info.summary.trim() };
}
