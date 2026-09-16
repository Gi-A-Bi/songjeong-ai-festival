const e = encodeURIComponent;

/** 화면 경로는 이 한 곳에서 만든다(명세 9장). */
export const paths = {
  start: () => '/',
  join: (eventId: string) => `/join/${e(eventId)}`,
  joinTeam: (eventId: string, teamId: string) => `/join/${e(eventId)}/${e(teamId)}`,
  teamHome: (eventId: string, teamId: string) => `/team/${e(eventId)}/${e(teamId)}`,
  mission: (eventId: string, teamId: string, missionId: string) =>
    `/team/${e(eventId)}/${e(teamId)}/mission/${e(missionId)}`,
  draw: (eventId: string, teamId: string) => `/team/${e(eventId)}/${e(teamId)}/draw`,
  cards: (eventId: string, teamId: string) => `/team/${e(eventId)}/${e(teamId)}/cards`,
  finale: (eventId: string, teamId: string) => `/team/${e(eventId)}/${e(teamId)}/finale`,
  teacherLogin: () => '/teacher/login',
  teacherDashboard: (eventId: string) => `/teacher/${e(eventId)}`,
  teacherMission: (eventId: string, missionId: string) =>
    `/teacher/${e(eventId)}/mission/${e(missionId)}`,
  exchange: (eventId: string) => `/teacher/${e(eventId)}/exchange`,
  admin: (eventId: string) => `/teacher/${e(eventId)}/admin`,
};
