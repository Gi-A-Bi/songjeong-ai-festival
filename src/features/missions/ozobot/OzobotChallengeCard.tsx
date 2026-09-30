import {
  formatOzobotCell,
  OZOBOT_COLS,
  OZOBOT_POINTS,
  OZOBOT_ROWS,
  OZOBOT_TILE_LABELS,
  OZOBOT_TILE_ORDER,
  ozobotStars,
  type OzobotChallenge,
  type OzobotTileKind,
} from '../../../domain/ozobot';
import './Ozobot.css';

interface OzobotChallengeCardProps {
  challenge: OzobotChallenge;
  /** 작게 보여 줄 때(교사 목록) */
  compact?: boolean;
  /** 학생 화면처럼 크게, 길 조각을 보드판 옆에 둘 때 */
  wide?: boolean;
}

/**
 * 도전 과제 카드. 실물 카드처럼 6×6 보드판(A~F, 1~6)에 출발·도착 칸을 표시하고,
 * 아래에 쓸 수 있는 길 조각과 개수를 보여 준다. 별 수에 따라 카드 색이 다르다.
 */
export function OzobotChallengeCard({
  challenge,
  compact = false,
  wide = false,
}: OzobotChallengeCardProps) {
  const { start, goal } = challenge;
  const label = `도전 과제 ${challenge.cardNo}, 별 ${challenge.level}개, 출발 ${formatOzobotCell(start)}, 도착 ${formatOzobotCell(goal)}`;
  return (
    <figure
      className={`ozobot-card ozobot-card--level${challenge.level}${compact ? ' ozobot-card--compact' : ''}${wide ? ' ozobot-card--wide' : ''}`}
      aria-label={label}
    >
      <figcaption className="ozobot-card__head">
        <span className="ozobot-card__title">
          도전 과제 <strong className="number">{challenge.cardNo}</strong>
        </span>
        <span className="ozobot-card__stars" aria-hidden="true">
          {[1, 2, 3].map((index) => (
            <span
              key={index}
              className={`ozobot-card__star${index <= challenge.level ? ' ozobot-card__star--on' : ''}`}
            >
              ★
            </span>
          ))}
        </span>
        <span className="ozobot-card__points">
          {ozobotStars(challenge.level)} {OZOBOT_POINTS[challenge.level]}점
        </span>
      </figcaption>

      <div
        className="ozobot-card__board"
        role="img"
        aria-label={`출발 ${formatOzobotCell(start)}, 도착 ${formatOzobotCell(goal)}`}
      >
        {OZOBOT_ROWS.map((row) => (
          <div key={row} className="ozobot-card__row">
            <span className="ozobot-card__axis" aria-hidden="true">
              {row}
            </span>
            {OZOBOT_COLS.map((col) => {
              const isStart = start.row === row && start.col === col;
              const isGoal = goal.row === row && goal.col === col;
              return (
                <span
                  key={col}
                  className={`ozobot-card__cell${isStart ? ' ozobot-card__cell--start' : ''}${isGoal ? ' ozobot-card__cell--goal' : ''}`}
                >
                  {isStart ? '출발' : isGoal ? '도착' : ''}
                </span>
              );
            })}
          </div>
        ))}
        <div className="ozobot-card__row ozobot-card__row--cols" aria-hidden="true">
          <span className="ozobot-card__axis" />
          {OZOBOT_COLS.map((col) => (
            <span key={col} className="ozobot-card__axis number">
              {col}
            </span>
          ))}
        </div>
      </div>

      <ul className="ozobot-card__tiles" aria-label="쓸 수 있는 길 조각">
        {OZOBOT_TILE_ORDER.filter((kind) => (challenge.tiles[kind] ?? 0) > 0).map((kind) => (
          <li key={kind} className="ozobot-card__tile">
            <OzobotTileIcon kind={kind} />
            <span className="ozobot-card__tile-count number">{challenge.tiles[kind]}</span>
            <span className="visually-hidden">
              {OZOBOT_TILE_LABELS[kind]} {challenge.tiles[kind]}개
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** 길 조각 그림. 색 코드 조각은 색 칸과 이름(좌회전·우회전·직진)을 함께 보여 준다. */
export function OzobotTileIcon({ kind }: { kind: OzobotTileKind }) {
  const line = { stroke: 'currentColor', strokeWidth: 6, strokeLinecap: 'butt' as const };
  const coded = kind === 'left' || kind === 'right' || kind === 'forward';
  return (
    <span className={`ozobot-tile ozobot-tile--${kind}`} aria-hidden="true">
      {coded ? <span className="ozobot-tile__label">{OZOBOT_TILE_LABELS[kind]}</span> : null}
      <svg viewBox="0 0 40 40" className="ozobot-tile__svg">
        {kind === 'straight' || coded ? <line x1="0" y1="20" x2="40" y2="20" {...line} /> : null}
        {kind === 'corner' ? (
          <polyline points="0,20 20,20 20,40" fill="none" {...line} strokeLinejoin="miter" />
        ) : null}
        {kind === 'cross' ? (
          <>
            <line x1="0" y1="20" x2="40" y2="20" {...line} />
            <line x1="20" y1="0" x2="20" y2="40" {...line} />
          </>
        ) : null}
        {coded ? (
          <>
            <rect
              x="10"
              y="16"
              width="6"
              height="8"
              className="ozobot-tile__code ozobot-tile__code--a"
            />
            <rect
              x="17"
              y="16"
              width="6"
              height="8"
              className="ozobot-tile__code ozobot-tile__code--b"
            />
            <rect
              x="24"
              y="16"
              width="6"
              height="8"
              className="ozobot-tile__code ozobot-tile__code--c"
            />
            <line x1="8" y1="31" x2="32" y2="31" stroke="currentColor" strokeWidth="1.5" />
            <polyline
              points="28,28 32,31 28,34"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </>
        ) : null}
      </svg>
    </span>
  );
}
