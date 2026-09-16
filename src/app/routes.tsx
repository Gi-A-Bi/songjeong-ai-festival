import type { RouteObject } from 'react-router';
import { CardBoxPage } from '../features/cards/CardBoxPage';
import { DrawPage } from '../features/cards/DrawPage';
import { FinalePage } from '../features/cards/FinalePage';
import { ExchangePage } from '../features/exchange/ExchangePage';
import { JoinPage } from '../features/join/JoinPage';
import { MissionPage } from '../features/missions/MissionPage';
import { StartPage } from '../features/start/StartPage';
import { TeacherDashboardPage } from '../features/teacher/TeacherDashboardPage';
import { TeacherLayout } from '../features/teacher/TeacherLayout';
import { TeacherLoginPage } from '../features/teacher/TeacherLoginPage';
import { TeacherMissionPage } from '../features/teacher/TeacherMissionPage';
import { TeamHomePage } from '../features/tour/TeamHomePage';
import { TeamLayout } from '../features/tour/TeamLayout';
import { NotFoundPage, RouteErrorPage } from './SystemPages';

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <StartPage /> },
      { path: 'join/:eventId', element: <JoinPage /> },
      { path: 'join/:eventId/:teamId', element: <JoinPage /> },
      {
        path: 'team/:eventId/:teamId',
        element: <TeamLayout />,
        children: [
          { index: true, element: <TeamHomePage /> },
          { path: 'mission/:missionId', element: <MissionPage /> },
          { path: 'draw', element: <DrawPage /> },
          { path: 'cards', element: <CardBoxPage /> },
          { path: 'finale', element: <FinalePage /> },
        ],
      },
      { path: 'teacher/login', element: <TeacherLoginPage /> },
      {
        path: 'teacher/:eventId',
        element: <TeacherLayout />,
        children: [
          { index: true, element: <TeacherDashboardPage /> },
          { path: 'mission/:missionId', element: <TeacherMissionPage /> },
          { path: 'exchange', element: <ExchangePage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
