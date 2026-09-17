import { useCallback, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { EmptyView, ErrorView, InlineAlert, LoadingView } from '../../components/StateViews';
import type { MissionParticipant } from '../../data/EventRepository';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import { ROUND_NUMBERS } from '../../domain/rotation';
import { getCheckInRound } from '../../domain/tour';
import type { RoundNo } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useOpsLive } from '../../hooks/useFinalLive';
import { useStationLive } from '../../hooks/useStationLive';
import { DrawingGallery } from './mission/DrawingGallery';
import { GoldenBellQuestionEditor } from './mission/GoldenBellQuestionEditor';
import { RankingEditor } from './mission/RankingEditor';
import { StationArrivalsPanel } from './mission/StationArrivalsPanel';
import { useTeacherContext } from './teacherContext';

type MissionTab = 'operate' | 'questions';

/**
 * 확정한 순위와 카드 보상이 바뀌었는지 알아보는 값. 바뀌면 순위표를 새 데이터로 다시 시작한다.
 * 학생 제출만 바뀐 때는 다시 시작하지 않고, 교사가 입력하던 점수·순위를 둔 채 목록만 맞춘다.
 */
function resultsSignature(participants: readonly MissionParticipant[]): string {
  return participants
    .map(
      ({ team, result, award }) =>
        `${team.id}:${result?.rank ?? '-'}:${result?.score ?? '-'}:${award?.status ?? '-'}:${award?.selectionMode ?? '-'}`,
    )
    .join('|');
}

export function TeacherMissionPage() {
  const { eventId, event } = useTeacherContext();
  // 부스 화면 주소는 /station/:stationId 이고 stationId는 미션 ID와 같다.
  const params = useParams();
  const missionId = params.stationId ?? params.missionId ?? '';
  const repository = useRepository();
  const { liveOps } = repository.capabilities;
  const grade = event.activeGrade;
  const [round, setRound] = useState<RoundNo>(event.activeRound === 0 ? 1 : event.activeRound);
  /** 교사가 지금 라운드가 아닌 라운드를 직접 골랐는지. 그동안은 화면을 자동으로 옮기지 않는다. */
  const [pinned, setPinned] = useState(false);
  const [tab, setTab] = useState<MissionTab>('operate');
  const [notice, setNotice] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState(false);
  /** 다음 번 참가 팀 읽기를 서버에서 할지(교사가 누른 새로고침, 확정 직전에 발견한 새 제출) */
  const freshNext = useRef(false);

  // 지금 팀이 들어오는 라운드: 활동 중이면 그 라운드, 이동 시간이면 다음 라운드
  const liveRound: RoundNo =
    (grade === null ? null : getCheckInRound(event, grade)) ??
    (event.activeRound === 0 ? 1 : event.activeRound);

  const loadMission = useCallback(
    () => repository.getMission(eventId, missionId),
    [repository, eventId, missionId],
  );
  const missionData = useAsyncData(loadMission);

  const loadRound = useCallback(async () => {
    if (grade === null) return null;
    const fresh = freshNext.current;
    freshNext.current = false;
    const [participants, revealed] = await Promise.all([
      repository.listMissionParticipants(eventId, missionId, grade, round, { fresh }),
      repository.isAnswerRevealed(eventId, missionId, grade, round),
    ]);
    return { participants, revealed };
  }, [repository, eventId, missionId, grade, round]);
  const roundData = useAsyncData(loadRound);

  // 입장 현황은 채점 자료와 따로 읽는다. 팀이 교실 QR을 찍을 때마다 이것만 다시 읽어
  // 제출물·순위를 되풀이해 읽지 않는다(무료 사용량 보호).
  const loadArrivals = useCallback(async () => {
    if (grade === null || !liveOps) return null;
    return repository.getStationArrivals(eventId, missionId, grade, round);
  }, [repository, eventId, missionId, grade, round, liveOps]);
  const arrivals = useAsyncData(loadArrivals);

  const revision = useOpsLive(eventId, liveOps ? grade : null);
  const [seenRevision, setSeenRevision] = useState(revision);
  if (seenRevision !== revision) {
    setSeenRevision(revision);
    if (arrivals.status === 'success') arrivals.reload();
  }

  // 학생이 제출하면 새로고침을 누르지 않아도 참가 팀 목록을 다시 그린다(구독 캐시에서 만들어 읽기가 늘지 않는다).
  const stationRevision = useStationLive(eventId, missionId, grade, round);
  const [seenStationRevision, setSeenStationRevision] = useState(stationRevision);
  if (seenStationRevision !== stationRevision) {
    setSeenStationRevision(stationRevision);
    if (roundData.status === 'success') roundData.reload();
  }

  // 보고 있는 라운드의 순위를 이미 확정했다면, 다음 라운드가 열릴 때 화면도 따라간다.
  // 확정 전이면 입력하던 내용을 지키려고 옮기지 않고 안내만 띄운다.
  const viewedFinalized =
    roundData.status === 'success' &&
    !roundData.refreshing &&
    roundData.data !== null &&
    roundData.data.participants.some((participant) => participant.result !== null);
  if (pinned && round === liveRound) setPinned(false);
  if (grade !== null && round !== liveRound && !pinned && viewedFinalized) {
    setRound(liveRound);
    setStaleNotice(false);
  }

  const reveal = useAction(
    useCallback(
      async (revealed: boolean) => {
        if (grade !== null)
          await repository.setAnswerRevealed(eventId, missionId, grade, round, revealed);
      },
      [repository, eventId, missionId, grade, round],
    ),
  );

  if (missionData.status === 'loading') return <LoadingView label="미션을 불러오고 있어요" />;
  if (missionData.status === 'error') {
    return <ErrorView error={missionData.error} onRetry={missionData.reload} />;
  }
  const mission = missionData.data;
  const config = mission.config;

  const refresh = () => {
    freshNext.current = true;
    missionData.reload();
    roundData.reload();
    arrivals.reload();
  };

  const pickRound = (value: RoundNo) => {
    setRound(value);
    setPinned(value !== liveRound);
    setNotice(null);
    setStaleNotice(false);
  };

  return (
    <>
      <div className="teacher-title">
        <div>
          <p className="muted">
            미션 {mission.no} · {mission.room}
            {grade !== null ? ` · ${grade}학년` : ''}
          </p>
          <h1 className="page__title">{mission.title} 운영</h1>
        </div>
        <Button variant="secondary" icon="refresh" onClick={refresh}>
          새로고침
        </Button>
      </div>

      {config.type === 'golden_bell' ? (
        <div className="segmented" role="group" aria-label="골든벨 화면 선택">
          <button
            type="button"
            className="segmented__button"
            aria-pressed={tab === 'operate'}
            onClick={() => setTab('operate')}
          >
            <Icon name="leaderboard" /> 운영·채점
          </button>
          <button
            type="button"
            className="segmented__button"
            aria-pressed={tab === 'questions'}
            onClick={() => setTab('questions')}
          >
            <Icon name="quiz" /> 문제 등록 ({config.questions.length}문항)
          </button>
        </div>
      ) : null}

      {config.type === 'golden_bell' && tab === 'questions' ? (
        <GoldenBellQuestionEditor
          eventId={eventId}
          mission={mission}
          config={config}
          onSaved={refresh}
        />
      ) : grade === null ? (
        <EmptyView title="대시보드에서 진행할 학년을 먼저 골라 주세요" icon="school" />
      ) : (
        <>
          <div className="panel teacher-actions" style={{ justifyContent: 'space-between' }}>
            <div className="round-picker" role="group" aria-label="라운드 선택">
              <span className="muted">라운드</span>
              {ROUND_NUMBERS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="round-picker__button number"
                  aria-pressed={round === value}
                  onClick={() => pickRound(value)}
                >
                  {value}
                </button>
              ))}
              {event.activeRound === round ? (
                <StatusBadge tone="primary" icon="play_arrow">
                  현재 라운드
                </StatusBadge>
              ) : null}
            </div>
            {config.type === 'golden_bell' && roundData.status === 'success' && roundData.data ? (
              <Button
                variant={roundData.data.revealed ? 'secondary' : 'accent'}
                icon={roundData.data.revealed ? 'visibility' : 'lightbulb'}
                loading={reveal.isPending}
                onClick={async () => {
                  const result = await reveal.run(!roundData.data?.revealed);
                  if (result?.ok) roundData.reload();
                }}
              >
                {roundData.data.revealed ? '정답 숨기기' : '학생 화면에 정답 공개'}
              </Button>
            ) : null}
          </div>
          {reveal.status === 'error' ? (
            <InlineAlert tone="danger">{toUserMessage(reveal.error)}</InlineAlert>
          ) : null}
          {round !== liveRound ? (
            <InlineAlert
              tone="warning"
              action={
                <Button
                  variant="secondary"
                  icon="arrow_forward"
                  onClick={() => pickRound(liveRound)}
                >
                  {liveRound}라운드로 이동
                </Button>
              }
            >
              지금 팀이 들어오는 라운드는 <strong>{liveRound}라운드</strong>예요. 이 화면은 {round}
              라운드예요.
              {round < liveRound && !pinned && !viewedFinalized
                ? ` ${round}라운드 순위를 확정하면 ${liveRound}라운드로 자동으로 넘어가요.`
                : ''}
            </InlineAlert>
          ) : null}
          {notice ? <InlineAlert tone="success">{notice}</InlineAlert> : null}
          {staleNotice ? (
            <InlineAlert tone="warning">
              방금 새 제출이 들어와서 확정하지 않았어요. 목록을 새로 불러왔으니 점수와 순위를 확인한
              뒤 다시 확정해 주세요.
            </InlineAlert>
          ) : null}

          {roundData.status === 'loading' ? (
            <LoadingView label="참가 팀을 불러오고 있어요" />
          ) : null}
          {roundData.status === 'error' ? (
            <ErrorView error={roundData.error} onRetry={roundData.reload} />
          ) : null}
          {roundData.status === 'success' && roundData.data ? (
            <>
              {arrivals.status === 'success' && arrivals.data ? (
                <StationArrivalsPanel
                  eventId={eventId}
                  mission={mission}
                  grade={grade}
                  round={round}
                  teams={roundData.data.participants.map((participant) => participant.team)}
                  arrivals={arrivals.data}
                  onChanged={arrivals.reload}
                />
              ) : null}
              {arrivals.status === 'error' ? (
                <ErrorView error={arrivals.error} onRetry={arrivals.reload} />
              ) : null}
              {config.type === 'drawing' ? (
                <DrawingGallery
                  key={`${grade}-${round}`}
                  eventId={eventId}
                  mission={mission}
                  config={config}
                  grade={grade}
                  round={round}
                  participants={roundData.data.participants}
                />
              ) : null}
              <RankingEditor
                key={`${grade}-${round}-${resultsSignature(roundData.data.participants)}`}
                eventId={eventId}
                mission={mission}
                grade={grade}
                round={round}
                participants={roundData.data.participants}
                finalized={roundData.data.participants.some(
                  (participant) => participant.result !== null,
                )}
                onChanged={(message) => {
                  // 화면이 다음 라운드로 넘어간 뒤에도 어느 라운드의 일인지 알 수 있게 라운드를 붙인다.
                  setNotice(`${round}라운드: ${message}`);
                  setStaleNotice(false);
                  roundData.reload();
                  arrivals.reload();
                }}
                onStale={() => {
                  setNotice(null);
                  setStaleNotice(true);
                  freshNext.current = true;
                  roundData.reload();
                }}
              />
            </>
          ) : null}
        </>
      )}
    </>
  );
}
