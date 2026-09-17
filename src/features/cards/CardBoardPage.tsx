import { useCallback } from 'react';
import { paths } from '../../app/paths';
import { AppHeader } from '../../components/AppHeader';
import { ButtonLink } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { useRepository } from '../../data/RepositoryContext';
import { CARD_TYPES } from '../../domain/cards';
import { getHintTotal } from '../../domain/finalMission';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useTeamContext } from '../tour/teamContext';
import { CardProgressTile } from './CardProgressTile';
import './CardPages.css';

/** 학급 카드 5종의 네 조각 진행도. 팀 화면에서 같은 학급 현황을 보여 준다. */
export function CardBoardPage() {
  const { eventId, team } = useTeamContext();
  const repository = useRepository();
  const load = useCallback(
    () => repository.getTeamRewardView(eventId, team.id),
    [repository, eventId, team.id],
  );
  const data = useAsyncData(load);

  const header = (
    <AppHeader backTo={paths.teamHome(eventId, team.id)} subtitle={team.displayName} />
  );

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

  const { classInfo, progress, awards } = data.data;
  const pending = awards.filter((award) => award.status === 'pending').length;
  const hintTotal = getHintTotal(progress);

  return (
    <>
      {header}
      <main className="page">
        <div className="card-page__top">
          <h1 className="page__title">
            <Icon name="style" size="lg" /> {classInfo.displayName} 카드
          </h1>
          <p className="card-page__count">
            완성 <strong className="number">{progress.completedCount}</strong> / {CARD_TYPES.length}
          </p>
        </div>

        {pending > 0 ? (
          <section className="panel card-page__pending" aria-label="고를 카드 보상">
            <p className="card-page__hint">
              <Icon name="playing_cards" />
              <span>
                고를 카드 보상 <strong className="number">{pending}개</strong>가 기다려요!
              </span>
            </p>
            <ButtonLink to={paths.reward(eventId, team.id)} size="xl" icon="playing_cards">
              카드 보상 고르기
            </ButtonLink>
          </section>
        ) : null}

        <section className="hint-banner" aria-labelledby="hint-banner-title">
          <span className="hint-banner__count number" aria-hidden="true">
            {hintTotal}
          </span>
          <div className="stack">
            <h2 id="hint-banner-title" className="hint-banner__title">
              <Icon name="lightbulb" /> 최종 미션 힌트 {hintTotal}개
            </h2>
            <p>
              완성한 카드 종류 수만큼 힌트를 받아요. 힌트를 쓰면 문제의 틀린 보기 하나가 사라져요.
              같은 카드를 더 모아도(중복) 힌트는 늘지 않아요.
            </p>
            {progress.allComplete ? (
              <p className="hint-banner__bonus">
                <Icon name="check_circle" /> 5종 모두 완성! 정답 수가 같으면 우리 반이 앞서요.
              </p>
            ) : null}
          </div>
        </section>

        <section className="stack" aria-labelledby="card-board-title">
          <h2 id="card-board-title" className="section-title">
            <Icon name="school" /> 네 조각을 모으면 카드 완성
          </h2>
          <p className="muted">
            같은 카드를 받을 때마다 왼쪽 위 → 오른쪽 위 → 왼쪽 아래 → 오른쪽 아래 순서로 조각이
            열려요. 최종 미션은 교실 전자칠판에서 반 전체가 함께 10문제를 풀어요.
          </p>
          <ul className="card-board">
            {CARD_TYPES.map((cardType) => (
              <CardProgressTile key={cardType} card={progress.cards[cardType]} />
            ))}
          </ul>
        </section>

      </main>
    </>
  );
}
