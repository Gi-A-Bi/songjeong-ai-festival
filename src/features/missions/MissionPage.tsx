import { useCallback, useState } from 'react';
import { useParams } from 'react-router';
import { paths } from '../../app/paths';
import { AppHeader } from '../../components/AppHeader';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { useRepository } from '../../data/RepositoryContext';
import { getMissionPhase } from '../../domain/missionPhase';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useMissionLiveState } from '../../hooks/useMissionLiveState';
import { useTeamContext } from '../tour/teamContext';
import { DrawingMission } from './drawing/DrawingMission';
import { ErrorHuntMission } from './errorHunt/ErrorHuntMission';
import { GoldenBellMission } from './goldenBell/GoldenBellMission';
import { LibraryCheckMission } from './libraryCheck/LibraryCheckMission';
import type { MissionScreenProps } from './missionTypes';
import { OzobotMission } from './ozobot/OzobotMission';

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

  // 라운드 시작·종료나 교사의 정답 공개·순위 확정·재제출 허용이 생기면 조용히 다시 읽는다.
  // 다시 읽는 동안에도 화면을 유지하므로 그리던 그림이나 입력한 답은 사라지지 않는다.
  const refreshKey = `${event.status}|${event.activeGrade}|${event.activeRound}|${liveRevision}`;
  const [seenRefreshKey, setSeenRefreshKey] = useState(refreshKey);
  if (seenRefreshKey !== refreshKey) {
    setSeenRefreshKey(refreshKey);
    if (loaded) view.reload();
  }

  return (
    <>
      <AppHeader backTo={paths.teamHome(eventId, team.id)} subtitle={team.displayName} />
      <main className="page">
        {view.status === 'loading' ? <LoadingView label="미션을 준비하고 있어요" /> : null}
        {view.status === 'error' ? <ErrorView error={view.error} onRetry={view.reload} /> : null}
        {view.status === 'success' ? (
          <MissionScreen
            // 제출 상태가 바뀌면(제출 완료, 재제출 허용) 화면 입력값을 새 상태에서 다시 시작한다.
            key={`${view.data.submission?.status ?? 'none'}-${view.data.submission?.updatedAt ?? 0}`}
            eventId={eventId}
            view={view.data}
            event={event}
            onSubmitted={view.reload}
            phase={getMissionPhase({
              event,
              grade: team.grade,
              missionRound: view.data.roundNo,
              roundStatus: view.data.roundStatus,
              submission: view.data.submission,
              finalized: view.data.finalized,
            })}
          />
        ) : null}
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
