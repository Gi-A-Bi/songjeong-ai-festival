import { formatBytes } from '../../../domain/drawingFiles';
import {
  getGoldenBellAnswerLabel,
  getGoldenBellKind,
  getGoldenBellQuestions,
  isGoldenBellAnswered,
  isGoldenBellCorrect,
} from '../../../domain/goldenBell';
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
      const found = countErrorHuntFound(config, answer.foundRegionIds);
      const total = config.regions.length;
      return (
        <>
          찾음 {found}/{total} · 오답 {answer.wrongTaps}번 · 남은 {answer.remainingSeconds}초
          {found >= total ? ' · 시간 보너스' : ''}
        </>
      );
    }
    case 'drawing':
      return <>그림 파일 {answer.byteSize > 0 ? formatBytes(answer.byteSize) : '(샘플)'}</>;
    case 'ozobot':
      return <>시작 준비 완료</>;
    case 'library_check':
      return (
        <dl className="answer-list">
          <dt>틀린 부분</dt>
          <dd>{answer.wrongPart}</dd>
          <dt>올바른 내용</dt>
          <dd>{answer.correction}</dd>
          <dt>출처</dt>
          <dd>
            『{answer.bookTitle}』 {answer.page}쪽
          </dd>
        </dl>
      );
  }
}
