import { CARD_PIECES } from '../../domain/cards';
import type { CardProgress } from '../../domain/types';

/** “2/4” */
export function formatPieces(progress: Pick<CardProgress, 'pieces'>): string {
  return `${progress.pieces}/${CARD_PIECES}`;
}

/** 이 종류를 한 번 더 받으면 어떻게 되는지 알려 주는 짧은 문구 */
export function describeNextPiece(progress: CardProgress): string {
  if (progress.complete) return `이미 완성 · 중복 +${progress.duplicates + 1}`;
  if (progress.pieces === CARD_PIECES - 1) return '고르면 완성!';
  return `${formatPieces(progress)} → ${progress.pieces + 1}/${CARD_PIECES}`;
}
