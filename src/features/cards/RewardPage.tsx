import { useCallback, useState, type CSSProperties } from 'react';
import { paths } from '../../app/paths';
import { cardImageKeys } from '../../assets/manifest';
import { useSettings } from '../../app/SettingsContext';
import { AppHeader } from '../../components/AppHeader';
import { AssetImage } from '../../components/AssetImage';
import { Button, ButtonLink } from '../../components/Button';
import { Confetti } from '../../components/Confetti';
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
import {
  CARD_PIECES,
  newlyOpenedPiece,
  resolveCardChoice,
  type ResolvedCardChoice,
} from '../../domain/cards';
import { CARD_INFO } from '../../domain/catalog';
import { getHintTotal } from '../../domain/finalMission';
import { SELECTION_MODE_LABELS } from '../../domain/rewards';
import type { CardType, ClassCardProgress } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import { useAsyncData } from '../../hooks/useAsyncData';
import { createRequestId } from '../../lib/random';
import { useTeamContext } from '../tour/teamContext';
import { describeChoice, describeNextPiece, formatPieces } from './cardText';
import { CardPieces } from './CardPieces';
import { ClassProgressStrip } from './ClassProgressStrip';
import './CardPages.css';

/** 순위 보상: 1·2위는 제시된 후보 중 하나를 고르고, 3위는 무작위로 받은 카드를 본다. 4위부터는 보상이 없다. */
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
    <AppHeader homeTo={paths.teamHome(eventId, team.id)} subtitle={team.displayName} />
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
  // 받은 카드. 보상 없음(4위 이하) 기록은 카드가 없어 빼고 본다.
  const claimed = awards.filter((award) => award.status === 'claimed' && award.selectedType);
  const current = earned ? null : (pending[0] ?? null);
  // 이미 완성한 카드를 골랐으면 대신 받을 후보를 미리 정해 팝업에서 알려 준다. 저장소도 같은 규칙으로 다시 정한다.
  const resolved =
    choice && current ? resolveCardChoice(choice, current.offeredTypes, progress) : null;

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
      // 카드를 완성하면 더 크게 축하한다.
      const { before, after } = result.value;
      playEffect(!before.complete && after.complete ? 'fanfare' : 'card');
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
                ? '3위는 카드가 무작위로 정해지고, 4위부터는 카드 보상이 없어요. 받은 카드는 아래 목록에서 확인해요.'
                : '미션 순위가 확정되면 1위는 3종, 2위는 2종 중에서 카드를 고르고, 3위는 무작위로 한 장 받아요. 4위부터는 카드 보상이 없어요.'
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

        <ChoiceDialog
          choice={resolved}
          progress={progress}
          className={classInfo.displayName}
          loading={claim.isPending}
          onCancel={() => setChoice(null)}
          onConfirm={() => void confirmChoice()}
        />
      </main>
    </>
  );
}

/**
 * 고른 카드를 받기 전에 한 번 더 묻는 팝업.
 * 이미 완성한 카드를 골랐으면 대신 받는 카드를 알려 주고, 바꿀 후보가 없으면 중복으로 기록됨을 알린다.
 */
function ChoiceDialog({
  choice,
  progress,
  className,
  loading,
  onCancel,
  onConfirm,
}: {
  choice: ResolvedCardChoice | null;
  progress: ClassCardProgress;
  className: string;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cardType = choice?.cardType ?? null;
  const card = cardType ? progress.cards[cardType] : null;
  const name = cardType ? CARD_INFO[cardType].name : '';
  const substitutedFor = choice?.substitutedFor ?? null;
  const duplicate = !substitutedFor && card?.complete === true;

  let title = `${name}를 받을까요?`;
  if (substitutedFor) title = `${CARD_INFO[substitutedFor].name}는 이미 완성했어요`;
  else if (duplicate) title = `${name}는 이미 완성했어요`;

  return (
    <ConfirmDialog
      open={choice !== null}
      title={choice ? title : ''}
      confirmLabel={substitutedFor ? `${name} 받기` : duplicate ? '중복으로 받기' : '이 카드 받기'}
      confirmIcon={substitutedFor ? 'swap_horiz' : 'check'}
      cancelLabel={substitutedFor || duplicate ? '다시 고르기' : '취소'}
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      {substitutedFor ? (
        <p>
          {CARD_INFO[substitutedFor].name}는 우리 반이 이미 완성해서 조각이 더 열리지 않아요. 대신{' '}
          <strong>{name} 조각</strong>을 받아요.
        </p>
      ) : null}
      {duplicate ? (
        <p>제시된 카드가 모두 완성이라 대신 받을 조각이 없어요. 받으면 중복으로만 기록돼요.</p>
      ) : null}
      {card ? (
        <p>
          받은 뒤에는 바꿀 수 없어요. {className} {name}: <strong>{describeNextPiece(card)}</strong>
        </p>
      ) : null}
    </ConfirmDialog>
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
        어떤 카드를 골라도 조각은 하나예요. 아래에서 우리 반에 부족한 카드를 확인해 보세요. 이미
        완성한 카드를 고르면 다른 후보 카드의 조각으로 바꿔 받아요.
      </p>
      <ClassProgressStrip progress={progress} />
      <ul className={`reward-options reward-options--${count}`}>
        {award.offeredTypes.map((cardType) => {
          const cardProgress = progress.cards[cardType];
          const choice = resolveCardChoice(cardType, award.offeredTypes, progress);
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
                  {choice.substitutedFor ? <Icon name="swap_horiz" size="sm" /> : null}
                  {describeChoice(choice, progress)}
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
  const { before, after, substitutedFor } = outcome;
  const info = CARD_INFO[after.cardType];
  const opened = newlyOpenedPiece(before, after);
  const justCompleted = !before.complete && after.complete;

  let title = `${info.name} 조각 ${formatPieces(after)}가 열렸어요!`;
  if (justCompleted) title = `${info.name} 완성!`;
  else if (opened === null) title = `${info.name} 중복 +${after.duplicates}`;

  return (
    <section
      className={`reward-result${justCompleted ? ' reward-result--complete' : ''}`}
      aria-labelledby="reward-result-title"
    >
      <span className="reward-result__spot" aria-hidden="true" />
      <Confetti />
      <div className="reward-result__art">
        <CardPieces cardType={after.cardType} pieces={after.pieces} revealing={opened} size="xl" />
      </div>
      <div className="stack reward-result__body" role="status">
        <p className="reward-result__kicker">
          <Icon name={after.complete ? 'check_circle' : 'celebration'} /> 카드 조각 획득
        </p>
        <h2 id="reward-result-title" className="reward-result__title">
          {title}
        </h2>
        {substitutedFor ? (
          <p className="reward-result__note">
            <Icon name="swap_horiz" /> {CARD_INFO[substitutedFor].name}는 이미 완성한 카드라{' '}
            {info.name} 조각으로 바꿔 받았어요.
          </p>
        ) : null}
        {opened !== null ? (
          // 조각이 하나 늘어난 만큼 막대가 차오른다. 숫자는 제목과 아래 문구가 알려 준다.
          <p className="reward-meter" aria-hidden="true">
            <span className="number">{formatPieces(before)}</span>
            <span className="reward-meter__track">
              <span
                className="reward-meter__fill"
                style={
                  {
                    '--meter-from': before.pieces / CARD_PIECES,
                    '--meter-to': after.pieces / CARD_PIECES,
                  } as CSSProperties
                }
              />
            </span>
            <span className="reward-meter__after number">{formatPieces(after)}</span>
          </p>
        ) : null}
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
            <Button variant="gold" size="lg" icon="playing_cards" onClick={onNext} data-autofocus>
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
      <AssetImage asset="mascotCardEarned" decorative className="reward-result__mascot" />
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
