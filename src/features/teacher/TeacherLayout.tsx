import { useCallback } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { paths } from '../../app/paths';
import { AppHeader } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { isRepositoryError } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import { EventSetupPrompt } from './EventSetupPrompt';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useLiveEvent } from '../../hooks/useLiveEvent';
import { TEACHER_ROLE_LABELS, type TeacherContextValue } from './teacherContext';
import './Teacher.css';

/** 교사 로그인 확인과 행사 상태 구독을 맡고, 교사용 메뉴를 보여 준다. */
export function TeacherLayout() {
  const { eventId = '' } = useParams();
  const repository = useRepository();
  const location = useLocation();
  const navigate = useNavigate();
  const event = useLiveEvent(eventId);
  const loadTeacher = useCallback(() => repository.restoreTeacher(), [repository]);
  const teacher = useAsyncData(loadTeacher);

  if (teacher.status === 'loading') {
    return (
      <>
        <AppHeader variant="teacher" />
        <main className="page teacher-page">
          <LoadingView label="로그인 상태를 확인하고 있어요" />
        </main>
      </>
    );
  }

  if (teacher.status === 'error') {
    return (
      <>
        <AppHeader variant="teacher" backTo={paths.start()} />
        <main className="page teacher-page">
          <ErrorView error={teacher.error} onRetry={teacher.reload} />
        </main>
      </>
    );
  }

  const profile = teacher.data;
  if (!profile) {
    return (
      <Navigate
        to={`${paths.teacherLogin()}?next=${encodeURIComponent(location.pathname)}`}
        replace
      />
    );
  }

  const logout = async () => {
    await repository.signOutTeacher();
    navigate(paths.teacherLogin(), { replace: true });
  };

  const nav = (
    <>
      <NavLink to={paths.teacherDashboard(eventId)} className="teacher-nav__link">
        <Icon name="dashboard" />
        대시보드
      </NavLink>
      <NavLink to={paths.teacherCards(eventId)} className="teacher-nav__link">
        <Icon name="style" />
        학급 카드
      </NavLink>
      {repository.capabilities.classFinal ? (
        <NavLink to={paths.finalResults(eventId)} className="teacher-nav__link">
          <Icon name="trophy" />
          최종 미션
        </NavLink>
      ) : null}
      {profile.role === 'homeroom_teacher' && profile.classId ? (
        <NavLink to={paths.teacherClass(eventId, profile.classId)} className="teacher-nav__link">
          <Icon name="school" />
          우리 반
        </NavLink>
      ) : null}
      {profile.role === 'station_teacher' && profile.missionId ? (
        <NavLink
          to={paths.teacherStation(eventId, profile.missionId)}
          className="teacher-nav__link"
        >
          <Icon name="flag" />
          담당 미션
        </NavLink>
      ) : null}
      {profile.role === 'admin' ? (
        <NavLink to={paths.admin(eventId)} className="teacher-nav__link">
          <Icon name="settings" />
          행사 설정
        </NavLink>
      ) : null}
      <button type="button" className="teacher-nav__link" onClick={() => void logout()}>
        <Icon name="logout" />
        로그아웃
      </button>
    </>
  );

  return (
    <>
      <AppHeader
        variant="teacher"
        subtitle={`${profile.displayName} · ${TEACHER_ROLE_LABELS[profile.role]}`}
        nav={nav}
      />
      <main className="page teacher-page">
        {event.status === 'loading' ? <LoadingView label="행사 상태를 불러오고 있어요" /> : null}
        {event.status === 'error' ? (
          // 행사 문서가 아직 없으면 오류 대신 준비 화면을 보여 준다.
          isRepositoryError(event.error, 'not-found') ? (
            <EventSetupPrompt
              eventId={eventId}
              canSetup={profile.role === 'admin'}
              onCreated={event.retry}
            />
          ) : (
            <ErrorView error={event.error} onRetry={event.retry} />
          )
        ) : null}
        {event.status === 'success' ? (
          <Outlet
            context={{ eventId, event: event.data, teacher: profile } satisfies TeacherContextValue}
          />
        ) : null}
      </main>
    </>
  );
}
