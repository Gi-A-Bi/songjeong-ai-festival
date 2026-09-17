import { useCallback, useRef, useState } from 'react';
import { paths } from '../../../app/paths';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { StatusBadge } from '../../../components/StatusBadge';
import { InlineAlert } from '../../../components/StateViews';
import type { StationArrivals } from '../../../data/EventRepository';
import { toUserMessage } from '../../../data/errors';
import { useRepository } from '../../../data/RepositoryContext';
import {
  ALERT_LABELS,
  MISSION_ROUND_STATUS_LABELS,
  TEAM_MISSION_STATUS_LABELS,
} from '../../../domain/tour';
import type { Grade, Mission, RoundNo, Team } from '../../../domain/types';
import { useAction } from '../../../hooks/useAction';
import { copyText } from '../../../lib/download';
import { formatTimeOfDay } from '../../../lib/time';
import { BOOTH_STATUS_BADGES, TEAM_STATUS_BADGES } from '../dashboard/tourBadges';

interface StationArrivalsPanelProps {
  eventId: string;
  mission: Mission;
  grade: Grade;
  round: RoundNo;
  teams: readonly Team[];
  arrivals: StationArrivals;
  onChanged: () => void;
}

/** 부스 교사용: 이번 라운드에 올 팀의 입장 상태, “미션 시작”, 수동 입장 처리 */
export function StationArrivalsPanel({
  eventId,
  mission,
  grade,
  round,
  teams,
  arrivals,
  onChanged,
}: StationArrivalsPanelProps) {
  const repository = useRepository();
  const { booth } = arrivals;
  const rows = teams.flatMap((team) => {
    const movement = arrivals.movements.find((item) => item.teamId === team.id);
    return movement ? [{ team, movement }] : [];
  });
  const start = useAction(
    useCallback(
      () => repository.startStationRound({ eventId, missionId: mission.id, grade, roundNo: round }),
      [repository, eventId, mission.id, grade, round],
    ),
  );
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
  const boothBadge = BOOTH_STATUS_BADGES[booth.status];
  const started = booth.startedAt !== null;
  const actionError =
    start.status === 'error' ? start.error : arrive.status === 'error' ? arrive.error : null;

  return (
    <section className="panel stack" aria-labelledby="station-arrivals-title">
      <div className="teacher-title">
        <h2 id="station-arrivals-title" className="section-title">
          <Icon name="meeting_room" /> {round}라운드 입장 현황 · {arrivedCount}/{rows.length}팀
        </h2>
        <div className="cluster">
          <StatusBadge tone={boothBadge.tone} icon={boothBadge.icon} size="lg">
            {MISSION_ROUND_STATUS_LABELS[booth.status]}
          </StatusBadge>
          <Button
            size="lg"
            icon="play_arrow"
            disabled={started}
            loading={start.isPending}
            onClick={async () => {
              const result = await start.run();
              if (result?.ok) onChanged();
            }}
          >
            {started ? `시작함 ${formatTimeOfDay(booth.startedAt)}` : '미션 시작'}
          </Button>
        </div>
      </div>
      <p className="muted">
        팀이 교실 QR을 찍으면 “입장 완료”로 바뀌어요. “미션 시작”을 누르면 입장한 팀이 “진행 중”이
        되고, 아래에서 결과를 확정하면 “완료”가 돼요.
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
                    {arrived ? (
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

      <StationQrAddress eventId={eventId} mission={mission} />
    </section>
  );
}

/** 교실 문에 붙일 QR 주소. 무료 QR 생성기나 학교 프린터 프로그램에 붙여 넣어 만든다. */
function StationQrAddress({ eventId, mission }: { eventId: string; mission: Mission }) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  const address = `${window.location.origin}${paths.stationQr(eventId, mission.id)}`;

  return (
    <details className="station-qr">
      <summary>
        <Icon name="qr_code_scanner" size="sm" /> {mission.room} 교실 QR 주소
      </summary>
      <div className="stack">
        <p className="muted">
          이 주소로 QR 코드를 만들어 교실 입구에 붙여 주세요. 팀 기기로 찍으면 도착이 기록돼요.
        </p>
        <textarea
          ref={fieldRef}
          className="text-input station-qr__field"
          readOnly
          rows={2}
          value={address}
          aria-label={`${mission.room} 교실 QR 주소`}
        />
        <div className="cluster">
          <Button
            variant="secondary"
            icon="content_copy"
            onClick={async () => setCopied(await copyText(address, fieldRef.current))}
          >
            주소 복사
          </Button>
          {copied === true ? (
            <StatusBadge tone="success" icon="check_circle">
              복사했어요
            </StatusBadge>
          ) : null}
          {copied === false ? (
            <span className="muted">복사하지 못했어요. 주소를 길게 눌러 직접 복사해 주세요.</span>
          ) : null}
        </div>
      </div>
    </details>
  );
}
