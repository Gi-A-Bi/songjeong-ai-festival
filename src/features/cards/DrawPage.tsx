import { useCallback, useState } from 'react';
import { paths } from '../../app/paths';
import { useSettings } from '../../app/SettingsContext';
import { cardImageKeys } from '../../assets/manifest';
import { AppHeader } from '../../components/AppHeader';
import { AssetImage } from '../../components/AssetImage';
import { Button, ButtonLink } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { EmptyView, ErrorView, InlineAlert, LoadingView } from '../../components/StateViews';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import { CARD_INFO } from '../../domain/catalog';
import type { CardType } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useTeamContext } from '../tour/teamContext';
import './CardPages.css';

function flipDelayMs(): number {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 800;
}

export function DrawPage() {
  const { eventId, team } = useTeamContext();
  const repository = useRepository();
  const { playEffect } = useSettings();

  const load = useCallback(
    () => repository.listTeamTickets(eventId, team.id),
    [repository, eventId, team.id],
  );
  const tickets = useAsyncData(load);
  const claimTicket = useCallback(
    (ticketId: string) => repository.claimTicket(eventId, team.id, ticketId),
    [repository, eventId, team.id],
  );
  const claim = useAction(claimTicket);

  /** 이번 화면에서 뒤집은 카드. 저장소에서는 이미 사용 처리되어 다시 뽑을 수 없다. */
  const [revealed, setRevealed] = useState<Record<string, CardType>>({});
  const [earned, setEarned] = useState<CardType | null>(null);

  const header = <AppHeader backTo={paths.cards(eventId, team.id)} subtitle={team.displayName} />;

  if (tickets.status !== 'success') {
    return (
      <>
        {header}
        <main className="page">
          {tickets.status === 'loading' ? (
            <LoadingView label="뽑기권을 확인하고 있어요" />
          ) : (
            <ErrorView error={tickets.error} onRetry={tickets.reload} />
          )}
        </main>
      </>
    );
  }

  const visible = tickets.data.filter((ticket) => !ticket.claimed || revealed[ticket.id]);
  const remaining = visible.filter((ticket) => !revealed[ticket.id]).length;

  const flip = async (ticketId: string) => {
    if (revealed[ticketId]) return;
    const result = await claim.run(ticketId);
    if (!result) return;
    if (result.ok) {
      setRevealed((previous) => ({ ...previous, [ticketId]: result.value }));
      playEffect('card');
      window.setTimeout(() => setEarned(result.value), flipDelayMs());
    } else {
      playEffect('error');
    }
  };

  return (
    <>
      {header}
      <main className="page draw-page">
        <section className="draw-stage" aria-labelledby="draw-title">
          <AssetImage
            asset="sceneCardDraw"
            decorative
            className="draw-stage__scene"
            loading="eager"
          />
          <div className="draw-stage__text">
            <h1 id="draw-title" className="draw-stage__title">
              카드 뽑기
            </h1>
            <p className="draw-stage__count" aria-live="polite">
              남은 뽑기권 <strong className="number">{remaining}장</strong>
            </p>
          </div>
        </section>

        {claim.status === 'error' ? (
          <InlineAlert
            tone="danger"
            action={
              <Button variant="secondary" icon="refresh" onClick={tickets.reload}>
                다시 불러오기
              </Button>
            }
          >
            {toUserMessage(claim.error)}
          </InlineAlert>
        ) : null}

        {visible.length === 0 ? (
          <EmptyView
            mascot="mascotHint"
            title="지금은 뽑기권이 없어요"
            description="미션 순위가 확정되면 1위 3장, 2위 2장, 그 밖의 팀은 1장을 받아요."
            action={
              <ButtonLink to={paths.cards(eventId, team.id)} size="lg" icon="style">
                카드함 보기
              </ButtonLink>
            }
          />
        ) : (
          <>
            <p className="draw-page__guide">카드를 눌러 뒤집어 보세요!</p>
            <ul className="draw-grid">
              {visible.map((ticket, index) => {
                const cardType = revealed[ticket.id];
                return (
                  <li key={ticket.id} className="draw-grid__item">
                    <button
                      type="button"
                      className={`flip-card${cardType ? ' flip-card--revealed' : ''}`}
                      onClick={() => void flip(ticket.id)}
                      disabled={Boolean(cardType) || claim.isPending}
                      aria-label={
                        cardType
                          ? `${CARD_INFO[cardType].name}을 얻었어요`
                          : `뽑기권 ${index + 1} 뒤집기`
                      }
                    >
                      <span className="flip-card__inner">
                        <span className="flip-card__face flip-card__face--back">
                          <AssetImage asset="cardBack" decorative loading="eager" />
                        </span>
                        <span className="flip-card__face flip-card__face--front">
                          {cardType ? (
                            <AssetImage asset={cardImageKeys[cardType]} decorative />
                          ) : null}
                        </span>
                      </span>
                    </button>
                    <p className="draw-grid__caption">
                      {cardType ? <strong>{CARD_INFO[cardType].name}</strong> : ticket.sourceLabel}
                    </p>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <Dialog
          open={earned !== null}
          title="카드 획득!"
          onClose={() => setEarned(null)}
          footer={
            remaining > 0 ? (
              <>
                <ButtonLink
                  to={paths.cards(eventId, team.id)}
                  variant="secondary"
                  size="lg"
                  icon="style"
                >
                  카드함 보기
                </ButtonLink>
                <Button
                  size="lg"
                  icon="playing_cards"
                  onClick={() => setEarned(null)}
                  data-autofocus
                >
                  계속 뽑기
                </Button>
              </>
            ) : (
              <ButtonLink to={paths.cards(eventId, team.id)} size="lg" icon="style" data-autofocus>
                카드함 보기
              </ButtonLink>
            )
          }
        >
          {earned ? (
            <div className="earned">
              <AssetImage asset="mascotCardEarned" decorative className="earned__mascot" />
              <AssetImage asset={cardImageKeys[earned]} className="earned__card" loading="eager" />
              <div>
                <p className="earned__name">{CARD_INFO[earned].name}</p>
                <p className="muted">{CARD_INFO[earned].meaning}</p>
              </div>
            </div>
          ) : null}
        </Dialog>
      </main>
    </>
  );
}
