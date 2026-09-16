import { useState } from 'react';
import { Link } from 'react-router';
import { paths } from '../../../app/paths';
import { AssetImage } from '../../../components/AssetImage';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/Dialog';
import { Icon } from '../../../components/Icon';
import { MissionShell } from '../../../components/MissionShell';
import { EmptyView } from '../../../components/StateViews';
import { StatusBadge } from '../../../components/StatusBadge';
import { useRepository } from '../../../data/RepositoryContext';
import { canSubmitInPhase } from '../../../domain/missionPhase';
import { countGoldenBellCorrect } from '../../../domain/scoring';
import type { GoldenBellConfig } from '../../../domain/types';
import { MissionNotice } from '../MissionNotice';
import type { MissionScreenProps } from '../missionTypes';
import { useMissionSubmit } from '../useMissionSubmit';
import '../Missions.css';

interface GoldenBellMissionProps extends MissionScreenProps {
  config: GoldenBellConfig;
}

/** 등록된 문제를 팀이 차례로 풀고, 모두 푼 뒤 한 번에 제출한다. */
export function GoldenBellMission({
  eventId,
  view,
  event,
  phase,
  onSubmitted,
  config,
}: GoldenBellMissionProps) {
  const { team, mission, submission, answerRevealed, roundNo } = view;
  const repository = useRepository();
  const { questions } = config;
  const previous = submission?.answer.type === 'golden_bell' ? submission.answer.selections : {};
  const saved = submission && submission.status !== 'draft' ? previous : null;
  // 재제출 허용이면 지난번 답을 채워 두고 고칠 수 있게 한다.
  const [selections, setSelections] = useState<Record<string, number>>(previous);
  const [index, setIndex] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { submit, isPending, error } = useMissionSubmit(eventId, team.id, mission.id, onSubmitted);

  const answers = saved ?? selections;
  const canAnswer = canSubmitInPhase(phase) && saved === null && !isPending;
  const answeredCount = questions.filter((question) => answers[question.id] !== undefined).length;
  const unanswered = questions.length - answeredCount;
  const correctCount = countGoldenBellCorrect(config, {
    type: 'golden_bell',
    selections: answers,
  });

  const notice = <MissionNotice phase={phase} event={event} view={view} error={error} />;

  if (questions.length === 0) {
    return (
      <MissionShell mission={mission} team={team} roundNo={roundNo} event={event} phase={phase}>
        <EmptyView
          title="아직 문제가 없어요"
          description="선생님이 문제를 등록하면 풀 수 있어요."
          mascot="mascotTimer"
        />
      </MissionShell>
    );
  }

  const currentIndex = Math.min(index, questions.length - 1);
  const current = questions[currentIndex];
  const chosen = answers[current.id];
  const isLast = currentIndex === questions.length - 1;

  const handleSubmit = async () => {
    const cleaned = Object.fromEntries(
      questions
        .filter((question) => selections[question.id] !== undefined)
        .map((question) => [question.id, selections[question.id]]),
    );
    await submit({ type: 'golden_bell', selections: cleaned });
    setConfirmOpen(false);
  };

  return (
    <MissionShell
      mission={mission}
      team={team}
      roundNo={roundNo}
      event={event}
      phase={phase}
      notice={notice}
      actions={
        saved !== null ? (
          <>
            <StatusBadge tone="info" icon="lock" size="lg">
              제출한 답은 바꿀 수 없어요
            </StatusBadge>
            {answerRevealed ? (
              <StatusBadge tone="success" icon="trophy" size="lg">
                {questions.length}문제 중 {correctCount}문제 정답 · {correctCount * 100}점
              </StatusBadge>
            ) : null}
          </>
        ) : (
          <>
            <p className="mission-actions__hint">
              <Icon name="info" />
              답한 문제 {answeredCount}/{questions.length} · 제출하면 답을 바꿀 수 없어요
            </p>
            <Button
              size="xl"
              icon="send"
              disabled={!canSubmitInPhase(phase) || answeredCount === 0}
              loading={isPending}
              loadingLabel="제출하는 중"
              onClick={() => setConfirmOpen(true)}
            >
              정답 제출
            </Button>
          </>
        )
      }
    >
      <div className="gb-toolbar">
        <nav className="gb-steps" aria-label="문제 번호">
          {questions.map((question, questionIndex) => {
            const answered = answers[question.id] !== undefined;
            const correct = answers[question.id] === question.answerIndex;
            const className = [
              'gb-step',
              answered ? 'gb-step--answered' : '',
              answerRevealed && answered ? (correct ? 'gb-step--correct' : 'gb-step--wrong') : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <button
                key={question.id}
                type="button"
                className={className}
                aria-current={questionIndex === currentIndex ? 'step' : undefined}
                aria-label={`${questionIndex + 1}번 문제${answered ? ', 답함' : ', 아직 안 풂'}`}
                onClick={() => setIndex(questionIndex)}
              >
                <span className="number">{questionIndex + 1}</span>
                {answered ? <Icon name="check" size="sm" /> : null}
              </button>
            );
          })}
        </nav>
        <div className="gb-pager">
          <Button
            variant="secondary"
            size="lg"
            icon="arrow_back"
            disabled={currentIndex === 0}
            onClick={() => setIndex(currentIndex - 1)}
          >
            이전 문제
          </Button>
          {!isLast ? (
            <Button
              variant={chosen !== undefined ? 'primary' : 'secondary'}
              size="lg"
              iconEnd="arrow_forward"
              onClick={() => setIndex(currentIndex + 1)}
            >
              다음 문제
            </Button>
          ) : null}
        </div>
      </div>

      <section className="gb-question" aria-labelledby="gb-question-text">
        <p className="gb-question__no">
          <Icon name="notifications_active" />
          문제 {currentIndex + 1} / {questions.length}
        </p>
        <h2 id="gb-question-text" className="gb-question__text">
          {current.question}
        </h2>
      </section>

      <div className="gb-choices" role="radiogroup" aria-labelledby="gb-question-text">
        {current.choices.map((text, choiceIndex) => {
          const isChosen = chosen === choiceIndex;
          const isAnswer = answerRevealed && choiceIndex === current.answerIndex;
          const className = [
            'gb-choice',
            isChosen ? 'gb-choice--chosen' : '',
            isAnswer ? 'gb-choice--answer' : '',
            answerRevealed && isChosen && !isAnswer ? 'gb-choice--wrong' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={`${current.id}-${choiceIndex}`}
              type="button"
              role="radio"
              aria-checked={isChosen}
              className={className}
              disabled={!canAnswer}
              onClick={() => setSelections((values) => ({ ...values, [current.id]: choiceIndex }))}
            >
              <span className="gb-choice__no number">{choiceIndex + 1}</span>
              <span className="gb-choice__text">{text}</span>
              {isAnswer ? (
                <StatusBadge tone="success" icon="check_circle">
                  정답
                </StatusBadge>
              ) : null}
              {isChosen && !isAnswer ? (
                <StatusBadge
                  tone={answerRevealed ? 'danger' : 'info'}
                  icon={answerRevealed ? 'close' : 'check'}
                >
                  우리 답
                </StatusBadge>
              ) : null}
            </button>
          );
        })}
      </div>

      {answerRevealed ? (
        <section className="gb-reveal" aria-live="polite">
          <AssetImage
            asset={chosen === current.answerIndex ? 'mascotCorrect' : 'mascotHint'}
            decorative
            className="gb-reveal__mascot"
          />
          <div>
            <p className="gb-reveal__title">
              {chosen === undefined
                ? '정답 공개'
                : chosen === current.answerIndex
                  ? '정답이에요!'
                  : '아쉬워요! 해설을 읽어 봐요'}
            </p>
            <p>{current.explanation}</p>
          </div>
        </section>
      ) : null}

      {repository.mode === 'mock' && saved !== null && !answerRevealed ? (
        <p className="dev-note">
          <Icon name="settings" size="sm" />
          개발용:{' '}
          <Link to={paths.teacherMission(eventId, mission.id)}>교사 화면에서 정답 공개하기</Link>
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title="답을 제출할까요?"
        confirmLabel="제출하기"
        confirmIcon="send"
        loading={isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void handleSubmit()}
      >
        {unanswered > 0 ? (
          <p>
            아직 풀지 않은 문제가 <strong>{unanswered}개</strong> 있어요. 풀지 않은 문제는
            0점이에요.
          </p>
        ) : (
          <p>{questions.length}문제 모두 답했어요.</p>
        )}
        <p className="muted">제출하면 답을 바꿀 수 없어요.</p>
      </ConfirmDialog>
    </MissionShell>
  );
}
