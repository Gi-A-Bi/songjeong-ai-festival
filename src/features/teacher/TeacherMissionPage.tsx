import { useCallback, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { EmptyView, ErrorView, InlineAlert, LoadingView } from '../../components/StateViews';
import type { MissionParticipant } from '../../data/EventRepository';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import { getGoldenBellQuestions } from '../../domain/goldenBell';
import { ROUND_NUMBERS } from '../../domain/rotation';
import { MISSION_ROUND_STATUS_LABELS } from '../../domain/tour';
import type { FestivalEvent, Grade, Mission, MissionRoundState, RoundNo } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useOpsLive } from '../../hooks/useFinalLive';
import { useStationLive } from '../../hooks/useStationLive';
import { BoothRoundPanel } from './mission/BoothRoundPanel';
import { DrawingGallery } from './mission/DrawingGallery';
import { DrawingPromptPicker } from './mission/DrawingPromptPicker';
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

/** 부스 화면. 라운드는 이 부스의 선생님이 열고, 게임을 시작하고, 순위를 매긴 뒤 종료한다. */
export function TeacherMissionPage() {
  const { eventId, event } = useTeacherContext();
  // 부스 화면 주소는 /station/:stationId 이고 stationId는 미션 ID와 같다.
  const params = useParams();
  const missionId = params.stationId ?? params.missionId ?? '';
  const repository = useRepository();
  const grade = event.activeGrade;
  /** 교사가 직접 고른 라운드. null이면 이 부스가 지금 진행할 라운드를 따라간다. */
  const [picked, setPicked] = useState<RoundNo | null>(null);
  const [tab, setTab] = useState<MissionTab>('operate');
  const [notice, setNotice] = useState<string | null>(null);

  const loadMission = useCallback(
    () => repository.getMission(eventId, missionId),
    [repository, eventId, missionId],
  );
  const missionData = useAsyncData(loadMission);

  const loadBooths = useCallback(async () => {
    if (grade === null) return null;
    return repository.getStationRounds(eventId, missionId, grade);
  }, [repository, eventId, missionId, grade]);
  const booths = useAsyncData(loadBooths);

  // 체크인·라운드 단계·결과 확정이 바뀌면 조용히 다시 읽는다.
  const revision = useOpsLive(eventId, grade);
  const [seenRevision, setSeenRevision] = useState(revision);
  if (seenRevision !== revision) {
    setSeenRevision(revision);
    if (booths.status === 'success') booths.reload();
  }

  if (missionData.status === 'loading') return <LoadingView label="미션을 불러오고 있어요" />;
  if (missionData.status === 'error') {
    return <ErrorView error={missionData.error} onRetry={missionData.reload} />;
  }
  const mission = missionData.data;
  const config = mission.config;

  const refresh = () => {
    missionData.reload();
    booths.reload();
  };

  const rounds = booths.status === 'success' ? booths.data : null;
  // 이 부스가 지금 진행할 라운드: 아직 종료하지 않은 첫 라운드
  const liveRound: RoundNo | null = rounds
    ? (rounds.find((item) => item.status !== 'completed')?.roundNo ?? 5)
    : null;
  const round = picked ?? liveRound;
  const booth = rounds?.find((item) => item.roundNo === round) ?? null;

  const pickRound = (value: RoundNo) => {
    setPicked(value === liveRound ? null : value);
    setNotice(null);
  };

  return (
    <>
      <div className="teacher-title">
        <div>
          <p className="muted">
            미션 {mission.no} · {mission.room}
            {grade !== null ? ` · ${grade}학년` : ''}
          </p>
          <h1 className="page__title">{mission.title} 부스</h1>
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
            {/* 지금 진행하는 학년이 푸는 문제 수 */}
            <Icon name="quiz" /> 문제 등록 ({getGoldenBellQuestions(config, grade).length}문항)
          </button>
        </div>
      ) : null}
      {config.type === 'drawing' ? (
        <div className="segmented" role="group" aria-label="그리기 화면 선택">
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
            <Icon name="museum" /> 프롬프트 고르기
          </button>
        </div>
      ) : null}

      {config.type === 'golden_bell' && tab === 'questions' ? (
        <GoldenBellQuestionEditor
          eventId={eventId}
          mission={mission}
          config={config}
          grade={grade}
          onSaved={refresh}
        />
      ) : config.type === 'drawing' && tab === 'questions' ? (
        <DrawingPromptPicker
          eventId={eventId}
          mission={mission}
          config={config}
          event={event}
          onSaved={refresh}
        />
      ) : grade === null ? (
        <EmptyView
          title="총괄 선생님이 대시보드에서 진행 학년을 고르면 시작할 수 있어요"
          icon="school"
        />
      ) : (
        <>
          {booths.status === 'loading' ? <LoadingView label="라운드를 불러오고 있어요" /> : null}
          {booths.status === 'error' ? (
            <ErrorView error={booths.error} onRetry={booths.reload} />
          ) : null}
          {rounds && round !== null && liveRound !== null && booth ? (
            <>
              <div className="panel round-picker" role="group" aria-label="라운드 선택">
                <span className="muted">라운드</span>
                {ROUND_NUMBERS.map((value) => {
                  const item = rounds.find((entry) => entry.roundNo === value);
                  return (
                    <button
                      key={value}
                      type="button"
                      className="round-picker__button number"
                      aria-pressed={round === value}
                      aria-label={`${value}라운드${item ? ` ${item.skipped ? '건너뜀' : MISSION_ROUND_STATUS_LABELS[item.status]}` : ''}`}
                      onClick={() => pickRound(value)}
                    >
                      {value}
                      {item?.status === 'completed' ? (
                        <Icon name={item.skipped ? 'arrow_forward' : 'check_circle'} size="sm" />
                      ) : null}
                    </button>
                  );
                })}
                {round === liveRound ? (
                  <StatusBadge tone="primary" icon="play_arrow">
                    지금 라운드
                  </StatusBadge>
                ) : null}
              </div>
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
                  이 부스가 지금 진행할 라운드는 <strong>{liveRound}라운드</strong>예요. 이 화면은{' '}
                  {round}라운드예요.
                </InlineAlert>
              ) : null}
              {notice ? <InlineAlert tone="success">{notice}</InlineAlert> : null}
              <BoothRound
                key={`${grade}-${round}`}
                eventId={eventId}
                event={event}
                mission={mission}
                grade={grade}
                round={round}
                booth={booth}
                previousCompleted={
                  round === 1 ||
                  rounds.find((item) => item.roundNo === round - 1)?.status === 'completed'
                }
                opsRevision={revision}
                onNotice={setNotice}
                onBoothChanged={booths.reload}
              />
            </>
          ) : null}
        </>
      )}
    </>
  );
}

interface BoothRoundProps {
  eventId: string;
  event: FestivalEvent;
  mission: Mission;
  grade: Grade;
  round: RoundNo;
  booth: MissionRoundState;
  previousCompleted: boolean;
  /** 체크인·부스 단계가 바뀔 때마다 달라지는 값 */
  opsRevision: number;
  onNotice: (message: string | null) => void;
  onBoothChanged: () => void;
}

/** 한 라운드의 진행 단계, 입장 현황, 채점 */
function BoothRound({
  eventId,
  event,
  mission,
  grade,
  round,
  booth,
  previousCompleted,
  opsRevision,
  onNotice,
  onBoothChanged,
}: BoothRoundProps) {
  const repository = useRepository();
  const { liveOps } = repository.capabilities;
  const config = mission.config;
  const [staleNotice, setStaleNotice] = useState(false);
  /** 다음 번 참가 팀 읽기를 서버에서 할지(확정 직전에 발견한 새 제출) */
  const freshNext = useRef(false);

  const loadRound = useCallback(async () => {
    const fresh = freshNext.current;
    freshNext.current = false;
    const [participants, revealed] = await Promise.all([
      repository.listMissionParticipants(eventId, mission.id, grade, round, { fresh }),
      repository.isAnswerRevealed(eventId, mission.id, grade, round),
    ]);
    return { participants, revealed };
  }, [repository, eventId, mission.id, grade, round]);
  const roundData = useAsyncData(loadRound);

  // 입장 현황은 채점 자료와 따로 읽는다. 팀이 교실 QR을 찍을 때마다 이것만 다시 읽어
  // 제출물·순위를 되풀이해 읽지 않는다(무료 사용량 보호).
  const loadArrivals = useCallback(async () => {
    if (!liveOps) return null;
    return repository.getStationArrivals(eventId, mission.id, grade, round);
  }, [repository, eventId, mission.id, grade, round, liveOps]);
  const arrivals = useAsyncData(loadArrivals);

  const [seenRevision, setSeenRevision] = useState(opsRevision);
  if (seenRevision !== opsRevision) {
    setSeenRevision(opsRevision);
    if (arrivals.status === 'success') arrivals.reload();
  }

  // 학생이 제출하면 새로고침을 누르지 않아도 참가 팀 목록을 다시 그린다(구독 캐시에서 만들어 읽기가 늘지 않는다).
  const stationRevision = useStationLive(eventId, mission.id, grade, round);
  const [seenStationRevision, setSeenStationRevision] = useState(stationRevision);
  if (seenStationRevision !== stationRevision) {
    setSeenStationRevision(stationRevision);
    if (roundData.status === 'success') roundData.reload();
  }

  const reveal = useAction(
    useCallback(
      (revealed: boolean) =>
        repository.setAnswerRevealed(eventId, mission.id, grade, round, revealed),
      [repository, eventId, mission.id, grade, round],
    ),
  );

  const participants = roundData.status === 'success' ? roundData.data.participants : null;
  const rankingFinalized =
    booth.resultFinalizedAt !== null ||
    (participants?.some((participant) => participant.result !== null) ?? false);
  const movements = arrivals.status === 'success' ? (arrivals.data?.movements ?? null) : null;

  return (
    <>
      <BoothRoundPanel
        eventId={eventId}
        mission={mission}
        grade={grade}
        round={round}
        booth={booth}
        touring={event.activeGrade === grade}
        previousCompleted={previousCompleted}
        rankingFinalized={rankingFinalized}
        arrivals={
          movements
            ? {
                expected: movements.length,
                arrived: movements.filter(
                  (item) => item.checkedInAt !== null || item.resultId !== null,
                ).length,
              }
            : null
        }
        gameMinutes={Math.round(event.gameDurationMs / 60_000)}
        onChanged={(message) => {
          onNotice(message);
          onBoothChanged();
          arrivals.reload();
        }}
      />

      {config.type === 'golden_bell' && roundData.status === 'success' ? (
        <div className="panel teacher-actions">
          <Button
            variant={roundData.data.revealed ? 'secondary' : 'accent'}
            icon={roundData.data.revealed ? 'visibility' : 'lightbulb'}
            loading={reveal.isPending}
            onClick={async () => {
              const result = await reveal.run(!roundData.data.revealed);
              if (result?.ok) roundData.reload();
            }}
          >
            {roundData.data.revealed ? '정답 숨기기' : '학생 화면에 정답 공개'}
          </Button>
        </div>
      ) : null}
      {reveal.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(reveal.error)}</InlineAlert>
      ) : null}
      {staleNotice ? (
        <InlineAlert tone="warning">
          방금 새 제출이 들어와서 확정하지 않았어요. 목록을 새로 불러왔으니 점수와 순위를 확인한 뒤
          다시 확정해 주세요.
        </InlineAlert>
      ) : null}

      {roundData.status === 'loading' ? <LoadingView label="참가 팀을 불러오고 있어요" /> : null}
      {roundData.status === 'error' ? (
        <ErrorView error={roundData.error} onRetry={roundData.reload} />
      ) : null}
      {roundData.status === 'success' ? (
        <>
          {arrivals.status === 'success' && arrivals.data ? (
            <StationArrivalsPanel
              eventId={eventId}
              mission={mission}
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
              roundMinutes={Math.round(event.gameDurationMs / 60_000)}
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
              onNotice(`${round}라운드: ${message}`);
              setStaleNotice(false);
              roundData.reload();
              arrivals.reload();
              onBoothChanged();
            }}
            onStale={() => {
              onNotice(null);
              setStaleNotice(true);
              freshNext.current = true;
              roundData.reload();
            }}
          />
          {/* 순위표는 화면 아래쪽이라, 확정한 뒤 할 일을 바로 옆에서 알려 준다. */}
          {rankingFinalized && booth.status !== 'completed' ? (
            <InlineAlert
              tone="warning"
              action={
                <Button
                  icon="arrow_upward"
                  onClick={() => document.getElementById('booth-round-title')?.scrollIntoView()}
                >
                  {round}라운드 종료하러 가기
                </Button>
              }
            >
              순위를 확정했어요. <strong>“{round}라운드 종료”</strong>를 눌러야 팀이 다음 교실에
              들어갈 수 있어요.
            </InlineAlert>
          ) : null}
        </>
      ) : null}
    </>
  );
}
