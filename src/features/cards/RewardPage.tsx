import { useCallback, useState } from 'react';
import { paths } from '../../app/paths';
import { cardImageKeys } from '../../assets/manifest';
import { useSettings } from '../../app/SettingsContext';
import { AppHeader } from '../../components/AppHeader';
import { AssetImage } from '../../components/AssetImage';
import { Button, ButtonLink } from '../../components/Button';
import { ConfirmDialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { EmptyView, ErrorView, InlineAlert, LoadingView } from '../../components/StateViews';
import type {
  CardAwardView,
  ClaimCardAwardInput,
  ClaimCardAwardOutcome,
} from '../../data/EventRepository';
import { isRepositoryError, toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import { newlyOpenedPiece } from '../../domain/cards';
import { CARD_INFO } from '../../domain/catalog';
import { getHintTotal } from '../../domain/finalMission';
import { SELECTION_MODE_LABELS } from '../../domain/rewards';
import type { CardType, ClassCardProgress } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import { useAsyncData } from '../../hooks/useAsyncData';
import { createRequestId } from '../../lib/random';
import { useTeamContext } from '../tour/teamContext';
import { describeNextPiece, formatPieces } from './cardText';
import { CardPieces } from './CardPieces';
import { ClassProgressStrip } from './ClassProgressStrip';
import './CardPages.css';

/** 순위 보상: 1·2위는 제시된 후보 중 하나를 고르고, 3위 이하는 자동 배정 결과를 본다. */
export function RewardPage() {
  const { eventId, team } = useTeamContext();
  const repository = useRepository();
  const { playEffect } = useSettings();

  const load = useCallback(
    () => repository.getTeamRewardView(eventId, team.id),
    [repository, eventId, team.id],
  );
  const data = useAsyncData(load);
  const claim = useAction(
    useCallback((input: ClaimCardAwardInput) => repository.claimCardAward(input), [repository]),
  );

  const [choice, setChoice] = useState<CardType | null>(null);
  /** 실패 후 다시 눌러도 같은 요청으로 처리되도록 성공할 때까지 유지한다. */
  const [requestId, setRequestId] = useState(createRequestId);
  const [earned, setEarned] = useState<ClaimCardAwardOutcome | null>(null);

  const header = (
    <AppHeader backTo={paths.teamHome(eventId, team.id)} subtitle={team.displayName} />
  );

  if (data.status !== 'success') {
    return (
      <>
        {header}
        <main className="page">
          {data.status === 'loading' ? (
            <LoadingView label="카드 보상을 확인하고 있어요" />
          ) : (
            <ErrorView error={data.error} onRetry={data.reload} />
          )}
        </main>
      </>
    );
  }

  const { awards, progress, classInfo } = data.data;
  const pending = awards.filter((award) => award.status === 'pending');
  const claimed = awards.filter((award) => award.status === 'claimed');
  const current = earned ? null : (pending[0] ?? null);

  const confirmChoice = async () => {
    if (!current || !choice) return;
    const result = await claim.run({
      eventId,
      teamId: team.id,
      awardId: current.id,
      selectedType: choice,
      requestId,
    });
    setChoice(null);
    if (!result) return;
    if (result.ok) {
      setEarned(result.value);
      setRequestId(createRequestId());
      playEffect('card');
      data.reload();
    } else {
      playEffect('error');
      // 다른 기기에서 먼저 받았다면 최신 상태를 다시 읽는다.
      if (isRepositoryError(result.error, 'already-claimed')) data.reload();
    }
  };

  return (
    <>
      {header}
      <main className="page reward-page">
        <div className="card-page__top">
          <h1 className="page__title">
            <Icon name="playing_cards" size="lg" /> 카드 보상
          </h1>
          <ButtonLink to={paths.cards(eventId, team.id)} variant="secondary" size="lg" icon="style">
            {classInfo.displayName} 카드
          </ButtonLink>
        </div>

        {earned ? (
          <EarnedResult
            outcome={earned}
            hasMore={pending.length > 0}
            onNext={() => {
              setEarned(null);
              claim.reset();
            }}
            cardsPath={paths.cards(eventId, team.id)}
          />
        ) : null}

        {current ? (
          <AwardChoice
            award={current}
            progress={progress}
            disabled={claim.isPending}
            onChoose={(cardType) => {
              claim.reset();
              setChoice(cardType);
            }}
          />
        ) : null}

        {claim.status === 'error' ? (
          <InlineAlert tone="danger">{toUserMessage(claim.error)}</InlineAlert>
        ) : null}

        {!earned && !current ? (
          <EmptyView
            mascot="mascotHint"
            title={
              claimed.length > 0 ? '지금 고를 카드 보상이 없어요' : '아직 받은 카드 보상이 없어요'
            }
            description={
              claimed.length > 0
                ? '3위부터는 카드가 자동으로 정해져요. 받은 카드는 아래 목록에서 확인해요.'
                : '미션 순위가 확정되면 팀마다 카드 조각을 하나씩 받아요. 1위는 3종, 2위는 2종 중에서 고르고, 3위부터는 자동으로 정해져요.'
            }
            action={
              <ButtonLink to={paths.cards(eventId, team.id)} size="lg" icon="style">
                우리 반 카드 보기
              </ButtonLink>
            }
          />
        ) : null}

        {claimed.length > 0 ? (
          <section className="panel stack" aria-labelledby="reward-history-title">
            <h2 id="reward-history-title" className="section-title">
              <Icon name="task_alt" /> 우리 팀이 받은 카드
            </h2>
            <ul className="reward-history">
              {claimed.map((award) => (
                <RewardHistoryItem key={award.id} award={award} />
              ))}
            </ul>
          </section>
        ) : null}

        <ConfirmDialog
          open={choice !== null && current !== null}
          title={choice ? `${CARD_INFO[choice].name}를 받을까요?` : ''}
          confirmLabel="이 카드 받기"
          confirmIcon="check"
          loading={claim.isPending}
          onCancel={() => setChoice(null)}
          onConfirm={() => void confirmChoice()}
        >
          {choice ? (
            <p>
              받은 뒤에는 바꿀 수 없어요. {classInfo.displayName} {CARD_INFO[choice].name}:{' '}
              <strong>{describeNextPiece(progress.cards[choice])}</strong>
            </p>
          ) : null}
        </ConfirmDialog>
      </main>
    </>
  );
}

function AwardChoice({
  award,
  progress,
  disabled,
  onChoose,
}: {
  award: CardAwardView;
  progress: ClassCardProgress;
  disabled: boolean;
  onChoose: (cardType: CardType) => void;
}) {
  const count = award.offeredTypes.length;
  return (
    <section className="panel stack reward-choice" aria-labelledby="reward-choice-title">
      <p className="reward-choice__source">
        <Icon name="trophy" /> {award.sourceLabel}
      </p>
      <h2 id="reward-choice-title" className="reward-choice__title">
        카드 {count}종 중 하나를 골라요
      </h2>
      <p className="muted">
        어떤 카드를 골라도 조각은 하나예요. 아래에서 우리 반에 부족한 카드를 확인해 보세요.
      </p>
      <ClassProgressStrip progress={progress} />
      <ul className={`reward-options reward-options--${count}`}>
        {award.offeredTypes.map((cardType) => {
          const cardProgress = progress.cards[cardType];
          return (
            <li key={cardType}>
              <button
                type="button"
                className="reward-option"
                disabled={disabled}
                onClick={() => onChoose(cardType)}
                aria-label={`${CARD_INFO[cardType].name} 고르기, 지금 ${formatPieces(cardProgress)}`}
              >
                <CardPieces cardType={cardType} pieces={cardProgress.pieces} />
                <span className="reward-option__name">{CARD_INFO[cardType].name}</span>
                <span className="reward-option__next">
                  {cardProgress.pieces === 3 ? <Icon name="stars" size="sm" /> : null}
                  {describeNextPiece(cardProgress)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EarnedResult({
  outcome,
  hasMore,
  onNext,
  cardsPath,
}: {
  outcome: ClaimCardAwardOutcome;
  hasMore: boolean;
  onNext: () => void;
  cardsPath: string;
}) {
  const { before, after } = outcome;
  const info = CARD_INFO[after.cardType];
  const opened = newlyOpenedPiece(before, after);
  const justCompleted = !before.complete && after.complete;

  let title = `${info.name} 조각 ${formatPieces(after)}가 열렸어요!`;
  if (justCompleted) title = `${info.name} 완성!`;
  else if (opened === null) title = `${info.name} 중복 +${after.duplicates}`;

  return (
    <section className="panel reward-result" aria-labelledby="reward-result-title">
      <div className="reward-result__art">
        <CardPieces cardType={after.cardType} pieces={after.pieces} revealing={opened} size="lg" />
      </div>
      <div className="stack reward-result__body" role="status">
        <p className="reward-result__kicker">
          <Icon name={after.complete ? 'check_circle' : 'celebration'} /> 카드 조각 획득
        </p>
        <h2 id="reward-result-title" className="reward-result__title">
          {title}
        </h2>
        <p>
          {justCompleted
            ? `최종 미션 힌트가 1개 늘었어요! 지금 우리 반 힌트는 ${getHintTotal(outcome.progress)}개예요.`
            : opened === null
              ? '이미 완성된 카드라 중복으로 기록했어요.'
              : `${4 - after.pieces}조각 더 모으면 완성이에요.`}
        </p>
        {justCompleted && outcome.progress.allComplete ? (
          <p className="reward-result__master">
            <Icon name="check_circle" /> 5종 카드를 모두 완성했어요! 최종 미션에서 정답 수가 같으면
            우리 반이 앞서요.
          </p>
        ) : null}
        <div className="cluster">
          {hasMore ? (
            <Button size="lg" icon="playing_cards" onClick={onNext} data-autofocus>
              다음 보상 고르기
            </Button>
          ) : null}
          <ButtonLink
            to={cardsPath}
            size="lg"
            variant={hasMore ? 'secondary' : 'primary'}
            icon="style"
          >
            우리 반 카드 보기
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}

function RewardHistoryItem({ award }: { award: CardAwardView }) {
  if (!award.selectedType) return null;
  return (
    <li className="reward-history__item">
      <AssetImage
        asset={cardImageKeys[award.selectedType]}
        decorative
        className="reward-history__thumb"
      />
      <div>
        <p className="reward-history__name">{CARD_INFO[award.selectedType].name}</p>
        <p className="muted">
          {award.sourceLabel} · {SELECTION_MODE_LABELS[award.selectionMode]}
        </p>
      </div>
    </li>
  );
}
