import { CARD_TYPES } from '../../domain/cards';
import { CARD_INFO } from '../../domain/catalog';
import type { ClassCardProgress } from '../../domain/types';
import { formatPieces } from './cardText';
import { CardPieces } from './CardPieces';

interface ClassProgressStripProps {
  progress: ClassCardProgress;
  /** 자리가 좁은 곳(팀 홈의 카드 줄)에서는 “생각 카드”를 “생각”으로 줄여 쓴다. */
  compact?: boolean;
}

/** 보상을 고르기 전에 보는 학급 카드 5종의 작은 진행도 */
export function ClassProgressStrip({ progress, compact = false }: ClassProgressStripProps) {
  return (
    <ul className="progress-strip" aria-label="우리 반 카드 진행도">
      {CARD_TYPES.map((cardType) => {
        const card = progress.cards[cardType];
        return (
          <li key={cardType} className="progress-strip__item">
            <CardPieces cardType={cardType} pieces={card.pieces} size="sm" />
            <span className="progress-strip__name">
              {compact ? CARD_INFO[cardType].name.replace(' 카드', '') : CARD_INFO[cardType].name}
            </span>
            <span className="progress-strip__value number">
              {formatPieces(card)}
              {card.duplicates > 0 ? ` +${card.duplicates}` : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
