import { useCallback } from 'react';
import { Navigate, useParams } from 'react-router';
import { paths } from '../../app/paths';
import { missionImageKeys } from '../../assets/manifest';
import { AppHeader } from '../../components/AppHeader';
import { AssetImage } from '../../components/AssetImage';
import { ButtonLink } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { ErrorView, LoadingView } from '../../components/StateViews';
import type { CheckInOutcome } from '../../data/EventRepository';
import { useRepository } from '../../data/RepositoryContext';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useTeamContext } from './teamContext';
import './CheckInPage.css';

const JUST_CHECKED_IN_MS = 10_000;

/**
 * 미션 교실 QR 체크인 결과. 같은 QR을 다시 찍어도 기록은 하나라서
 * 화면을 새로고침해도 안전하다.
 */
export function CheckInPage() {
  const { eventId, team } = useTeamContext();
  const { stationId = '' } = useParams();
  const repository = useRepository();
  const checkIn = useCallback(
    () => repository.checkInStation({ eventId, teamId: team.id, stationId }),
    [repository, eventId, team.id, stationId],
  );
  const outcome = useAsyncData(checkIn);

  return (
    <>
      <AppHeader backTo={paths.teamHome(eventId, team.id)} subtitle={team.displayName} />
      <main className="page">
        {outcome.status === 'loading' ? <LoadingView label="도착을 기록하고 있어요" /> : null}
        {outcome.status === 'error' ? (
          <ErrorView
            error={outcome.error}
            title="도착을 기록하지 못했어요"
            onRetry={outcome.reload}
          />
        ) : null}
        {outcome.status === 'success' ? (
          <CheckInResult eventId={eventId} teamId={team.id} outcome={outcome.data} />
        ) : null}
      </main>
    </>
  );
}

function CheckInResult({
  eventId,
  teamId,
  outcome,
}: {
  eventId: string;
  teamId: string;
  outcome: CheckInOutcome;
}) {
  const repository = useRepository();
  const { kind, expectedMission, scannedMission, roundNo } = outcome;

  if (kind === 'wrong_station') {
    return (
      <section className="check-in check-in--wrong" aria-labelledby="check-in-title" role="alert">
        <AssetImage asset="mascotRetry" decorative className="check-in__mascot" />
        <p className="check-in__kicker">
          <Icon name="warning" /> {roundNo}라운드 · 여기는 {scannedMission.room}이에요
        </p>
        <h1 id="check-in-title" className="check-in__title">
          다른 교실로 가야 해요
        </h1>
        <p className="check-in__room">
          <Icon name="meeting_room" size="lg" />
          <strong>{expectedMission.room}</strong>
          <span>({expectedMission.title})</span>
        </p>
        <p className="muted">교실에 도착하면 그 교실의 QR을 다시 찍어 주세요.</p>
        <ButtonLink to={paths.teamHome(eventId, teamId)} size="xl" icon="home">
          팀 홈으로
        </ButtonLink>
      </section>
    );
  }

  // 방금 입장한 기록을 곧바로 다시 읽은 경우(새로고침·개발 모드의 이중 실행)는 입장 완료로 보여 준다.
  const justNow =
    outcome.state.checkedInAt !== null &&
    repository.serverNow() - outcome.state.checkedInAt < JUST_CHECKED_IN_MS;
  const already = kind === 'already_checked_in' && !justNow;
  return (
    <section className="check-in" aria-labelledby="check-in-title" role="status">
      <AssetImage
        asset={missionImageKeys[expectedMission.type]}
        decorative
        className="check-in__image"
        loading="eager"
      />
      <p className="check-in__kicker">
        <Icon name="check_circle" /> {roundNo}라운드 · {expectedMission.room}
      </p>
      <h1 id="check-in-title" className="check-in__title">
        {already ? '이미 입장했어요' : '입장 완료!'}
      </h1>
      <p className="check-in__lead">
        {already
          ? `${expectedMission.title} 교실에 도착한 기록이 있어요. 그대로 미션을 하면 돼요.`
          : `${expectedMission.title} 교실에 도착했어요. 선생님 안내에 따라 미션을 시작해요.`}
      </p>
      <ButtonLink
        to={paths.mission(eventId, teamId, expectedMission.id)}
        size="xl"
        icon="play_arrow"
      >
        미션 화면으로
      </ButtonLink>
    </section>
  );
}

/**
 * 미션 교실에 붙인 QR 주소(/check-in/:eventId/:stationId).
 * 주소에 팀이 없으므로 이 기기가 입장한 팀으로 체크인 화면에 보낸다.
 */
export function StationQrPage() {
  const { eventId = '', stationId = '' } = useParams();
  const repository = useRepository();
  const loadTeam = useCallback(() => repository.getMyTeam(eventId), [repository, eventId]);
  const team = useAsyncData(loadTeam);

  if (team.status === 'success' && team.data) {
    return <Navigate to={paths.checkIn(eventId, team.data.id, stationId)} replace />;
  }
  return (
    <>
      <AppHeader backTo={paths.start()} />
      <main className="page">
        {team.status === 'loading' ? <LoadingView label="팀을 확인하고 있어요" /> : null}
        {team.status === 'error' ? <ErrorView error={team.error} onRetry={team.reload} /> : null}
        {team.status === 'success' ? (
          <section className="check-in check-in--wrong" aria-labelledby="station-qr-title">
            <AssetImage asset="mascotHint" decorative className="check-in__mascot" />
            <h1 id="station-qr-title" className="check-in__title">
              먼저 팀으로 입장해 주세요
            </h1>
            <p className="check-in__lead">
              이 기기는 아직 팀에 입장하지 않았어요. 팀 QR로 입장한 뒤 교실 QR을 다시 찍어 주세요.
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
