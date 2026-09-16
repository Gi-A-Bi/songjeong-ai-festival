import { useCallback } from 'react';
import { paths } from '../../app/paths';
import { cardImageKeys } from '../../assets/manifest';
import { AppHeader } from '../../components/AppHeader';
import { AssetImage } from '../../components/AssetImage';
import { ButtonLink } from '../../components/Button';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import { useRepository } from '../../data/RepositoryContext';
import { CARD_TYPES, getMissingCardTypes, isCollectionComplete } from '../../domain/cards';
import { CARD_INFO } from '../../domain/catalog';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useTeamContext } from '../tour/teamContext';
import './CardPages.css';

export function FinalePage() {
  const { eventId, team } = useTeamContext();
  const repository = useRepository();
  const load = useCallback(
    () => repository.getTeamCardSummary(eventId, team.id),
    [repository, eventId, team.id],
  );
  const summary = useAsyncData(load);

  return (
    <>
      <AppHeader backTo={paths.cards(eventId, team.id)} subtitle={team.displayName} />
      <main className="page">
        {summary.status === 'loading' ? <LoadingView /> : null}
        {summary.status === 'error' ? (
          <ErrorView error={summary.error} onRetry={summary.reload} />
        ) : null}
        {summary.status === 'success' && !isCollectionComplete(summary.data.class) ? (
          <EmptyView
            mascot="mascotHint"
            title="아직 컬렉션을 완성하지 못했어요"
            description={`없는 카드: ${getMissingCardTypes(summary.data.class)
              .map((cardType) => CARD_INFO[cardType].name)
              .join(', ')} · 카드 교환 시간에 다른 반과 바꿔 보세요.`}
            action={
              <ButtonLink to={paths.cards(eventId, team.id)} size="lg" icon="style">
                카드함으로
              </ButtonLink>
            }
          />
        ) : null}
        {summary.status === 'success' && isCollectionComplete(summary.data.class) ? (
          <section className="finale" aria-labelledby="finale-title">
            <AssetImage asset="sceneFinale" className="finale__scene" loading="eager" />
            <div className="finale__body">
              <p className="finale__class">{summary.data.classDisplayName}</p>
              <h1 id="finale-title" className="finale__title">
                AI 능력 컬렉션 완성!
              </h1>
              <p className="finale__lead">
                생각·관찰·표현·명령·검증, 다섯 가지 힘을 모두 모았어요.
              </p>
              <ul className="finale__cards">
                {CARD_TYPES.map((cardType, index) => (
                  <li key={cardType} style={{ animationDelay: `${index * 120}ms` }}>
                    <AssetImage asset={cardImageKeys[cardType]} className="finale__card" />
                  </li>
                ))}
              </ul>
              <ButtonLink to={paths.teamHome(eventId, team.id)} size="lg" icon="home">
                팀 홈으로
              </ButtonLink>
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
