import type {
  ActivityEvent,
  ClassCardProgress,
  ClassInfo,
  Grade,
  Mission,
  Team,
  TeacherProfile,
} from '../../domain/types';
import type { MockState } from './seed';

/**
 * mock 저장소의 기능별 모듈(팀 이동, 최종 미션)이 함께 쓰는 통로.
 * 샘플 초기화 때 상태 객체가 통째로 바뀌므로 상태는 항상 함수로 읽는다.
 */
export interface MockStoreContext {
  state(): MockState;
  now(): number;
  teacher(): TeacherProfile | null;
  requireTeacher(): TeacherProfile;
  requireAdmin(): TeacherProfile;
  findTeam(teamId: string): Team;
  findClass(classId: string): ClassInfo;
  findMission(missionId: string): Mission;
  classesOf(grade: Grade): ClassInfo[];
  teamsOfClass(classId: string): Team[];
  classProgress(classId: string): ClassCardProgress;
  /** 이 학년의 모든 부스가 5라운드를 끝냈는지 */
  allRoundsCompleted(grade: Grade): boolean;
  /** 같은 원인은 같은 ID라 한 번만 기록된다. */
  addActivity(event: Omit<ActivityEvent, 'at'> & { at?: number }): void;
  notifyOps(grade: Grade): void;
  notifyFinal(grade: Grade): void;
}
