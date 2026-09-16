import { useCallback } from 'react';
import { useParams } from 'react-router';
import { paths } from '../../app/paths';
import { AppHeader } from '../../components/AppHeader';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { useRepository } from '../../data/RepositoryContext';
import { getMissionPhase } from '../../domain/missionPhase';
import { useAsyncData } from '../../hooks/useAsyncData';
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

  return (
    <>
      <AppHeader backTo={paths.teamHome(eventId, team.id)} subtitle={team.displayName} />
      <main className="page">
        {view.status === 'loading' ? <LoadingView label="미션을 준비하고 있어요" /> : null}
        {view.status === 'error' ? <ErrorView error={view.error} onRetry={view.reload} /> : null}
        {view.status === 'success' ? (
          <MissionScreen
            eventId={eventId}
            view={view.data}
            event={event}
            onSubmitted={view.reload}
            phase={getMissionPhase({
              event,
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
