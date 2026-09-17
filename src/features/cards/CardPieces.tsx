import { cardImageKeys } from '../../assets/manifest';
import { AssetImage } from '../../components/AssetImage';
import { Icon } from '../../components/Icon';
import { CARD_PIECES, PIECE_POSITIONS } from '../../domain/cards';
import { CARD_INFO } from '../../domain/catalog';
import type { CardPieceCount, CardType } from '../../domain/types';
import './CardPieces.css';

interface CardPiecesProps {
  cardType: CardType;
  pieces: CardPieceCount;
  /** 방금 열린 조각 번호(1~4). 그 조각만 공개 효과를 보여 준다. */
  revealing?: number | null;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * 카드 원본 이미지 한 장을 네 영역 오버레이로 덮고, 조각 수만큼 순서대로 걷어 낸다.
 * 순서: 왼쪽 위 → 오른쪽 위 → 왼쪽 아래 → 오른쪽 아래. 완성은 테두리·체크 아이콘으로도 표시한다.
 */
export function CardPieces({ cardType, pieces, revealing = null, size = 'md' }: CardPiecesProps) {
  const complete = pieces === CARD_PIECES;
  const name = CARD_INFO[cardType].name;
  return (
    <div
      className={`card-pieces card-pieces--${size}${complete ? ' card-pieces--complete' : ''}`}
      role="img"
      aria-label={`${name} 조각 ${pieces}/${CARD_PIECES}${complete ? ', 완성' : ''}`}
    >
      <AssetImage asset={cardImageKeys[cardType]} decorative className="card-pieces__image" />
      <span className="card-pieces__grid" aria-hidden="true">
        {PIECE_POSITIONS.map((position, index) => {
          const pieceNo = index + 1;
          const open = pieceNo <= pieces;
          const classes = ['card-pieces__cell'];
          if (open) classes.push('card-pieces__cell--open');
          if (open && revealing === pieceNo) classes.push('card-pieces__cell--revealing');
          return (
            <span key={position} className={classes.join(' ')}>
              {open ? null : <span className="card-pieces__number number">{pieceNo}</span>}
            </span>
          );
        })}
      </span>
      {complete ? (
        <span className="card-pieces__check" aria-hidden="true">
          <Icon name="check_circle" size={size === 'sm' ? 'sm' : 'md'} />
        </span>
      ) : null}
    </div>
  );
}
