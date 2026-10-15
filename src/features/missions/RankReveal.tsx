import { useEffect, useRef } from 'react';
import { paths } from '../../app/paths';
import { useSettings } from '../../app/SettingsContext';
import { AssetImage } from '../../components/AssetImage';
import { ButtonLink } from '../../components/Button';
import { Confetti } from '../../components/Confetti';
import { Icon } from '../../components/Icon';
import type { TeamMissionView } from '../../data/EventRepository';
import { CARD_INFO } from '../../domain/catalog';
import { getSelectionModeForRank, LAST_REWARDED_RANK } from '../../domain/rewards';
import type { CardSelectionMode } from '../../domain/types';

const REWARD_TEXT: Record<CardSelectionMode, string> = {
  choose_three: '1위 보상: 카드 3종 중에서 하나를 골라요.',
  choose_two: '2위 보상: 카드 2종 중에서 하나를 골라요.',
  automatic: '3위 보상: 카드 한 장을 무작위로 받아요.',
  none: '4위부터는 카드 보상이 없어요. 다음 미션에서 3위 안에 들면 카드 조각을 받아요.',
};

interface RankRevealProps {
  eventId: string;
  view: TeamMissionView;
}

/**
 * 선생님이 순위를 확정하면 미션 화면에 우리 팀 등수를 크게 보여 준다.
 * 등수에 따라 카드를 고를 수 있는지 알려 주고, 고를 수 있으면 바로 카드 보상 화면으로 간다.
 */
export function RankReveal({ eventId, view }: RankRevealProps) {
  const { playEffect } = useSettings();
  const { result, award, team, mission } = view;
  const rank = result?.rank ?? null;
  const mode: CardSelectionMode =
    award?.selectionMode ?? (rank === null ? 'none' : getSelectionModeForRank(rank));
  const rewarded = rank !== null && rank <= LAST_REWARDED_RANK && mode !== 'none';
  const claimedType = award?.status === 'claimed' ? award.selectedType : null;

  // 등수가 열리는 순간 한 번만 소리를 낸다. 3위 안이면 팡파르, 아니면 조용히 알린다.
  const announced = useRef<number | null>(null);
  useEffect(() => {
    if (rank === null || announced.current === rank) return;
    announced.current = rank;
    playEffect(rewarded ? 'fanfare' : 'success');
  }, [rank, rewarded, playEffect]);

  if (rank === null) {
    return (
      <div className="mission-notice mission-notice--success" role="status">
        <AssetImage asset="mascotCardEarned" decorative className="mission-notice__mascot" />
        <Icon name="trophy" size="lg" />
        <p className="mission-notice__text">
          순위가 확정됐어요. 카드 보상 화면에서 결과를 확인해요.
        </p>
      </div>
    );
  }

  const canPick = rewarded && !claimedType;
  return (
    <section
      className={`rank-reveal${rewarded ? ' rank-reveal--rewarded' : ''}`}
      role="status"
      aria-labelledby="rank-reveal-title"
    >
      {rewarded ? <Confetti count={40} /> : null}
      <AssetImage
        asset={rewarded ? 'mascotCardEarned' : 'mascotHint'}
        decorative
        className="rank-reveal__mascot"
      />
      <div className="rank-reveal__body">
        <p className="rank-reveal__kicker">
          <Icon name={rewarded ? 'trophy' : 'leaderboard'} /> {mission.title} 순위 확정
        </p>
        <h2 id="rank-reveal-title" className="rank-reveal__title">
          우리 팀 <strong className="rank-reveal__rank number">{rank}위</strong>
          {rewarded ? '!' : ''}
        </h2>
        <p className="rank-reveal__score">
          점수 <span className="number">{result?.score ?? 0}</span>점
        </p>
        <p className="rank-reveal__reward">
          <Icon name={rewarded ? 'playing_cards' : 'info'} size="sm" />
          {claimedType ? `${CARD_INFO[claimedType].name}를 받았어요.` : REWARD_TEXT[mode]}
        </p>
        <div className="cluster">
          {canPick ? (
            <ButtonLink
              to={paths.reward(eventId, team.id)}
              variant="gold"
              size="lg"
              icon="playing_cards"
            >
              {mode === 'automatic' ? '카드 받기' : '카드 고르기'}
            </ButtonLink>
          ) : null}
          <ButtonLink
            to={paths.cards(eventId, team.id)}
            variant={canPick ? 'secondary' : 'primary'}
            size="lg"
            icon="style"
          >
            우리 반 카드 보기
          </ButtonLink>
          <ButtonLink
            to={paths.teamHome(eventId, team.id)}
            variant="secondary"
            size="lg"
            icon="home"
          >
            홈으로
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
