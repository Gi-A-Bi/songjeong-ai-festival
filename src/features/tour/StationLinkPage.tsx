import { useCallback } from 'react';
import { Navigate, useParams } from 'react-router';
import { paths } from '../../app/paths';
import { AppHeader } from '../../components/AppHeader';
import { AssetImage } from '../../components/AssetImage';
import { ButtonLink } from '../../components/Button';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { useRepository } from '../../data/RepositoryContext';
import { useAsyncData } from '../../hooks/useAsyncData';
import './TeamHomePage.css';

/**
 * 예전에 교실 입구에 붙였던 QR 주소(/check-in/:eventId/:stationId).
 * 입장은 이제 미션 화면에서 인증코드로 하므로, 이 기기가 입장한 팀의 그 미션 화면으로 보낸다.
 */
export function StationLinkPage() {
  const { eventId = '', stationId = '' } = useParams();
  const repository = useRepository();
  const loadTeam = useCallback(() => repository.getMyTeam(eventId), [repository, eventId]);
  const team = useAsyncData(loadTeam);

  if (team.status === 'success' && team.data) {
    return <Navigate to={paths.mission(eventId, team.data.id, stationId)} replace />;
  }
  return (
    <>
      <AppHeader backTo={paths.start()} />
      <main className="page">
        {team.status === 'loading' ? <LoadingView label="팀을 확인하고 있어요" /> : null}
        {team.status === 'error' ? <ErrorView error={team.error} onRetry={team.reload} /> : null}
        {team.status === 'success' ? (
          <section className="station-link" aria-labelledby="station-link-title">
            <AssetImage asset="mascotHint" decorative className="station-link__mascot" />
            <h1 id="station-link-title" className="station-link__title">
              먼저 팀으로 입장해 주세요
            </h1>
            <p className="station-link__lead">
              이 기기는 아직 팀에 입장하지 않았어요. 팀 QR로 입장한 뒤 미션 화면에서 교실 인증코드를
              넣어요.
            </p>
            <ButtonLink to={paths.join(eventId)} size="xl" icon="login">
              팀 입장하기
            </ButtonLink>
          </section>
        ) : null}
      </main>
    </>
  );
}
