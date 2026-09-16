import { useCallback } from 'react';
import { paths } from '../../app/paths';
import { AppHeader } from '../../components/AppHeader';
import { AssetImage } from '../../components/AssetImage';
import { ButtonLink } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { useRepository } from '../../data/RepositoryContext';
import { getMissingCardTypes, isCollectionComplete } from '../../domain/cards';
import { CARD_INFO } from '../../domain/catalog';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useTeamContext } from '../tour/teamContext';
import { CardCountGrid } from './CardCountGrid';
import './CardPages.css';

export function CardBoxPage() {
  const { eventId, team } = useTeamContext();
  const repository = useRepository();
  const load = useCallback(async () => {
    const [summary, tickets] = await Promise.all([
      repository.getTeamCardSummary(eventId, team.id),
      repository.listTeamTickets(eventId, team.id),
    ]);
    return { summary, unclaimed: tickets.filter((ticket) => !ticket.claimed).length };
  }, [repository, eventId, team.id]);
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

  const { summary, unclaimed } = data.data;
  const classComplete = isCollectionComplete(summary.class);
  const missing = getMissingCardTypes(summary.class);

  return (
    <>
      {header}
      <main className="page">
        <div className="card-page__top">
          <h1 className="page__title">
            <Icon name="style" size="lg" /> 카드함
          </h1>
          {unclaimed > 0 ? (
            <ButtonLink to={paths.draw(eventId, team.id)} size="xl" icon="playing_cards">
              카드 뽑기 ({unclaimed}장)
            </ButtonLink>
          ) : null}
        </div>

        {classComplete ? (
          <section className="collection-complete" aria-labelledby="collection-complete-title">
            <AssetImage asset="sceneFinale" decorative className="collection-complete__image" />
            <div className="collection-complete__body">
              <p className="collection-complete__kicker">
                <Icon name="celebration" /> {summary.classDisplayName}
              </p>
              <h2 id="collection-complete-title" className="collection-complete__title">
                AI 능력 컬렉션 완성!
              </h2>
              <ButtonLink
                to={paths.finale(eventId, team.id)}
                variant={unclaimed > 0 ? 'secondary' : 'primary'}
                size="lg"
                icon="trophy"
              >
                축하 화면 보기
              </ButtonLink>
            </div>
          </section>
        ) : null}

        <section className="panel stack" aria-labelledby="team-cards-heading">
          <h2 id="team-cards-heading" className="section-title">
            <Icon name="groups" /> 우리 팀 카드
          </h2>
          <CardCountGrid counts={summary.team} />
        </section>

        <section className="panel stack" aria-labelledby="class-cards-heading">
          <h2 id="class-cards-heading" className="section-title">
            <Icon name="school" /> {summary.classDisplayName} 카드
          </h2>
          {classComplete ? null : (
            <p className="card-page__hint">
              <Icon name="lightbulb" />
              {missing.length}종 더 모으면 완성! 없는 카드:{' '}
              <strong>{missing.map((cardType) => CARD_INFO[cardType].name).join(', ')}</strong>
            </p>
          )}
          <CardCountGrid counts={summary.class} size="sm" />
        </section>
      </main>
    </>
  );
}
