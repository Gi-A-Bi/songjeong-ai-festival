import { Fragment } from 'react';
import { formatBytes } from '../../../domain/drawingFiles';
import { getErrorHuntRegions } from '../../../domain/errorHunt';
import {
  getGoldenBellAnswerLabel,
  getGoldenBellKind,
  getGoldenBellQuestions,
  isGoldenBellAnswered,
  isGoldenBellCorrect,
} from '../../../domain/goldenBell';
import { Icon } from '../../../components/Icon';
import {
  circledNumber,
  getLibraryItemLabel,
  getLibraryPrompt,
  getScoredLibraryQuestions,
  isLibraryPickOne,
  LIBRARY_CHECK_ITEMS,
  LIBRARY_QUESTION_POINTS,
  scoreLibraryCheck,
} from '../../../domain/libraryCheck';
import {
  calculateOzobotScore,
  findOzobotChallenge,
  getOzobotSolved,
  ozobotStars,
} from '../../../domain/ozobot';
import { countErrorHuntFound, countGoldenBellCorrect } from '../../../domain/scoring';
import type { Mission, Submission } from '../../../domain/types';

/** 교사 순위표의 답안 칸 */
export function AnswerSummary({
  mission,
  submission,
}: {
  mission: Mission;
  submission: Submission | null;
}) {
  if (!submission) return <>-</>;
  if (submission.status === 'draft') return <>재제출을 기다리는 중</>;
  const answer = submission.answer;
  const config = mission.config;
  switch (answer.type) {
    case 'golden_bell': {
      if (config.type !== 'golden_bell') return <>-</>;
      const questions = getGoldenBellQuestions(config, submission.grade);
      const answered = questions.filter((question) =>
        isGoldenBellAnswered(question, answer),
      ).length;
      // 단답형은 글자가 조금 달라 틀린 것일 수 있어, 틀린 답을 그대로 보여 주고 선생님이 판단하게 한다.
      const missed = questions
        .map((question, index) => ({ question, no: index + 1 }))
        .filter(
          ({ question }) =>
            getGoldenBellKind(question) === 'short' &&
            isGoldenBellAnswered(question, answer) &&
            !isGoldenBellCorrect(question, answer),
        );
      return (
        <>
          맞힘 {countGoldenBellCorrect(config, answer, submission.grade)}/{questions.length} · 답한
          문제 {answered}
          {missed.length > 0 ? (
            <dl className="answer-list">
              <dt>틀린 단답형(맞게 볼 답이면 점수를 고쳐 주세요)</dt>
              {missed.map(({ question, no }) => (
                <dd key={question.id}>
                  {no}번 “{answer.texts?.[question.id]}” · 정답 {getGoldenBellAnswerLabel(question)}
                </dd>
              ))}
            </dl>
          ) : null}
        </>
      );
    }
    case 'error_hunt': {
      if (config.type !== 'error_hunt') return <>-</>;
      const found = countErrorHuntFound(config, answer.foundRegionIds, submission.grade);
      const total = getErrorHuntRegions(config, submission.grade).length;
      return (
        <>
          찾음 {found}/{total} · 오답 {answer.wrongTaps}번 · 남은 {answer.remainingSeconds}초
          {found >= total ? ' · 시간 보너스' : ''}
        </>
      );
    }
    case 'drawing':
      return <>그림 파일 {answer.byteSize > 0 ? formatBytes(answer.byteSize) : '(샘플)'}</>;
    case 'ozobot': {
      const solved = getOzobotSolved(answer);
      if (solved.length === 0) return <>성공 기록 없음</>;
      return (
        <>
          성공 {solved.length}개 ·{' '}
          {solved
            .map((item) => {
              const card = findOzobotChallenge(item.challengeId);
              return `카드 ${card?.cardNo ?? item.challengeId} ${ozobotStars(item.level)}`;
            })
            .join(', ')}{' '}
          · {calculateOzobotScore(solved)}점
        </>
      );
    }
    case 'library_check': {
      if (config.type !== 'library_check') return <>-</>;
      // 하나만 고르는 방식이면 고른 문제만 보여 준다.
      const questions = getScoredLibraryQuestions(config, answer, submission.grade);
      const chosen =
        isLibraryPickOne(config, submission.grade) && questions.length === 1 ? questions[0] : null;
      const result = scoreLibraryCheck(config, answer, submission.grade);
      return (
        <>
          {chosen ? (
            <p className="answer-chosen">
              <Icon name="format_quote" /> 고른 질문: {getLibraryPrompt(chosen)}
              {chosen.subject ? ` (${chosen.subject})` : ''}
            </p>
          ) : null}
          {result ? (
            <p className="answer-auto">
              자동 채점 {result.total}/{result.max}점 ·{' '}
              {questions.map((question, index) =>
                LIBRARY_CHECK_ITEMS.map((item) => {
                  const ok = result.questions[question.id].items[item];
                  return (
                    <span
                      key={`${question.id}-${item}`}
                      className={`answer-auto__item${ok ? ' answer-auto__item--ok' : ''}`}
                    >
                      {index + 1}번 {getLibraryItemLabel(question.type, item)} {ok ? 'O' : 'X'}
                      {ok ? ` +${LIBRARY_QUESTION_POINTS[item]}` : ''}
                    </span>
                  );
                }),
              )}
            </p>
          ) : null}
          <dl className="answer-list">
            {questions.map((question, index) => {
              const item = answer.answers[question.id];
              const chosen =
                question.type === 'choose' && typeof item?.choice === 'number' && item.choice >= 0
                  ? `${circledNumber(item.choice)} ${question.sentences[item.choice] ?? ''}`
                  : null;
              return (
                <Fragment key={question.id}>
                  <dt>
                    {index + 1}번 {question.type === 'choose' ? '틀린 문장' : '틀린 부분'}
                  </dt>
                  <dd>{(question.type === 'choose' ? chosen : item?.wrongPart) || '-'}</dd>
                  <dt>{index + 1}번 고친 내용</dt>
                  <dd>{item?.correction || '-'}</dd>
                  <dt>{index + 1}번 참고한 책</dt>
                  <dd>{item?.bookTitle || '-'}</dd>
                </Fragment>
              );
            })}
          </dl>
        </>
      );
    }
  }
}
