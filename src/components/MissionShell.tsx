import type { ReactNode } from 'react';
import { missionImageKeys } from '../assets/manifest';
import { MISSION_TYPE_INFO } from '../domain/catalog';
import { getCheckInRound } from '../domain/tour';
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

/**
 * 다섯 미션이 함께 쓰는 틀: 미션 정보, 라운드, 상태, 타이머, 행동 버튼.
 * 문제와 보기가 한 화면에 들어오도록 미션 정보와 남은 시간을 한 줄에 둔다. 팀 이름은 머리줄에 있다.
 */
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
  // event는 이 팀이 보는 행사 상태다. 부스에 들어가기 전에는 다음 라운드가 지금 차례다.
  const touring = event.activeGrade === team.grade;
  const turnRound = getCheckInRound(event, team.grade);
  const isCurrentRound = turnRound === roundNo;
  const isPastRound = touring && (turnRound === null || roundNo < turnRound);
  const playing = isCurrentRound && event.status === 'active';

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
            {roundNo}라운드 · 미션 {mission.no} · {mission.room}
          </p>
          <div className="mission-shell__titleline">
            <h1 id="mission-title" className="mission-shell__title">
              {mission.title}
            </h1>
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
        <div className="mission-shell__timer">
          <Timer
            status={playing ? 'active' : 'ready'}
            endsAt={playing ? event.roundEndsAt : null}
            variant="bar"
            totalMs={event.gameDurationMs}
            audible={playing}
          />
        </div>
      </section>
      {notice}
      <div className="mission-shell__body">{children}</div>
      {actions ? <div className="mission-shell__actions">{actions}</div> : null}
    </div>
  );
}
