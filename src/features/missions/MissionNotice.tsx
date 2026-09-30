import { Link } from 'react-router';
import { paths } from '../../app/paths';
import type { AssetKey } from '../../assets/manifest';
import { AssetImage } from '../../components/AssetImage';
import { Icon } from '../../components/Icon';
import type { IconName } from '../../components/icons';
import type { TeamMissionView } from '../../data/EventRepository';
import { toUserMessage } from '../../data/errors';
import { getWaitingReason } from '../../domain/missionPhase';
import { missionRoom } from '../../domain/missionRoom';
import { isTeacherJudged } from '../../domain/scoring';
import type { FestivalEvent, MissionPhase } from '../../domain/types';
import './Missions.css';

interface MissionNoticeProps {
  phase: MissionPhase;
  event: FestivalEvent;
  view: TeamMissionView;
  error: unknown;
}

/** 미션 상태를 마스코트·아이콘·문구로 함께 알려 준다. */
export function MissionNotice({ phase, event, view, error }: MissionNoticeProps) {
  if (error) {
    return (
      <NoticeBox tone="danger" icon="error" mascot="mascotRetry" role="alert">
        {toUserMessage(error)}
      </NoticeBox>
    );
  }
  switch (phase) {
    case 'waiting':
      return <WaitingNotice event={event} view={view} />;
    case 'submitted':
      return (
        <NoticeBox tone="success" icon="check_circle" mascot="mascotCorrect">
          제출했어요!{' '}
          {isTeacherJudged(view.mission) ? '선생님 확인을 기다려요.' : '결과 발표를 기다려요.'}
        </NoticeBox>
      );
    case 'scoring':
      return (
        <NoticeBox tone="warning" icon="pending" mascot="mascotTimer">
          선생님이 순위를 정하고 있어요. 선생님 안내에 따라 다음 교실로 이동해요.
        </NoticeBox>
      );
    case 'closed':
      return (
        <NoticeBox tone="success" icon="trophy" mascot="mascotCardEarned">
          순위가 확정됐어요.{' '}
          <Link to={paths.reward(event.id, view.team.id)}>카드 보상을 확인해요</Link>
        </NoticeBox>
      );
    case 'active':
      if (view.submission?.reopened) {
        return (
          <NoticeBox tone="info" icon="restart_alt" mascot="mascotHint">
            선생님이 다시 제출할 수 있게 해 주셨어요. 고친 뒤 다시 제출해요.
          </NoticeBox>
        );
      }
      // 미션 화면을 열기만 해서는 입장되지 않는다.
      return view.checkedIn ? null : (
        <NoticeBox tone="warning" icon="login" mascot="mascotHint">
          아직 입장하지 않았어요. {missionRoom(view.mission, view.team.grade)} 선생님이 알려 준
          인증코드를 아래에 넣어 주세요. 넣기 어려우면 선생님께 말해 주세요.
        </NoticeBox>
      );
  }
}

function WaitingNotice({ event, view }: { event: FestivalEvent; view: TeamMissionView }) {
  const reason = getWaitingReason({
    event,
    grade: view.team.grade,
    missionRound: view.roundNo,
    roundStatus: view.roundStatus,
  });
  switch (reason) {
    case 'idle':
      return (
        <NoticeBox tone="info" icon="hourglass_top" mascot="mascotTimer">
          지금은 미션 투어 시간이 아니에요. 선생님 안내를 기다려 주세요.
        </NoticeBox>
      );
    case 'upcoming':
      return (
        <NoticeBox tone="info" icon="visibility" mascot="mascotHint">
          {view.roundNo}라운드에 하는 미션이에요. 게임이 시작되면 문제가 나타나요.
        </NoticeBox>
      );
    case 'missed':
      return view.booth.skipped ? (
        <NoticeBox tone="info" icon="arrow_forward" mascot="mascotHint">
          이번에는 하지 않고 넘어간 미션이에요.
        </NoticeBox>
      ) : (
        <NoticeBox tone="warning" icon="schedule" mascot="mascotRetry">
          이 미션 시간이 끝났어요. 제출하지 못했다면 선생님께 말해 주세요.
        </NoticeBox>
      );
    case 'not-opened':
      return (
        <NoticeBox tone="info" icon="meeting_room" mascot="mascotTimer">
          {missionRoom(view.mission, view.team.grade)} 앞에서 기다려요. 선생님이 라운드를 열면
          인증코드를 넣고 들어가요. 이 화면을 열기만 해서는 입장되지 않아요.
        </NoticeBox>
      );
    case 'opened':
      return view.checkedIn ? (
        <NoticeBox tone="info" icon="hourglass_top" mascot="mascotTimer">
          입장했어요! 선생님이 게임을 시작하면 문제가 나타나요.
        </NoticeBox>
      ) : (
        <NoticeBox tone="warning" icon="login" mascot="mascotHint">
          {missionRoom(view.mission, view.team.grade)} 선생님이 알려 준 인증코드를 넣어야 입장돼요.
          이 화면을 열기만 해서는 입장되지 않아요.
        </NoticeBox>
      );
  }
}

function NoticeBox({
  tone,
  icon,
  mascot,
  role = 'status',
  children,
}: {
  tone: 'info' | 'success' | 'warning' | 'danger';
  icon: IconName;
  mascot: AssetKey;
  role?: 'status' | 'alert';
  children: React.ReactNode;
}) {
  return (
    <div className={`mission-notice mission-notice--${tone}`} role={role}>
      <AssetImage asset={mascot} decorative className="mission-notice__mascot" />
      <Icon name={icon} size="lg" />
      <p className="mission-notice__text">{children}</p>
    </div>
  );
}
