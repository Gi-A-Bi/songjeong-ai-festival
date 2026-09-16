import { Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { paths } from '../../app/paths';
import { AppHeader } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { useRepository } from '../../data/RepositoryContext';
import { useLiveEvent } from '../../hooks/useLiveEvent';
import type { TeacherContextValue } from './teacherContext';
import './Teacher.css';

/** 교사 로그인 확인과 행사 상태 구독을 맡고, 교사용 메뉴를 보여 준다. */
export function TeacherLayout() {
  const { eventId = '' } = useParams();
  const repository = useRepository();
  const location = useLocation();
  const navigate = useNavigate();
  const event = useLiveEvent(eventId);
  const teacher = repository.getCurrentTeacher();

  if (!teacher) {
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
      <NavLink to={paths.teacherDashboard(eventId)} end className="teacher-nav__link">
        <Icon name="dashboard" />
        대시보드
      </NavLink>
      <NavLink to={paths.exchange(eventId)} className="teacher-nav__link">
        <Icon name="swap_horiz" />
        카드 교환
      </NavLink>
      <button type="button" className="teacher-nav__link" onClick={() => void logout()}>
        <Icon name="logout" />
        로그아웃
      </button>
    </>
  );

  return (
    <>
      <AppHeader variant="teacher" subtitle={teacher.displayName} nav={nav} />
      <main className="page teacher-page">
        {event.status === 'loading' ? <LoadingView label="행사 상태를 불러오고 있어요" /> : null}
        {event.status === 'error' ? <ErrorView error={event.error} onRetry={event.retry} /> : null}
        {event.status === 'success' ? (
          <Outlet context={{ eventId, event: event.data, teacher } satisfies TeacherContextValue} />
        ) : null}
      </main>
    </>
  );
}
