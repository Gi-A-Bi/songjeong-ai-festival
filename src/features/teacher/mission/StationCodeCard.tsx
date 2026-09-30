import { useCallback } from 'react';
import { Link } from 'react-router';
import { paths } from '../../../app/paths';
import { Icon } from '../../../components/Icon';
import { InlineAlert } from '../../../components/StateViews';
import { toUserMessage } from '../../../data/errors';
import { useRepository } from '../../../data/RepositoryContext';
import { missionRoom } from '../../../domain/missionRoom';
import type { Grade, Mission } from '../../../domain/types';
import { useAsyncData } from '../../../hooks/useAsyncData';

interface StationCodeCardProps {
  eventId: string;
  mission: Mission;
  grade: Grade | null;
  isAdmin: boolean;
}

/**
 * 부스 화면의 교실 인증코드. 라운드를 열면 이 코드를 들어온 팀에게 알려 준다.
 * 코드는 교사만 읽을 수 있고, 총괄 운영자가 행사 설정에서 정한다.
 */
export function StationCodeCard({ eventId, mission, grade, isAdmin }: StationCodeCardProps) {
  const repository = useRepository();
  const room = missionRoom(mission, grade);
  const load = useCallback(() => repository.listStationCodes(eventId), [repository, eventId]);
  const codes = useAsyncData(load);
  const code =
    codes.status === 'success'
      ? (codes.data.find((item) => item.missionId === mission.id)?.code ?? null)
      : undefined;

  if (codes.status === 'error') {
    return <InlineAlert tone="danger">{toUserMessage(codes.error)}</InlineAlert>;
  }
  if (code === null) {
    return (
      <InlineAlert
        tone="warning"
        action={
          isAdmin ? (
            <Link to={paths.admin(eventId)} className="teacher-shortcuts__link">
              행사 설정에서 정하기 <Icon name="arrow_forward" size="sm" />
            </Link>
          ) : undefined
        }
      >
        <strong>{room} 인증코드가 아직 없어요.</strong> 총괄 선생님이 행사 설정에서 인증코드를
        정해야 팀이 들어올 수 있어요.
      </InlineAlert>
    );
  }
  return (
    <section className="station-code" aria-label="교실 인증코드 안내">
      <div className="station-code__lead">
        <p className="station-code__title">
          <Icon name="login" /> {room} 인증코드
        </p>
        <p className="muted">
          라운드를 열면 들어온 팀에게 이 숫자를 알려 주세요. 팀은 미션 화면에서 이 코드를 넣고
          입장해요. 코드는 라운드마다 같아요.
        </p>
      </div>
      <p className="station-code__value number" aria-label={`${room} 인증코드`}>
        {code === undefined ? '····' : code}
      </p>
    </section>
  );
}
