import { Icon } from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { CARD_PIECES } from '../../domain/cards';
import { CARD_INFO } from '../../domain/catalog';
import type { CardProgress } from '../../domain/types';
import { formatPieces } from './cardText';
import { CardPieces } from './CardPieces';

interface CardProgressTileProps {
  card: CardProgress;
}

/** 카드 이름·이미지·0/4~4/4·완성·중복·최종 미션 힌트 안내를 한 칸에 보여 준다. */
export function CardProgressTile({ card }: CardProgressTileProps) {
  const info = CARD_INFO[card.cardType];
  return (
    <li className={`card-tile${card.complete ? ' card-tile--complete' : ''}`}>
      <CardPieces cardType={card.cardType} pieces={card.pieces} />
      <h3 className="card-tile__name">{info.name}</h3>
      <p className="card-tile__progress">
        <span className="card-tile__pieces number">{formatPieces(card)}</span>
        {card.complete ? (
          <StatusBadge tone="success" icon="check_circle">
            완성
          </StatusBadge>
        ) : (
          <span className="muted">{CARD_PIECES - card.pieces}조각 더</span>
        )}
      </p>
      {card.duplicates > 0 ? (
        <p className="card-tile__duplicates">
          <Icon name="add" size="sm" />
          중복 +{card.duplicates}
        </p>
      ) : null}
      <p className={`card-tile__chance${card.complete ? ' card-tile__chance--ready' : ''}`}>
        <Icon name={card.complete ? 'lightbulb' : 'lock'} size="sm" />
        <span>
          {card.complete ? (
            <strong>최종 미션 힌트 +1</strong>
          ) : (
            <>완성하면 최종 미션 힌트 +1</>
          )}
        </span>
      </p>
    </li>
  );
}
