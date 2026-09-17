import type { RouteObject } from 'react-router';
import { CardBoardPage } from '../features/cards/CardBoardPage';
import { RewardPage } from '../features/cards/RewardPage';
import { ClassFinalMissionPage } from '../features/final/ClassFinalMissionPage';
import { FinalResultsPage } from '../features/final/FinalResultsPage';
import { JoinPage } from '../features/join/JoinPage';
import { MissionPage } from '../features/missions/MissionPage';
import { StartPage } from '../features/start/StartPage';
import { AdminPage } from '../features/teacher/AdminPage';
import { TeacherCardsPage } from '../features/teacher/TeacherCardsPage';
import { TeacherClassPage } from '../features/teacher/TeacherClassPage';
import { TeacherDashboardPage } from '../features/teacher/TeacherDashboardPage';
import { TeacherLayout } from '../features/teacher/TeacherLayout';
import { TeacherLoginPage } from '../features/teacher/TeacherLoginPage';
import { TeacherMissionPage } from '../features/teacher/TeacherMissionPage';
import { QrPrintPage } from '../features/teacher/qr/QrPrintPage';
import { CheckInPage, StationQrPage } from '../features/tour/CheckInPage';
import { TeamHomePage } from '../features/tour/TeamHomePage';
import { TeamLayout } from '../features/tour/TeamLayout';
import {
  AdminRedirect,
  ClassFinalRedirect,
  NotFoundPage,
  RouteErrorPage,
  StationRedirect,
  TeacherCardsRedirect,
  TeacherPathRedirect,
  TeamCardsRedirect,
} from './SystemPages';

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <StartPage /> },
      { path: 'join/:eventId', element: <JoinPage /> },
      { path: 'join/:eventId/:teamId', element: <JoinPage /> },
      // 미션 교실에 붙이는 QR 주소. 기기에 입장한 팀의 체크인 화면으로 보낸다.
      { path: 'check-in/:eventId/:stationId', element: <StationQrPage /> },
      {
        path: 'team/:eventId/:teamId',
        element: <TeamLayout />,
        children: [
          { index: true, element: <TeamHomePage /> },
          { path: 'mission/:missionId', element: <MissionPage /> },
          { path: 'check-in/:stationId', element: <CheckInPage /> },
          { path: 'reward', element: <RewardPage /> },
          { path: 'cards', element: <CardBoardPage /> },
          // 예전 카드 뽑기·피날레·팀별 결승 북마크는 학급 카드 현황으로 보낸다.
          { path: 'draw', element: <TeamCardsRedirect /> },
          { path: 'finale', element: <TeamCardsRedirect /> },
          { path: 'final', element: <TeamCardsRedirect /> },
        ],
      },
      { path: 'class/:eventId/:classId/final', element: <ClassFinalRedirect /> },
      { path: 'teacher/login', element: <TeacherLoginPage /> },
      {
        path: 'teacher/:eventId',
        element: <TeacherLayout />,
        children: [
          { index: true, element: <TeacherPathRedirect to="teacherDashboard" /> },
          { path: 'dashboard', element: <TeacherDashboardPage /> },
          { path: 'station/:stationId', element: <TeacherMissionPage /> },
          { path: 'cards', element: <TeacherCardsPage /> },
          { path: 'class/:classId', element: <TeacherClassPage /> },
          { path: 'class/:classId/final', element: <ClassFinalMissionPage /> },
          { path: 'final-results', element: <FinalResultsPage /> },
          { path: 'qr', element: <QrPrintPage /> },
          { path: 'admin', element: <AdminPage /> },
          // 예전 북마크
          { path: 'mission/:missionId', element: <StationRedirect /> },
          { path: 'final', element: <TeacherPathRedirect to="finalResults" /> },
          { path: 'exchange', element: <TeacherCardsRedirect /> },
        ],
      },
      { path: 'admin/:eventId', element: <AdminRedirect /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
