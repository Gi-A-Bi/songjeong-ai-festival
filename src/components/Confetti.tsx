import type { CSSProperties } from 'react';
import './Confetti.css';

const COLOR_COUNT = 6;

interface Piece {
  color: number;
  /** 가로 위치(%) */
  left: number;
  /** 떨어지기 시작할 때까지 기다리는 시간(ms) */
  delay: number;
  /** 떨어지는 데 걸리는 시간(ms) */
  fall: number;
  /** 옆으로 흔들리는 거리(px) */
  drift: number;
  /** 도는 각도(deg) */
  spin: number;
  width: number;
  height: number;
}

/** 찍을 때마다 같은 모양이 나오도록 난수 대신 정해진 수열로 색종이를 만든다. */
function makePieces(count: number): Piece[] {
  let seed = 7;
  const next = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  return Array.from({ length: count }, (_, index) => ({
    color: (index % COLOR_COUNT) + 1,
    left: Math.round(next() * 100),
    delay: Math.round(next() * 900),
    fall: 2200 + Math.round(next() * 1600),
    drift: Math.round((next() - 0.5) * 160),
    spin: 360 + Math.round(next() * 720),
    width: 8 + Math.round(next() * 8),
    height: 12 + Math.round(next() * 12),
  }));
}

const PIECES = makePieces(36);

/**
 * 카드 조각 획득·최종 미션 제출처럼 기쁜 순간에 색종이를 뿌린다.
 * 장식이라 낭독기에는 읽히지 않고, 움직임 줄이기 설정에서는 보이지 않는다.
 */
export function Confetti({ count = PIECES.length }: { count?: number }) {
  return (
    <div className="confetti" aria-hidden="true">
      {PIECES.slice(0, count).map((piece, index) => (
        <i
          key={index}
          className={`confetti__piece confetti__piece--${piece.color}`}
          style={
            {
              '--confetti-left': `${piece.left}%`,
              '--confetti-delay': `${piece.delay}ms`,
              '--confetti-fall': `${piece.fall}ms`,
              '--confetti-drift': `${piece.drift}px`,
              '--confetti-spin': `${piece.spin}deg`,
              '--confetti-width': `${piece.width}px`,
              '--confetti-height': `${piece.height}px`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
