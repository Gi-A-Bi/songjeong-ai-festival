import { useCallback } from 'react';
import { Outlet, useParams } from 'react-router';
import { paths } from '../../app/paths';
import { AppHeader } from '../../components/AppHeader';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { useRepository } from '../../data/RepositoryContext';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useLiveEvent } from '../../hooks/useLiveEvent';
import type { TeamContextValue } from './teamContext';

/** 팀 정보와 행사 상태를 한 번 불러와 학생 화면들에 넘겨 준다. */
export function TeamLayout() {
  const { eventId = '', teamId = '' } = useParams();
  const repository = useRepository();
  const loadTeam = useCallback(
    () => repository.getTeam(eventId, teamId),
    [repository, eventId, teamId],
  );
  const team = useAsyncData(loadTeam);
  const event = useLiveEvent(eventId);

  if (team.status === 'error' || event.status === 'error') {
    const error = team.status === 'error' ? team.error : event.error;
    return (
      <>
        <AppHeader backTo={paths.start()} />
        <main className="page">
          <ErrorView
            error={error}
            onRetry={() => {
              team.reload();
              event.retry();
            }}
          />
        </main>
      </>
    );
  }

  if (team.status === 'loading' || event.status === 'loading') {
    return (
      <>
        <AppHeader />
        <main className="page">
          <LoadingView label="팀 화면을 준비하고 있어요" />
        </main>
      </>
    );
  }

  const context: TeamContextValue = { eventId, team: team.data, event: event.data };
  return <Outlet context={context} />;
}
