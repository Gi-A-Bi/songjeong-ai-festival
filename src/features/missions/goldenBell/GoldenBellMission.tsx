import { useState } from 'react';
import { Link } from 'react-router';
import { paths } from '../../../app/paths';
import { useSettings } from '../../../app/SettingsContext';
import { AssetImage } from '../../../components/AssetImage';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/Dialog';
import { Icon } from '../../../components/Icon';
import { MissionShell } from '../../../components/MissionShell';
import { EmptyView } from '../../../components/StateViews';
import { StatusBadge } from '../../../components/StatusBadge';
import { useRepository } from '../../../data/RepositoryContext';
import {
  countGoldenBellKinds,
  getGoldenBellAnswerLabel,
  getGoldenBellKind,
  getGoldenBellQuestions,
  GOLDEN_BELL_KIND_LABELS,
  GOLDEN_BELL_LEVEL_LABELS,
  GOLDEN_BELL_SHORT_MAX_LENGTH,
  isGoldenBellAnswered,
  isGoldenBellCorrect,
} from '../../../domain/goldenBell';
import { canSubmitInPhase } from '../../../domain/missionPhase';
import type { GoldenBellConfig, GoldenBellQuestion } from '../../../domain/types';
import { getMissionLock } from '../missionLock';
import { MissionLockedPanel } from '../MissionLockedPanel';
import { MissionNotice } from '../MissionNotice';
import type { MissionScreenProps } from '../missionTypes';
import { useMissionSubmit } from '../useMissionSubmit';
import '../Missions.css';

interface GoldenBellMissionProps extends MissionScreenProps {
  config: GoldenBellConfig;
}

interface Answers {
  selections: Record<string, number>;
  texts: Record<string, string>;
}

/**
 * 그 학년에 등록된 문제(O/X, 객관식, 단답형)를 팀이 차례로 풀고, 모두 푼 뒤 한 번에 제출한다.
 * 게임을 시작하기 전에는 문제를 화면에 올리지 않는다.
 */
export function GoldenBellMission({
  eventId,
  view,
  event,
  phase,
  gate,
  onSubmitted,
  config,
}: GoldenBellMissionProps) {
  const { team, mission, submission, answerRevealed, roundNo } = view;
  const repository = useRepository();
  const { playEffect } = useSettings();
  const questions = getGoldenBellQuestions(config, team.grade);
  const previous: Answers =
    submission?.answer.type === 'golden_bell'
      ? { selections: submission.answer.selections, texts: submission.answer.texts ?? {} }
      : { selections: {}, texts: {} };
  const saved = submission && submission.status !== 'draft' ? previous : null;
  // 재제출 허용이면 지난번 답을 채워 두고 고칠 수 있게 한다.
  const [draft, setDraft] = useState<Answers>(previous);
  const [index, setIndex] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { submit, isPending, error } = useMissionSubmit(eventId, team.id, mission.id, onSubmitted);

  const answers = saved ?? draft;
  const lock = getMissionLock(view, event, phase);
  const canAnswer = canSubmitInPhase(phase) && saved === null && !isPending && lock === null;
  const answeredCount = questions.filter((question) =>
    isGoldenBellAnswered(question, answers),
  ).length;
  const unanswered = questions.length - answeredCount;
  const correctCount = questions.filter((question) =>
    isGoldenBellCorrect(question, answers),
  ).length;

  const notice = <MissionNotice phase={phase} event={event} view={view} error={error} />;

  if (questions.length === 0) {
    return (
      <MissionShell
        mission={mission}
        team={team}
        roundNo={roundNo}
        event={event}
        phase={phase}
        notice={notice}
        gate={gate}
      >
        <EmptyView
          title="아직 문제가 없어요"
          description="선생님이 문제를 등록하면 풀 수 있어요."
          mascot="mascotTimer"
        />
      </MissionShell>
    );
  }

  if (lock !== null) {
    // 문제 글·보기는 화면에 올리지 않고 문제 수와 형식만 알려 준다.
    const counts = countGoldenBellKinds(questions);
    return (
      <MissionShell
        mission={mission}
        team={team}
        roundNo={roundNo}
        event={event}
        phase={phase}
        notice={notice}
        gate={gate}
        actions={
          <>
            <p className="mission-actions__hint">
              <Icon name="info" />
              {lock === 'not-entered'
                ? '인증코드를 넣고 입장하면 문제를 풀 수 있어요'
                : '게임이 시작되면 문제를 풀 수 있어요'}
            </p>
            <Button size="xl" icon="send" disabled>
              정답 제출
            </Button>
          </>
        }
      >
        <MissionLockedPanel mission={mission} reason={lock} subject="문제가">
          <p>
            문제 {counts.total}개를 풀어요 · O/X {counts.ox}개 · 객관식 {counts.choice}개 · 단답형{' '}
            {counts.short}개
          </p>
          <p>모두 푼 뒤 한 번에 제출해요. 제출하면 답을 바꿀 수 없어요.</p>
        </MissionLockedPanel>
      </MissionShell>
    );
  }

  const currentIndex = Math.min(index, questions.length - 1);
  const current = questions[currentIndex];
  const kind = getGoldenBellKind(current);
  const isLast = currentIndex === questions.length - 1;
  const currentAnswered = isGoldenBellAnswered(current, answers);
  const currentCorrect = isGoldenBellCorrect(current, answers);

  const handleSubmit = async () => {
    // 지금 등록된 문제의 답만, 형식에 맞는 칸에 담아 보낸다.
    const selections: Record<string, number> = {};
    const texts: Record<string, string> = {};
    for (const question of questions) {
      if (!isGoldenBellAnswered(question, draft)) continue;
      if (getGoldenBellKind(question) === 'short') {
        texts[question.id] = draft.texts[question.id].trim();
      } else {
        selections[question.id] = draft.selections[question.id];
      }
    }
    await submit({ type: 'golden_bell', selections, texts });
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
      gate={gate}
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
        ) : unanswered > 0 ? (
          // 덜 풀고 실수로 내지 않도록, 모든 문제에 답하기 전에는 제출 버튼을 보여 주지 않는다.
          <p className="mission-actions__hint">
            <Icon name="info" />
            답한 문제 {answeredCount}/{questions.length} · 아직 {unanswered}문제가 남았어요. 모두
            풀면 제출 버튼이 나와요
          </p>
        ) : (
          <>
            <p className="mission-actions__hint">
              <Icon name="task_alt" />
              {questions.length}문제 모두 답했어요 · 제출하면 답을 바꿀 수 없어요
            </p>
            <Button
              size="xl"
              icon="send"
              disabled={!canSubmitInPhase(phase)}
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
            const answered = isGoldenBellAnswered(question, answers);
            const correct = isGoldenBellCorrect(question, answers);
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
              variant={currentAnswered ? 'primary' : 'secondary'}
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
        <div className="gb-question__meta">
          <p className="gb-question__no">
            <Icon name="notifications_active" />
            문제 {currentIndex + 1} / {questions.length}
          </p>
          <QuestionTags question={current} />
        </div>
        <h2 id="gb-question-text" className="gb-question__text">
          {current.question}
        </h2>
      </section>

      {kind === 'short' ? (
        <ShortAnswer
          // 문제를 넘기면 입력 칸도 그 문제의 답으로 바뀐다.
          key={current.id}
          question={current}
          value={answers.texts[current.id] ?? ''}
          disabled={!canAnswer}
          revealed={answerRevealed}
          correct={currentCorrect}
          onChange={(text) =>
            setDraft((values) => ({
              ...values,
              texts: { ...values.texts, [current.id]: text },
            }))
          }
        />
      ) : (
        <div
          className={`gb-choices${kind === 'ox' ? ' gb-choices--ox' : ''}`}
          role="radiogroup"
          aria-labelledby="gb-question-text"
        >
          {current.choices.map((text, choiceIndex) => {
            const chosen = answers.selections[current.id];
            const isChosen = chosen === choiceIndex;
            const isAnswer = answerRevealed && choiceIndex === current.answerIndex;
            // O는 파랑, X는 분홍. 객관식은 네 가지 색을 돌려 쓴다.
            const color = kind === 'ox' ? (choiceIndex === 0 ? 1 : 4) : (choiceIndex % 4) + 1;
            const className = [
              'gb-choice',
              // 번호나 O·X 글자를 함께 보여 주므로 색만으로 구분하지 않는다.
              `gb-choice--c${color}`,
              kind === 'ox' ? 'gb-choice--ox' : '',
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
                aria-label={
                  kind === 'ox' ? (choiceIndex === 0 ? 'O 맞아요' : 'X 아니에요') : undefined
                }
                className={className}
                disabled={!canAnswer}
                onClick={() => {
                  playEffect('tap');
                  setDraft((values) => ({
                    ...values,
                    selections: { ...values.selections, [current.id]: choiceIndex },
                  }));
                }}
              >
                {kind === 'ox' ? (
                  <>
                    <span className="gb-choice__mark" aria-hidden="true">
                      {text}
                    </span>
                    <span className="gb-choice__text" aria-hidden="true">
                      {choiceIndex === 0 ? '맞아요' : '아니에요'}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="gb-choice__no number">{choiceIndex + 1}</span>
                    <span className="gb-choice__text">{text}</span>
                  </>
                )}
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
      )}

      {answerRevealed ? (
        <section className="gb-reveal" aria-live="polite">
          <AssetImage
            asset={currentCorrect ? 'mascotCorrect' : 'mascotHint'}
            decorative
            className="gb-reveal__mascot"
          />
          <div>
            <p className="gb-reveal__title">
              {!currentAnswered
                ? '정답 공개'
                : currentCorrect
                  ? '정답이에요!'
                  : '아쉬워요! 정답을 확인해 봐요'}
            </p>
            <p>
              정답: <strong>{getGoldenBellAnswerLabel(current)}</strong>
            </p>
            {current.explanation ? <p>{current.explanation}</p> : null}
          </div>
        </section>
      ) : null}

      {repository.mode === 'mock' && saved !== null && !answerRevealed ? (
        <p className="dev-note">
          <Icon name="settings" size="sm" />
          개발용:{' '}
          <Link to={paths.teacherStation(eventId, mission.id)}>교사 화면에서 정답 공개하기</Link>
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
        <p>{questions.length}문제 모두 답했어요.</p>
        <p className="muted">제출하면 답을 바꿀 수 없어요.</p>
      </ConfirmDialog>
    </MissionShell>
  );
}

/** 문제 형식, 난이도, 영역을 작은 표식으로 보여 준다. */
function QuestionTags({ question }: { question: GoldenBellQuestion }) {
  return (
    <p className="gb-question__tags">
      <span className="gb-tag">{GOLDEN_BELL_KIND_LABELS[getGoldenBellKind(question)]}</span>
      {question.level ? (
        <span className={`gb-tag gb-tag--${question.level}`}>
          난이도 {GOLDEN_BELL_LEVEL_LABELS[question.level]}
        </span>
      ) : null}
      {question.area ? <span className="gb-tag">{question.area}</span> : null}
    </p>
  );
}

/** 단답형: 팀이 답을 직접 적는다. 띄어쓰기와 대소문자는 채점에 영향을 주지 않는다. */
function ShortAnswer({
  question,
  value,
  disabled,
  revealed,
  correct,
  onChange,
}: {
  question: GoldenBellQuestion;
  value: string;
  disabled: boolean;
  revealed: boolean;
  correct: boolean;
  onChange: (text: string) => void;
}) {
  const inputId = `gb-short-${question.id}`;
  const state = !revealed ? '' : correct ? ' gb-short--correct' : ' gb-short--wrong';
  return (
    <div className={`gb-short${state}`}>
      <label className="gb-short__label" htmlFor={inputId}>
        <Icon name="edit" /> 답을 적어요
      </label>
      {question.hint ? (
        <p className="gb-short__hint" id={`${inputId}-hint`}>
          <Icon name="lightbulb" /> 힌트: {question.hint}
        </p>
      ) : null}
      <input
        id={inputId}
        className="gb-short__input"
        type="text"
        value={value}
        maxLength={GOLDEN_BELL_SHORT_MAX_LENGTH}
        disabled={disabled}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="여기에 답을 적어요"
        aria-describedby={question.hint ? `${inputId}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {revealed && value.trim() ? (
        <StatusBadge
          tone={correct ? 'success' : 'danger'}
          icon={correct ? 'check_circle' : 'close'}
        >
          {correct ? '우리 답이 맞았어요' : '우리 답이 달라요'}
        </StatusBadge>
      ) : null}
      <p className="gb-short__tip">띄어쓰기와 영어 대문자·소문자는 달라도 괜찮아요.</p>
    </div>
  );
}
