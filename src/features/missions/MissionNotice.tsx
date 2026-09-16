import { Link } from 'react-router';
import type { AssetKey } from '../../assets/manifest';
import { AssetImage } from '../../components/AssetImage';
import { Icon } from '../../components/Icon';
import type { IconName } from '../../components/icons';
import { toUserMessage } from '../../data/errors';
import type { FestivalEvent, MissionPhase } from '../../domain/types';
import './Missions.css';

interface MissionNoticeProps {
  phase: MissionPhase;
  event: FestivalEvent;
  error: unknown;
  teacherJudged: boolean;
  cardsPath: string;
}

/** 미션 상태를 마스코트·아이콘·문구로 함께 알려 준다. */
export function MissionNotice({
  phase,
  event,
  error,
  teacherJudged,
  cardsPath,
}: MissionNoticeProps) {
  if (error) {
    return (
      <NoticeBox tone="danger" icon="error" mascot="mascotRetry" role="alert">
        {toUserMessage(error)}
      </NoticeBox>
    );
  }
  switch (phase) {
    case 'waiting':
      return (
        <NoticeBox tone="info" icon="hourglass_top" mascot="mascotTimer">
          {event.status === 'paused'
            ? '잠시 멈췄어요. 선생님 안내를 기다려 주세요.'
            : '선생님이 라운드를 시작하면 제출할 수 있어요.'}
        </NoticeBox>
      );
    case 'submitted':
      return (
        <NoticeBox tone="success" icon="check_circle" mascot="mascotCorrect">
          제출했어요! {teacherJudged ? '선생님 확인을 기다려요.' : '결과 발표를 기다려요.'}
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
          순위가 확정됐어요. <Link to={cardsPath}>카드함에서 뽑기권을 확인해요</Link>
        </NoticeBox>
      );
    case 'active':
      return null;
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
