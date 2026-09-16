import type { ReactNode } from 'react';
import { missionImageKeys } from '../assets/manifest';
import { MISSION_TYPE_INFO } from '../domain/catalog';
import type { FestivalEvent, Mission, MissionPhase, RoundNo, Team } from '../domain/types';
import { AssetImage } from './AssetImage';
import { Icon } from './Icon';
import { MissionPhaseBadge, StatusBadge } from './StatusBadge';
import { Timer } from './Timer';
import './MissionShell.css';

interface MissionShellProps {
  mission: Mission;
  team: Team;
  roundNo: RoundNo;
  event: FestivalEvent;
  phase: MissionPhase;
  /** 제출 결과·오류 같은 상태 안내 */
  notice?: ReactNode;
  /** 화면 아래에 고정되는 대표 행동 영역 */
  actions?: ReactNode;
  children: ReactNode;
}

/** 다섯 미션이 함께 쓰는 틀: 미션 정보, 팀·라운드, 상태, 타이머, 행동 버튼 */
export function MissionShell({
  mission,
  team,
  roundNo,
  event,
  phase,
  notice,
  actions,
  children,
}: MissionShellProps) {
  const typeInfo = MISSION_TYPE_INFO[mission.type];
  const isCurrentRound = event.activeGrade === team.grade && event.activeRound === roundNo;
  const isPastRound = event.activeGrade === team.grade && roundNo < event.activeRound;

  return (
    <div className={`mission-shell accent-${typeInfo.accent}`}>
      <section className="mission-shell__head" aria-labelledby="mission-title">
        <AssetImage
          asset={missionImageKeys[mission.type]}
          decorative
          className="mission-shell__thumb"
          loading="eager"
        />
        <div className="mission-shell__heading">
          <p className="mission-shell__eyebrow">
            <Icon name={typeInfo.icon} />
            미션 {mission.no} · {mission.room}
          </p>
          <h1 id="mission-title" className="mission-shell__title">
            {mission.title}
          </h1>
          <div className="cluster">
            <MissionPhaseBadge phase={phase} />
            {mission.teacherJudged ? (
              <StatusBadge tone="accent" icon="school">
                선생님 판정
              </StatusBadge>
            ) : null}
            {!isCurrentRound ? (
              <StatusBadge tone="neutral" icon={isPastRound ? 'schedule' : 'visibility'}>
                {isPastRound ? `${roundNo}라운드 지난 미션` : `${roundNo}라운드 미션 미리보기`}
              </StatusBadge>
            ) : null}
          </div>
        </div>
        <div className="mission-shell__meta">
          <p className="mission-shell__team">
            <Icon name="groups" />
            {team.displayName} · {roundNo}라운드
          </p>
          {isCurrentRound ? (
            <Timer
              status={event.status}
              endsAt={event.roundEndsAt}
              pausedRemainingMs={event.pausedRemainingMs}
              size="lg"
            />
          ) : (
            <Timer status="ready" endsAt={null} pausedRemainingMs={null} size="lg" />
          )}
        </div>
      </section>
      {notice}
      <div className="mission-shell__body">{children}</div>
      {actions ? <div className="mission-shell__actions">{actions}</div> : null}
    </div>
  );
}
