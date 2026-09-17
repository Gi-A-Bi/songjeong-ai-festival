import { Link } from 'react-router';
import { paths } from '../../app/paths';
import type { AssetKey } from '../../assets/manifest';
import { AssetImage } from '../../components/AssetImage';
import { Icon } from '../../components/Icon';
import type { IconName } from '../../components/icons';
import type { TeamMissionView } from '../../data/EventRepository';
import { toUserMessage } from '../../data/errors';
import { getWaitingReason } from '../../domain/missionPhase';
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
          {view.mission.teacherJudged ? '선생님 확인을 기다려요.' : '결과 발표를 기다려요.'}
        </NoticeBox>
      );
    case 'scoring':
      return (
        <NoticeBox tone="warning" icon="pending" mascot="mascotTimer">
          선생님이 채점하고 있어요. 다음 교실로 이동해도 좋아요.
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
      return view.submission?.reopened ? (
        <NoticeBox tone="info" icon="restart_alt" mascot="mascotHint">
          선생님이 다시 제출할 수 있게 해 주셨어요. 고친 뒤 다시 제출해요.
        </NoticeBox>
      ) : null;
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
    case 'paused':
      return (
        <NoticeBox tone="info" icon="pause" mascot="mascotTimer">
          잠시 멈췄어요. 선생님 안내를 기다려 주세요.
        </NoticeBox>
      );
    case 'upcoming':
      return (
        <NoticeBox tone="info" icon="visibility" mascot="mascotHint">
          {view.roundNo}라운드에 하는 미션이에요. 지금은 살펴보기만 할 수 있어요.
        </NoticeBox>
      );
    case 'missed':
      return (
        <NoticeBox tone="warning" icon="schedule" mascot="mascotRetry">
          이 미션 시간이 끝났어요. 제출하지 못했다면 선생님께 말해 주세요.
        </NoticeBox>
      );
    case 'not-started':
      return (
        <NoticeBox tone="info" icon="hourglass_top" mascot="mascotTimer">
          선생님이 라운드를 시작하면 제출할 수 있어요.
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
