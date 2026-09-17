import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { paths } from '../../../app/paths';
import { Button, ButtonLink } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { StatusBadge } from '../../../components/StatusBadge';
import { ErrorView, InlineAlert, LoadingView } from '../../../components/StateViews';
import type { OpsDashboard, OpsTeamCell } from '../../../data/EventRepository';
import { useRepository } from '../../../data/RepositoryContext';
import { MISSION_TYPE_INFO } from '../../../domain/catalog';
import { ROUND_NUMBERS } from '../../../domain/rotation';
import {
  ALERT_LABELS,
  MISSION_ROUND_STATUS_LABELS,
  ROUND_PHASE_LABELS,
  TEAM_MISSION_STATUS_LABELS,
} from '../../../domain/tour';
import type { FestivalEvent, Grade, RoundNo } from '../../../domain/types';
import { useAsyncData } from '../../../hooks/useAsyncData';
import { useOpsLive } from '../../../hooks/useFinalLive';
import { useServerNow } from '../../../hooks/useServerNow';
import { formatClock, formatTimeOfDay } from '../../../lib/time';
import { ClassDetailPanel } from './ClassDetailPanel';
import { BOOTH_STATUS_BADGES, TEAM_STATUS_BADGES } from './tourBadges';
import './OpsBoard.css';

/** 미도착·결과 미입력 경고는 시간이 지나면 생기므로 진행 중에는 주기적으로 다시 계산한다. */
const ALERT_REFRESH_MS = 15_000;

interface OpsBoardProps {
  eventId: string;
  grade: Grade;
  event: FestivalEvent;
}

/** 현재 학년의 실시간 운영 상황판: 요약, 확인 필요, 미션 교실별·학급별 현황, 최근 활동 */
export function OpsBoard({ eventId, grade, event }: OpsBoardProps) {
  const repository = useRepository();
  /** null이면 자동(활동 중엔 지금 라운드, 이동 중엔 다음 라운드) */
  const [round, setRound] = useState<RoundNo | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const load = useCallback(
    () => repository.getOpsDashboard(eventId, grade, round ?? undefined),
    [repository, eventId, grade, round],
  );
  const board = useAsyncData(load);
  const { reload } = board;

  // 체크인·미션 시작·결과 확정·라운드 변경이 생기면 조용히 다시 읽는다.
  const revision = useOpsLive(eventId, grade);
  const refreshKey = `${revision}|${event.status}|${event.activeRound}|${event.activeGrade}`;
  const [seenKey, setSeenKey] = useState(refreshKey);
  if (seenKey !== refreshKey) {
    setSeenKey(refreshKey);
    if (board.status === 'success') reload();
  }
  const running = event.activeGrade === grade && event.status !== 'completed';
  useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(reload, ALERT_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [running, reload]);

  if (board.status === 'loading') return <LoadingView label="운영 현황을 불러오고 있어요" />;
  if (board.status === 'error') return <ErrorView error={board.error} onRetry={reload} />;

  const data = board.data;
  return (
    <>
      <div className="ops-toolbar">
        <div className="round-picker" role="group" aria-label="보여 줄 라운드">
          <button
            type="button"
            className={`round-picker__button${round === null ? ' round-picker__button--active' : ''}`}
            aria-pressed={round === null}
            onClick={() => setRound(null)}
          >
            자동
          </button>
          {ROUND_NUMBERS.map((value) => (
            <button
              key={value}
              type="button"
              className={`round-picker__button${round === value ? ' round-picker__button--active' : ''}`}
              aria-pressed={round === value}
              onClick={() => setRound(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <Button variant="secondary" icon="refresh" onClick={reload}>
          새로고침
        </Button>
      </div>

      <SummaryTiles data={data} event={event} grade={grade} />
      <AlertList eventId={eventId} data={data} />
      <StationGrid eventId={eventId} data={data} />
      <ClassTable
        data={data}
        selectedClassId={selectedClassId}
        onSelect={(classId) =>
          setSelectedClassId((current) => (current === classId ? null : classId))
        }
      />
      {selectedClassId ? (
        <ClassDetailPanel
          key={`${selectedClassId}-${revision}`}
          eventId={eventId}
          classId={selectedClassId}
        />
      ) : null}
      <ActivityFeed data={data} />
    </>
  );
}

function SummaryTiles({
  data,
  event,
  grade,
}: {
  data: OpsDashboard;
  event: FestivalEvent;
  grade: Grade;
}) {
  const now = useServerNow(1000);
  const { summary } = data;
  let timerLabel = '남은 시간';
  let timerValue = '--:--';
  if (event.activeGrade === grade) {
    if (summary.phase === 'active') {
      const remaining =
        event.status === 'paused'
          ? (event.pausedRemainingMs ?? 0)
          : Math.max(0, (event.roundEndsAt ?? now) - now);
      timerLabel = event.status === 'paused' ? '활동(일시정지)' : '활동 남은 시간';
      timerValue = formatClock(Math.ceil(remaining / 1000));
    } else if (summary.phase === 'moving' && event.roundEndedAt !== null) {
      const remaining = Math.max(0, event.roundEndedAt + event.moveDurationMs - now);
      timerLabel = remaining > 0 ? '이동 남은 시간' : '이동 시간 끝';
      timerValue = formatClock(Math.ceil(remaining / 1000));
    }
  }

  return (
    <section className="ops-summary" aria-label={`${grade}학년 운영 요약`}>
      <dl className="ops-summary__list">
        <div className="ops-tile">
          <dt>학년 · 라운드</dt>
          <dd className="number">
            {grade}학년 {summary.roundNo === 0 ? '시작 전' : `${summary.roundNo}/5`}
          </dd>
        </div>
        <div className="ops-tile">
          <dt>라운드 상태</dt>
          <dd>{ROUND_PHASE_LABELS[summary.phase]}</dd>
        </div>
        <div className="ops-tile">
          <dt>{timerLabel}</dt>
          <dd className="number" role="timer" aria-label={`${timerLabel} ${timerValue}`}>
            {timerValue}
          </dd>
        </div>
        <div className="ops-tile">
          <dt>입장 완료</dt>
          <dd className="number">
            {summary.checkedInTeams} / {summary.expectedTeams}팀
          </dd>
        </div>
        <div className="ops-tile">
          <dt>미션 완료</dt>
          <dd className="number">
            {summary.completedTeams} / {summary.expectedTeams}팀
          </dd>
        </div>
        <div className={`ops-tile${summary.alertCount > 0 ? ' ops-tile--alert' : ''}`}>
          <dt>확인 필요</dt>
          <dd className="number">
            {summary.alertCount > 0 ? <Icon name="warning" /> : <Icon name="check_circle" />}{' '}
            {summary.alertCount}건
          </dd>
        </div>
      </dl>
    </section>
  );
}

function AlertList({ eventId, data }: { eventId: string; data: OpsDashboard }) {
  return (
    <section className="panel stack" aria-labelledby="ops-alerts-title">
      <h2 id="ops-alerts-title" className="section-title">
        <Icon name="warning" /> 확인 필요 ({data.alerts.length}건)
      </h2>
      {data.alerts.length === 0 ? (
        <InlineAlert tone="success">미도착·잘못된 교실·결과 미입력이 없어요.</InlineAlert>
      ) : (
        <ul className="ops-alerts">
          {data.alerts.map((alert) => (
            <li key={alert.id} className="ops-alert">
              <StatusBadge tone="danger" icon="warning">
                {ALERT_LABELS[alert.code]}
              </StatusBadge>
              <span className="ops-alert__text">
                <strong>{alert.team.displayName}</strong> · {alert.roundNo}라운드{' '}
                {alert.mission.title}({alert.mission.room})
              </span>
              <Link
                to={paths.teacherStation(eventId, alert.mission.id)}
                className="teacher-shortcuts__link"
              >
                부스 열기 <Icon name="arrow_forward" size="sm" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TeamChip({ cell }: { cell: OpsTeamCell }) {
  const badge = TEAM_STATUS_BADGES[cell.state.status];
  return (
    <li className={`ops-chip ops-chip--${cell.state.status}`}>
      <Icon name={badge.icon} size="sm" />
      <span>
        {cell.team.classNo}반 {cell.team.teamNo}팀
      </span>
      <span className="ops-chip__status">{TEAM_MISSION_STATUS_LABELS[cell.state.status]}</span>
    </li>
  );
}

function StationGrid({ eventId, data }: { eventId: string; data: OpsDashboard }) {
  return (
    <section className="stack" aria-labelledby="ops-stations-title">
      <h2 id="ops-stations-title" className="section-title">
        <Icon name="meeting_room" /> 미션 교실별 현황
      </h2>
      <ul className="ops-stations">
        {data.stations.map((station) => {
          const booth = BOOTH_STATUS_BADGES[station.round.status];
          return (
            <li
              key={station.mission.id}
              className={`ops-station accent-${MISSION_TYPE_INFO[station.mission.type].accent}`}
            >
              <p className="ops-station__eyebrow">
                <Icon name={MISSION_TYPE_INFO[station.mission.type].icon} size="sm" />
                미션 {station.mission.no} · {station.mission.room}
              </p>
              <h3 className="ops-station__title">{station.mission.title}</h3>
              <div className="cluster">
                <StatusBadge tone={booth.tone} icon={booth.icon}>
                  {MISSION_ROUND_STATUS_LABELS[station.round.status]}
                </StatusBadge>
                <span className="muted">
                  제출 {station.submitted}/{station.teams.length}
                </span>
              </div>
              <ul className="ops-chips" aria-label={`${station.mission.title} 예정 팀`}>
                {station.teams.map((cell) => (
                  <TeamChip key={cell.team.id} cell={cell} />
                ))}
              </ul>
              <ButtonLink
                to={paths.teacherStation(eventId, station.mission.id)}
                variant="secondary"
                iconEnd="arrow_forward"
                fullWidth
              >
                부스 열기
              </ButtonLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ClassTable({
  data,
  selectedClassId,
  onSelect,
}: {
  data: OpsDashboard;
  selectedClassId: string | null;
  onSelect: (classId: string) => void;
}) {
  return (
    <section className="panel stack" aria-labelledby="ops-classes-title">
      <h2 id="ops-classes-title" className="section-title">
        <Icon name="groups" /> 학급·팀별 현황
      </h2>
      <p className="muted">학급 이름을 누르면 완료 미션, 순위, 카드 진행도를 볼 수 있어요.</p>
      <div className="table-wrap">
        <table className="data-table ops-table">
          <thead>
            <tr>
              <th scope="col">학급</th>
              {[1, 2, 3, 4, 5].map((teamNo) => (
                <th key={teamNo} scope="col">
                  {teamNo}팀
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.classRows.map((row) => (
              <tr key={row.classInfo.id}>
                <th scope="row">
                  <button
                    type="button"
                    className="ops-table__class"
                    aria-expanded={selectedClassId === row.classInfo.id}
                    onClick={() => onSelect(row.classInfo.id)}
                  >
                    {row.classInfo.displayName}
                    <Icon
                      name={selectedClassId === row.classInfo.id ? 'arrow_upward' : 'arrow_downward'}
                      size="sm"
                    />
                  </button>
                </th>
                {row.cells.map((cell) => {
                  const badge = TEAM_STATUS_BADGES[cell.state.status];
                  return (
                    <td key={cell.team.id}>
                      <span className="ops-cell">
                        <span className="ops-cell__mission">
                          <Icon name={MISSION_TYPE_INFO[cell.mission.type].icon} size="sm" />
                          {cell.mission.room}
                        </span>
                        <StatusBadge tone={badge.tone} icon={badge.icon}>
                          {cell.state.alertCodes.length > 0
                            ? cell.state.alertCodes.map((code) => ALERT_LABELS[code]).join('·')
                            : TEAM_MISSION_STATUS_LABELS[cell.state.status]}
                        </StatusBadge>
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ActivityFeed({ data }: { data: OpsDashboard }) {
  return (
    <section className="panel stack" aria-labelledby="ops-activity-title">
      <h2 id="ops-activity-title" className="section-title">
        <Icon name="format_list_numbered" /> 최근 활동
      </h2>
      {data.activity.length === 0 ? (
        <p className="muted">아직 기록된 활동이 없어요.</p>
      ) : (
        <ol className="ops-activity">
          {data.activity.map((event) => (
            <li key={event.id} className={`ops-activity__item ops-activity__item--${event.type}`}>
              <time className="number muted">{formatTimeOfDay(event.at)}</time>
              <span>{event.message}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
