import type { ReactNode } from 'react';
import { missionImageKeys } from '../../assets/manifest';
import { AssetImage } from '../../components/AssetImage';
import { Icon } from '../../components/Icon';
import type { MissionLockReason } from '../../domain/missionPhase';
import type { Mission } from '../../domain/types';
import { missionLockTitle } from './missionLock';
import './Missions.css';

interface MissionLockedPanelProps {
  mission: Mission;
  reason: MissionLockReason;
  /** 무엇이 나타나는지, 조사까지 붙여서("문제가", "그림 프롬프트가") */
  subject?: string;
  /** 기다리는 동안 알려 줄 것(문제 수, 규칙 등). 정답의 실마리가 되면 안 된다. */
  children?: ReactNode;
}

/**
 * 게임을 시작하기 전(또는 인증코드를 넣기 전)에 문제 대신 보여 주는 가림막.
 * 실제 문제·그림·지문은 화면에 올리지 않고 미션 안내 삽화만 흐리게 깐다.
 */
export function MissionLockedPanel({
  mission,
  reason,
  subject = '문제가',
  children,
}: MissionLockedPanelProps) {
  return (
    <div className="mission-cover" role="status">
      <AssetImage
        asset={missionImageKeys[mission.type]}
        decorative
        className="mission-cover__image"
        loading="eager"
      />
      <div className="mission-cover__body">
        <Icon name={reason === 'not-entered' ? 'login' : 'lock'} size="xl" />
        <p className="mission-cover__title">{missionLockTitle(reason, subject)}</p>
        {children ? <div className="mission-cover__text">{children}</div> : null}
      </div>
    </div>
  );
}
