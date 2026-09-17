const e = encodeURIComponent;

/** 화면 경로는 이 한 곳에서 만든다(명세 9장). */
export const paths = {
  start: () => '/',
  join: (eventId: string) => `/join/${e(eventId)}`,
  joinTeam: (eventId: string, teamId: string) => `/join/${e(eventId)}/${e(teamId)}`,
  teamHome: (eventId: string, teamId: string) => `/team/${e(eventId)}/${e(teamId)}`,
  mission: (eventId: string, teamId: string, missionId: string) =>
    `/team/${e(eventId)}/${e(teamId)}/mission/${e(missionId)}`,
  reward: (eventId: string, teamId: string) => `/team/${e(eventId)}/${e(teamId)}/reward`,
  cards: (eventId: string, teamId: string) => `/team/${e(eventId)}/${e(teamId)}/cards`,
  checkIn: (eventId: string, teamId: string, stationId: string) =>
    `/team/${e(eventId)}/${e(teamId)}/check-in/${e(stationId)}`,
  /** 미션 교실에 붙이는 QR 주소. 팀은 기기에 입장한 팀으로 정한다. */
  stationQr: (eventId: string, stationId: string) => `/check-in/${e(eventId)}/${e(stationId)}`,
  teacherLogin: () => '/teacher/login',
  teacherDashboard: (eventId: string) => `/teacher/${e(eventId)}/dashboard`,
  teacherStation: (eventId: string, stationId: string) =>
    `/teacher/${e(eventId)}/station/${e(stationId)}`,
  teacherCards: (eventId: string) => `/teacher/${e(eventId)}/cards`,
  teacherClass: (eventId: string, classId: string) =>
    `/teacher/${e(eventId)}/class/${e(classId)}`,
  teacherClassFinal: (eventId: string, classId: string) =>
    `/teacher/${e(eventId)}/class/${e(classId)}/final`,
  finalResults: (eventId: string) => `/teacher/${e(eventId)}/final-results`,
  admin: (eventId: string) => `/teacher/${e(eventId)}/admin`,
};
