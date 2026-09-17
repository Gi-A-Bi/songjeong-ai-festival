import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { paths } from '../../app/paths';
import { missionImageKeys } from '../../assets/manifest';
import { AppHeader } from '../../components/AppHeader';
import { AssetImage } from '../../components/AssetImage';
import { ButtonLink } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { StatusBadge, type StatusTone } from '../../components/StatusBadge';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { Timer } from '../../components/Timer';
import type { IconName } from '../../components/icons';
import { useRepository } from '../../data/RepositoryContext';
import { MISSION_TYPE_INFO } from '../../domain/catalog';
import { getMissionNoForRound, ROUND_NUMBERS } from '../../domain/rotation';
import type { FestivalEvent, RoundNo, Team, TeamMissionState } from '../../domain/types';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useMissionLiveState } from '../../hooks/useMissionLiveState';
import { useTeamContext } from './teamContext';
import './TeamHomePage.css';

type FocusKind = 'now' | 'next' | 'first' | 'done';

/** 팀 홈에서 가장 크게 보여 줄 미션 라운드를 고른다. 5라운드를 모두 제출했으면 투어가 끝난 것이다. */
function getFocus(
  event: FestivalEvent,
  team: Team,
  allSubmitted: boolean,
): { roundNo: RoundNo; kind: FocusKind } {
  if (allSubmitted) return { roundNo: 5, kind: 'done' };
  if (event.activeGrade !== team.grade || event.activeRound === 0)
    return { roundNo: 1, kind: 'first' };
  if (event.status === 'active' || event.status === 'paused') {
    return { roundNo: event.activeRound, kind: 'now' };
  }
  if (event.activeRound < 5) return { roundNo: (event.activeRound + 1) as RoundNo, kind: 'next' };
  return { roundNo: 5, kind: 'done' };
}

const FOCUS_LABELS: Record<FocusKind, string> = {
  now: '지금 미션',
  next: '다음 미션으로 이동해요',
  first: '첫 미션',
  done: '모든 미션이 끝났어요',
};

export function TeamHomePage() {
  const { eventId, team, event } = useTeamContext();
  const repository = useRepository();

  const load = useCallback(async () => {
    const [missions, submissions, rewards, tour] = await Promise.all([
      repository.listMissions(eventId),
      repository.listTeamSubmissions(eventId, team.id),
      repository.getTeamRewardView(eventId, team.id),
      // 팀 이동 기록을 연결하지 않은 모드에서는 도착 안내를 숨긴다.
      repository.capabilities.liveOps ? repository.getTeamTourStatus(eventId, team.id) : null,
    ]);
    return { missions, submissions, rewards, tour };
  }, [repository, eventId, team.id]);
  const data = useAsyncData(load);
  const loaded = data.status === 'success' ? data.data : null;

  // 선생님이 지금 라운드의 순위를 확정하거나 다음 라운드를 시작하면 새로고침 없이 다시 읽는다.
  // 그래야 "카드 보상 고르기" 버튼과 다음 미션 안내가 바로 나타난다.
  const liveRound =
    event.activeGrade === team.grade && event.activeRound !== 0 ? event.activeRound : null;
  const liveMission =
    loaded && liveRound !== null
      ? loaded.missions.find((item) => item.no === getMissionNoForRound(team.teamNo, liveRound))
      : undefined;
  const liveRevision = useMissionLiveState(
    eventId,
    liveMission && liveRound !== null
      ? { missionId: liveMission.id, grade: team.grade, roundNo: liveRound }
      : null,
  );
  const refreshKey = `${event.status}|${event.activeGrade}|${event.activeRound}|${liveRevision}`;
  const [seenRefreshKey, setSeenRefreshKey] = useState(refreshKey);
  if (seenRefreshKey !== refreshKey) {
    setSeenRefreshKey(refreshKey);
    if (loaded) data.reload();
  }

  const header = <AppHeader backTo={paths.join(eventId)} subtitle={team.displayName} />;

  if (data.status !== 'success') {
    return (
      <>
        {header}
        <main className="page">
          {data.status === 'loading' ? (
            <LoadingView />
          ) : (
            <ErrorView error={data.error} onRetry={data.reload} />
          )}
        </main>
      </>
    );
  }

  const { missions, submissions, rewards, tour } = data.data;
  const isMyGrade = event.activeGrade === team.grade;
  const pendingRewards = rewards.awards.filter((award) => award.status === 'pending').length;

  const schedule = ROUND_NUMBERS.map((roundNo) => {
    const mission = missions.find((item) => item.no === getMissionNoForRound(team.teamNo, roundNo));
    const submission = mission
      ? submissions.find((item) => item.missionId === mission.id && item.status !== 'draft')
      : undefined;
    return { roundNo, mission, done: submission !== undefined };
  });
  const doneCount = schedule.filter((item) => item.done).length;
  const focus = getFocus(event, team, doneCount === ROUND_NUMBERS.length);
  // 지금 안내하는 라운드의 도착(체크인) 상태
  const arrival = tour && tour.roundNo === focus.roundNo ? tour.state : null;
  const focusMission = schedule.find((item) => item.roundNo === focus.roundNo)?.mission;

  return (
    <>
      {header}
      <main className="page team-home">
        <h1 className="visually-hidden">{team.displayName} 팀 홈</h1>

        {focusMission ? (
          <section
            className={`team-focus accent-${MISSION_TYPE_INFO[focusMission.type].accent}`}
            aria-labelledby="team-focus-title"
          >
            <AssetImage
              asset={missionImageKeys[focusMission.type]}
              decorative
              className="team-focus__image"
              loading="eager"
            />
            <div className="team-focus__body">
              <p className="team-focus__kicker">
                <Icon name={focus.kind === 'next' ? 'directions_walk' : 'flag'} />
                {focus.kind === 'done'
                  ? FOCUS_LABELS.done
                  : `${focus.roundNo}라운드 · ${FOCUS_LABELS[focus.kind]}`}
              </p>
              <h2 id="team-focus-title" className="team-focus__title">
                {focusMission.title}
              </h2>
              <p className="team-focus__room">
                {focus.kind === 'done' ? (
                  <>
                    <Icon name="check_circle" size="lg" />
                    <strong>미션 투어 완료</strong>
                    <span>우리 교실로 돌아가 최종 미션을 준비해요</span>
                  </>
                ) : (
                  <>
                    <Icon name="meeting_room" size="lg" />
                    <strong>{focusMission.room}</strong>
                    <span>{focus.kind === 'now' ? '에서 미션 중' : '으로 이동'}</span>
                  </>
                )}
              </p>
              {arrival && focus.kind !== 'done' ? <ArrivalNotice state={arrival} /> : null}
              <div className="team-focus__actions">
                {isMyGrade ? (
                  <Timer
                    status={event.status}
                    endsAt={event.roundEndsAt}
                    pausedRemainingMs={event.pausedRemainingMs}
                    size="lg"
                  />
                ) : null}
                {focus.kind === 'done' ? (
                  <ButtonLink to={paths.cards(eventId, team.id)} size="xl" icon="style">
                    우리 반 카드 보기
                  </ButtonLink>
                ) : (
                  <ButtonLink
                    to={paths.mission(eventId, team.id, focusMission.id)}
                    size="xl"
                    icon="play_arrow"
                  >
                    미션 시작
                  </ButtonLink>
                )}
              </div>
            </div>
          </section>
        ) : null}

        <div className="team-home__side">
          <section className="panel team-progress" aria-labelledby="team-progress-title">
            <h2 id="team-progress-title" className="section-title">
              <Icon name="format_list_numbered" />
              미션 진행 <span className="team-progress__count number">{doneCount}/5</span>
            </h2>
            <ol className="team-progress__list">
              {schedule.map(({ roundNo, mission, done }) => {
                if (!mission) return null;
                const status = getRowStatus({ done, roundNo, focus, event, isMyGrade });
                return (
                  <li key={roundNo}>
                    <Link
                      to={paths.mission(eventId, team.id, mission.id)}
                      className={`team-progress__item accent-${MISSION_TYPE_INFO[mission.type].accent}${
                        focus.kind === 'now' && focus.roundNo === roundNo
                          ? ' team-progress__item--now'
                          : ''
                      }`}
                    >
                      <span className="team-progress__round number">{roundNo}</span>
                      <Icon
                        name={MISSION_TYPE_INFO[mission.type].icon}
                        className="team-progress__icon"
                      />
                      <span className="team-progress__name">{mission.title}</span>
                      <StatusBadge tone={status.tone} icon={status.icon}>
                        {status.label}
                      </StatusBadge>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="panel team-cards" aria-labelledby="team-cards-title">
            <h2 id="team-cards-title" className="visually-hidden">
              카드
            </h2>
            {pendingRewards > 0 ? (
              <>
                <p className="team-cards__notice">
                  <Icon name="playing_cards" />
                  <span>
                    고를 카드 보상 <strong className="number">{pendingRewards}개</strong>가
                    기다려요!
                  </span>
                </p>
                <ButtonLink
                  to={paths.reward(eventId, team.id)}
                  size="lg"
                  icon="playing_cards"
                  fullWidth
                >
                  카드 보상 고르기
                </ButtonLink>
              </>
            ) : (
              <p className="muted">미션 순위가 확정되면 카드 조각을 하나씩 받아요.</p>
            )}
            <p className="team-cards__summary">
              {rewards.classInfo.displayName} 카드 완성{' '}
              <strong className="number">{rewards.progress.completedCount}/5</strong>
            </p>
            <ButtonLink
              to={paths.cards(eventId, team.id)}
              variant="secondary"
              size="lg"
              icon="style"
              fullWidth
            >
              우리 반 카드 보기
            </ButtonLink>
            <p className="muted">
              완성한 카드 종류 수만큼 최종 미션 힌트를 받아요. 최종 미션은 교실 전자칠판에서 반
              전체가 함께 풀어요.
            </p>
          </section>
        </div>
      </main>
    </>
  );
}

/** 미션 교실 QR 체크인 상태. 색뿐 아니라 아이콘과 문구로 알린다. */
function ArrivalNotice({ state }: { state: TeamMissionState }) {
  if (state.alertCodes.includes('wrong_station')) {
    return (
      <p className="team-focus__arrival team-focus__arrival--warning" role="status">
        <Icon name="warning" /> 다른 교실 QR을 찍었어요. 위 교실로 가서 다시 찍어 주세요.
      </p>
    );
  }
  if (state.checkedInAt !== null) {
    return (
      <p className="team-focus__arrival team-focus__arrival--done" role="status">
        <Icon name="check_circle" /> 도착 기록 완료
      </p>
    );
  }
  return (
    <p className="team-focus__arrival" role="status">
      <Icon name="qr_code_scanner" /> 교실에 도착하면 교실 QR을 찍어 도착을 알려요.
    </p>
  );
}

function getRowStatus(input: {
  done: boolean;
  roundNo: RoundNo;
  focus: { roundNo: RoundNo; kind: FocusKind };
  event: FestivalEvent;
  isMyGrade: boolean;
}): { tone: StatusTone; icon: IconName; label: string } {
  if (input.done) return { tone: 'success', icon: 'check_circle', label: '완료' };
  if (input.focus.kind === 'now' && input.focus.roundNo === input.roundNo) {
    return { tone: 'primary', icon: 'play_arrow', label: '지금' };
  }
  if (input.isMyGrade && input.roundNo < input.event.activeRound) {
    return { tone: 'warning', icon: 'warning', label: '미제출' };
  }
  return { tone: 'neutral', icon: 'schedule', label: '예정' };
}
