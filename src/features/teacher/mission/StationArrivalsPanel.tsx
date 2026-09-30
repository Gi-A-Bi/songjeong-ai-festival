import { useCallback } from 'react';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { StatusBadge } from '../../../components/StatusBadge';
import { InlineAlert } from '../../../components/StateViews';
import type { StationArrivals } from '../../../data/EventRepository';
import { toUserMessage } from '../../../data/errors';
import { useRepository } from '../../../data/RepositoryContext';
import { ALERT_LABELS, TEAM_MISSION_STATUS_LABELS } from '../../../domain/tour';
import type { Mission, RoundNo, Team } from '../../../domain/types';
import { useAction } from '../../../hooks/useAction';
import { formatTimeOfDay } from '../../../lib/time';
import { TEAM_STATUS_BADGES } from '../dashboard/tourBadges';

interface StationArrivalsPanelProps {
  eventId: string;
  mission: Mission;
  round: RoundNo;
  teams: readonly Team[];
  arrivals: StationArrivals;
  onChanged: () => void;
}

/** 부스 운영: 이번 라운드에 올 팀의 입장 상태와 수동 입장 처리 */
export function StationArrivalsPanel({
  eventId,
  mission,
  round,
  teams,
  arrivals,
  onChanged,
}: StationArrivalsPanelProps) {
  const repository = useRepository();
  const closed = arrivals.booth.status === 'completed';
  const rows = teams.flatMap((team) => {
    const movement = arrivals.movements.find((item) => item.teamId === team.id);
    return movement ? [{ team, movement }] : [];
  });
  const arrive = useAction(
    useCallback(
      (teamId: string) =>
        repository.markTeamArrived({ eventId, teamId, missionId: mission.id, roundNo: round }),
      [repository, eventId, mission.id, round],
    ),
  );

  const arrivedCount = rows.filter(
    ({ movement }) => movement.checkedInAt !== null || movement.resultId !== null,
  ).length;
  const actionError = arrive.status === 'error' ? arrive.error : null;

  return (
    <section className="panel stack" aria-labelledby="station-arrivals-title">
      <h2 id="station-arrivals-title" className="section-title">
        <Icon name="meeting_room" /> {round}라운드 입장 현황 · {arrivedCount}/{rows.length}팀
      </h2>
      <p className="muted">
        라운드를 연 뒤 팀이 미션 화면에서 이 교실의 인증코드를 넣으면 “입장 완료”로 바뀌어요. 코드를
        넣지 못한 팀은 “입장 처리”로 직접 기록해요.
      </p>
      {actionError ? <InlineAlert tone="danger">{toUserMessage(actionError)}</InlineAlert> : null}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">팀</th>
              <th scope="col">상태</th>
              <th scope="col">확인할 점</th>
              <th scope="col">입장 시각</th>
              <th scope="col">직접 처리</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ team, movement }) => {
              const badge = TEAM_STATUS_BADGES[movement.status];
              const arrived = movement.checkedInAt !== null || movement.resultId !== null;
              return (
                <tr key={team.id}>
                  <th scope="row">{team.displayName}</th>
                  <td>
                    <StatusBadge tone={badge.tone} icon={badge.icon}>
                      {TEAM_MISSION_STATUS_LABELS[movement.status]}
                    </StatusBadge>
                  </td>
                  <td>
                    {movement.alertCodes.length > 0 ? (
                      movement.alertCodes.map((code) => ALERT_LABELS[code]).join(', ')
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                  <td className="number">{formatTimeOfDay(movement.checkedInAt)}</td>
                  <td>
                    {arrived || closed ? (
                      <span className="muted">-</span>
                    ) : (
                      <Button
                        variant="secondary"
                        icon="login"
                        disabled={arrive.isPending}
                        onClick={async () => {
                          const result = await arrive.run(team.id);
                          if (result?.ok) onChanged();
                        }}
                      >
                        입장 처리
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
