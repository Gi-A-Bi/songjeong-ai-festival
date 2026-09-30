import { useCallback, useEffect, useState } from 'react';
import { useSettings } from '../../app/SettingsContext';
import { Button } from '../../components/Button';
import { Confetti } from '../../components/Confetti';
import { Icon } from '../../components/Icon';
import { ErrorView, LoadingView } from '../../components/StateViews';
import type { FinalBoardRow } from '../../data/EventRepository';
import { useRepository } from '../../data/RepositoryContext';
import type { Grade } from '../../domain/types';
import { useAsyncData } from '../../hooks/useAsyncData';
import { formatClock } from '../../lib/time';
import './Final.css';

interface FinalCelebrationProps {
  eventId: string;
  grade: Grade;
  /** 강조할 우리 반. 총괄 현황 화면에서는 null */
  highlightClassId: string | null;
  onClose: () => void;
}

type Phase = 'drumroll' | 'winner' | 'ranking';

const DRUMROLL_MS = 2400;
const DRUM_TICK_MS = 600;

/** 순위가 없는 반(시작하지 못한 반 등)은 맨 뒤로 */
function rankOf(row: FinalBoardRow): number {
  return row.state.finalRank ?? Number.POSITIVE_INFINITY;
}

/**
 * 최종 미션 결과 발표. 전자칠판에서 “결과 확인”을 누르면
 * 두구두구 → 1위 학급 발표(색종이·팡파르) → 전체 순위(우리 반 강조) 순서로 보여 준다.
 */
export function FinalCelebration({
  eventId,
  grade,
  highlightClassId,
  onClose,
}: FinalCelebrationProps) {
  const repository = useRepository();
  const { playEffect } = useSettings();
  const load = useCallback(
    () => repository.getFinalBoard(eventId, grade),
    [repository, eventId, grade],
  );
  const board = useAsyncData(load);
  const [phase, setPhase] = useState<Phase>('drumroll');

  const rows =
    board.status === 'success' ? [...board.data.rows].sort((a, b) => rankOf(a) - rankOf(b)) : [];
  const ready = board.status === 'success' && rows.some((row) => row.state.finalRank !== null);
  const winners = rows.filter((row) => row.state.finalRank === 1);
  const mine = rows.find((row) => row.classInfo.id === highlightClassId) ?? null;
  const questionCount = board.status === 'success' ? board.data.session.questionCount : 0;

  // 두구두구: 짧은 소리를 몇 번 낸 뒤 1위를 발표한다.
  useEffect(() => {
    if (!ready || phase !== 'drumroll') return undefined;
    const ticks = window.setInterval(() => playEffect('count'), DRUM_TICK_MS);
    const reveal = window.setTimeout(() => {
      window.clearInterval(ticks);
      setPhase('winner');
    }, DRUMROLL_MS);
    return () => {
      window.clearInterval(ticks);
      window.clearTimeout(reveal);
    };
  }, [ready, phase, playEffect]);

  useEffect(() => {
    if (phase === 'winner') playEffect('fanfare');
    if (phase === 'ranking') playEffect('card');
  }, [phase, playEffect]);

  // Esc로 닫는다.
  useEffect(() => {
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mineIsWinner = mine !== null && mine.state.finalRank === 1;

  return (
    <div
      className={`final-celebration final-celebration--${phase}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="final-celebration-title"
    >
      <span
        className="final-celebration__light final-celebration__light--left"
        aria-hidden="true"
      />
      <span
        className="final-celebration__light final-celebration__light--right"
        aria-hidden="true"
      />
      {phase === 'winner' ? <Confetti count={60} /> : null}

      <Button
        variant="ghost"
        icon="close"
        className="final-celebration__close"
        onClick={onClose}
        aria-label="결과 발표 닫기"
      >
        닫기
      </Button>

      {board.status === 'loading' ? <LoadingView label="결과를 불러오고 있어요" /> : null}
      {board.status === 'error' ? <ErrorView error={board.error} onRetry={board.reload} /> : null}
      {board.status === 'success' && !ready ? (
        <div className="final-celebration__stage">
          <h2 id="final-celebration-title" className="final-celebration__title">
            아직 결과가 공개되지 않았어요
          </h2>
          <p className="final-celebration__lead">총괄 선생님이 결과를 공개하면 발표할 수 있어요.</p>
        </div>
      ) : null}

      {ready && phase === 'drumroll' ? (
        <div className="final-celebration__stage">
          <p className="final-celebration__kicker">{grade}학년 최종 미션</p>
          <h2 id="final-celebration-title" className="final-celebration__title">
            결과 발표
          </h2>
          <p className="final-celebration__drum" aria-hidden="true">
            두구두구두구
          </p>
          <p className="final-celebration__lead">1위 학급은?</p>
        </div>
      ) : null}

      {ready && phase === 'winner' ? (
        <div className="final-celebration__stage">
          <p className="final-celebration__kicker">{grade}학년 최종 미션 1위</p>
          <span className="final-celebration__trophy" aria-hidden="true">
            <Icon name="trophy" size="xl" />
          </span>
          <h2 id="final-celebration-title" className="final-celebration__winner">
            {winners.map((row) => row.classInfo.displayName).join(' · ')}
          </h2>
          <p className="final-celebration__lead">
            {winners.length > 1 ? '공동 1위! ' : ''}
            정답 <strong className="number">{winners[0]?.state.correctCount ?? 0}</strong> /{' '}
            {questionCount}
            {winners[0]?.state.durationMs != null ? (
              <>
                {' '}
                ·{' '}
                <strong className="number">
                  {formatClock(Math.round(winners[0].state.durationMs / 1000))}
                </strong>
              </>
            ) : null}
          </p>
          {mine ? (
            <p
              className={`final-celebration__mine${mineIsWinner ? ' final-celebration__mine--win' : ''}`}
            >
              {mineIsWinner
                ? '우리 반이 1위예요! 🎉'
                : `우리 반은 ${mine.state.finalRank ?? '-'}위예요`}
            </p>
          ) : null}
          <Button size="xl" variant="gold" icon="leaderboard" onClick={() => setPhase('ranking')}>
            전체 순위 보기
          </Button>
        </div>
      ) : null}

      {ready && phase === 'ranking' ? (
        <div className="final-celebration__stage final-celebration__stage--ranking">
          <h2 id="final-celebration-title" className="final-celebration__title">
            {grade}학년 최종 순위
          </h2>
          {mine ? (
            <p
              className={`final-celebration__mine${mineIsWinner ? ' final-celebration__mine--win' : ''}`}
            >
              {mineIsWinner
                ? '우리 반이 1위예요! 🎉'
                : `우리 반은 ${mine.state.finalRank ?? '-'}위!`}
            </p>
          ) : null}
          <ol className="final-ranking" aria-label={`${grade}학년 순위`}>
            {rows.map((row, index) => {
              const rank = row.state.finalRank;
              const isMine = row.classInfo.id === highlightClassId;
              const classes = ['final-ranking__row'];
              if (rank !== null && rank <= 3) classes.push(`final-ranking__row--top${rank}`);
              if (isMine) classes.push('final-ranking__row--mine');
              return (
                <li
                  key={row.classInfo.id}
                  className={classes.join(' ')}
                  style={{ animationDelay: `${index * 140}ms` }}
                  aria-current={isMine ? 'true' : undefined}
                >
                  <span className="final-ranking__rank number">
                    {rank !== null && rank <= 3 ? <Icon name="military_tech" /> : null}
                    {rank === null ? '-' : `${rank}위`}
                  </span>
                  <span className="final-ranking__name">
                    {row.classInfo.displayName}
                    {isMine ? <span className="final-ranking__tag">우리 반</span> : null}
                    {row.state.allFiveCardsCompletedSnapshot ? (
                      <span className="final-ranking__tag final-ranking__tag--cards">5종 완성</span>
                    ) : null}
                  </span>
                  <span className="final-ranking__score number">
                    정답 {row.state.correctCount ?? 0} / {questionCount}
                  </span>
                  <span className="final-ranking__time number">
                    {row.state.durationMs != null
                      ? formatClock(Math.round(row.state.durationMs / 1000))
                      : '-'}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="cluster">
            <Button variant="secondary" size="lg" icon="trophy" onClick={() => setPhase('winner')}>
              1위 다시 보기
            </Button>
            <Button size="lg" icon="check" onClick={onClose}>
              발표 끝
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
