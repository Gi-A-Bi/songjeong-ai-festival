import { useCallback } from 'react';
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
import type { FestivalEvent, RoundNo, Team } from '../../domain/types';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useTeamContext } from './teamContext';
import './TeamHomePage.css';

type FocusKind = 'now' | 'next' | 'first' | 'done';

/** 팀 홈에서 가장 크게 보여 줄 미션 라운드를 고른다. */
function getFocus(event: FestivalEvent, team: Team): { roundNo: RoundNo; kind: FocusKind } {
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
    const [missions, submissions, tickets] = await Promise.all([
      repository.listMissions(eventId),
      repository.listTeamSubmissions(eventId, team.id),
      repository.listTeamTickets(eventId, team.id),
    ]);
    return { missions, submissions, tickets };
  }, [repository, eventId, team.id]);
  const data = useAsyncData(load);

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

  const { missions, submissions, tickets } = data.data;
  const focus = getFocus(event, team);
  const isMyGrade = event.activeGrade === team.grade;
  const unclaimed = tickets.filter((ticket) => !ticket.claimed).length;

  const schedule = ROUND_NUMBERS.map((roundNo) => {
    const mission = missions.find((item) => item.no === getMissionNoForRound(team.teamNo, roundNo));
    const submission = mission
      ? submissions.find((item) => item.missionId === mission.id && item.status !== 'draft')
      : undefined;
    return { roundNo, mission, done: submission !== undefined };
  });
  const doneCount = schedule.filter((item) => item.done).length;
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
                <Icon name="meeting_room" size="lg" />
                <strong>{focusMission.room}</strong>
                <span>{focus.kind === 'now' ? '에서 미션 중' : '으로 이동'}</span>
              </p>
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
                    카드함 보기
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
            {unclaimed > 0 ? (
              <p className="team-cards__notice">
                <Icon name="playing_cards" />
                뽑기권 <strong className="number">{unclaimed}장</strong>이 기다려요!
              </p>
            ) : (
              <p className="muted">미션 순위가 확정되면 뽑기권이 생겨요.</p>
            )}
            <ButtonLink
              to={paths.cards(eventId, team.id)}
              variant="secondary"
              size="lg"
              icon="style"
              fullWidth
            >
              내 카드 보기
            </ButtonLink>
          </section>
        </div>
      </main>
    </>
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
