import { useCallback, useState } from 'react';
import { useParams } from 'react-router';
import { paths } from '../../app/paths';
import { AppHeader } from '../../components/AppHeader';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { useRepository } from '../../data/RepositoryContext';
import { getMissionPhase } from '../../domain/missionPhase';
import { getCheckInRound } from '../../domain/tour';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useMissionLiveState } from '../../hooks/useMissionLiveState';
import { useTeamContext } from '../tour/teamContext';
import { DrawingMission } from './drawing/DrawingMission';
import { ErrorHuntMission } from './errorHunt/ErrorHuntMission';
import { ArrivalSplash, GameStartSplash } from './GameStartSplash';
import { GoldenBellMission } from './goldenBell/GoldenBellMission';
import { LibraryCheckMission } from './libraryCheck/LibraryCheckMission';
import type { MissionScreenProps } from './missionTypes';
import { OzobotMission } from './ozobot/OzobotMission';
import { StationCodeEntry } from './StationCodeEntry';

export function MissionPage() {
  const { eventId, team, event } = useTeamContext();
  const { missionId = '' } = useParams();
  const repository = useRepository();
  const load = useCallback(
    () => repository.getTeamMissionView(eventId, team.id, missionId),
    [repository, eventId, team.id, missionId],
  );
  const view = useAsyncData(load);
  const loaded = view.status === 'success' ? view.data : null;
  const liveRevision = useMissionLiveState(
    eventId,
    loaded ? { missionId: loaded.mission.id, grade: team.grade, roundNo: loaded.roundNo } : null,
  );
  /** 방금 인증코드로 입장한 시각. “입장 완료!” 연출에 쓴다. */
  const [arrivedAt, setArrivedAt] = useState<number | null>(null);
  const clearArrival = useCallback(() => setArrivedAt(null), []);

  // 부스 단계가 바뀌거나(라운드 열기·게임 시작·시간 종료·라운드 종료) 교사의 정답 공개·순위 확정·
  // 재제출 허용이 생기면 조용히 다시 읽는다.
  // 다시 읽는 동안에도 화면을 유지하므로 그리던 그림이나 입력한 답은 사라지지 않는다.
  const refreshKey = `${event.status}|${event.activeGrade}|${event.activeRound}|${event.boothStatus}|${liveRevision}`;
  const [seenRefreshKey, setSeenRefreshKey] = useState(refreshKey);
  if (seenRefreshKey !== refreshKey) {
    setSeenRefreshKey(refreshKey);
    if (loaded) view.reload();
  }

  const phase = loaded
    ? getMissionPhase({
        event,
        grade: team.grade,
        missionRound: loaded.roundNo,
        roundStatus: loaded.roundStatus,
        submission: loaded.submission,
        finalized: loaded.finalized,
      })
    : null;

  // 이번 라운드에 가야 할 교실이고 선생님이 라운드를 열었는데 아직 입장하지 않았으면
  // 인증코드 입력을 보여 준다. 게임 시간이 끝난 뒤에는 보여 주지 않는다.
  const needsCode =
    loaded !== null &&
    !loaded.checkedIn &&
    !loaded.finalized &&
    arrivedAt === null &&
    getCheckInRound(event, team.grade) === loaded.roundNo &&
    (event.boothStatus === 'open' || event.boothStatus === 'active');
  const gate =
    loaded && needsCode ? (
      <StationCodeEntry
        eventId={eventId}
        team={team}
        mission={loaded.mission}
        roundNo={loaded.roundNo}
        onCheckedIn={() => {
          setArrivedAt(Date.now());
          view.reload();
        }}
        onRefresh={view.reload}
      />
    ) : null;

  return (
    <>
      <AppHeader backTo={paths.teamHome(eventId, team.id)} subtitle={team.displayName} />
      <main className="page page--mission">
        {view.status === 'loading' ? <LoadingView label="미션을 준비하고 있어요" /> : null}
        {view.status === 'error' ? <ErrorView error={view.error} onRetry={view.reload} /> : null}
        {view.status === 'success' && phase !== null ? (
          <MissionScreen
            // 제출 상태가 바뀌면(제출 완료, 재제출 허용) 화면 입력값을 새 상태에서 다시 시작한다.
            key={`${view.data.submission?.status ?? 'none'}-${view.data.submission?.updatedAt ?? 0}`}
            eventId={eventId}
            view={view.data}
            event={event}
            gate={gate}
            onSubmitted={view.reload}
            phase={phase}
          />
        ) : null}
        <GameStartSplash phase={phase} />
        <ArrivalSplash at={arrivedAt} onDone={clearArrival} />
      </main>
    </>
  );
}

function MissionScreen(props: MissionScreenProps) {
  const config = props.view.mission.config;
  switch (config.type) {
    case 'golden_bell':
      return <GoldenBellMission {...props} config={config} />;
    case 'error_hunt':
      return <ErrorHuntMission {...props} config={config} />;
    case 'drawing':
      return <DrawingMission {...props} config={config} />;
    case 'ozobot':
      return <OzobotMission {...props} config={config} />;
    case 'library_check':
      return <LibraryCheckMission {...props} config={config} />;
  }
}
