import { cardImageKeys } from '../../assets/manifest';
import { AssetImage } from '../../components/AssetImage';
import { Icon } from '../../components/Icon';
import { CARD_INFO } from '../../domain/catalog';
import { CARD_TYPES } from '../../domain/cards';
import type { CardCounts } from '../../domain/types';
import './CardCountGrid.css';

interface CardCountGridProps {
  counts: CardCounts;
  size?: 'md' | 'sm';
}

/** 5종 카드 보유 수량. 없는 카드는 흐리게 하고 자물쇠와 문구로 표시한다. */
export function CardCountGrid({ counts, size = 'md' }: CardCountGridProps) {
  return (
    <ul className={`card-grid card-grid--${size}`}>
      {CARD_TYPES.map((cardType) => {
        const count = counts[cardType];
        const owned = count > 0;
        return (
          <li
            key={cardType}
            className={`card-grid__item${owned ? '' : ' card-grid__item--missing'}`}
          >
            <div className="card-grid__art">
              <AssetImage asset={cardImageKeys[cardType]} decorative className="card-grid__image" />
              {owned ? null : (
                <span className="card-grid__lock">
                  <Icon name="lock" size="lg" />
                </span>
              )}
            </div>
            <p className="card-grid__name">{CARD_INFO[cardType].name}</p>
            <p className="card-grid__count">
              {owned ? (
                <>
                  <span className="number">{count}</span>장
                </>
              ) : (
                '아직 없어요'
              )}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
