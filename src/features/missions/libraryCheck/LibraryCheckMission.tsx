import { Fragment, useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { useSettings } from '../../../app/SettingsContext';
import { AssetImage } from '../../../components/AssetImage';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/Dialog';
import { FormField } from '../../../components/FormField';
import { Icon } from '../../../components/Icon';
import { MissionShell } from '../../../components/MissionShell';
import { StatusBadge } from '../../../components/StatusBadge';
import {
  getLibraryCheckMaxScore,
  getLibraryItemLabel,
  getLibraryPrompt,
  getLibraryQuestions,
  getScoredLibraryQuestions,
  hasLibraryCheckAnswerKey,
  isLibraryPickOne,
  LIBRARY_CHECK_ITEMS,
  LIBRARY_QUESTION_POINTS,
  LIBRARY_STORY,
  scoreLibraryCheck,
  type LibraryCheckItem,
} from '../../../domain/libraryCheck';
import { canSubmitInPhase } from '../../../domain/missionPhase';
import type {
  LibraryCheckAnswer,
  LibraryCheckConfig,
  LibraryQuestion,
  LibraryQuestionAnswer,
} from '../../../domain/types';
import { getMissionLock } from '../missionLock';
import { MissionLockedPanel } from '../MissionLockedPanel';
import { MissionNotice } from '../MissionNotice';
import type { MissionScreenProps } from '../missionTypes';
import { useMissionSubmit } from '../useMissionSubmit';
import '../Missions.css';

interface LibraryCheckMissionProps extends MissionScreenProps {
  config: LibraryCheckConfig;
}

interface QuestionDraft {
  wrongPart: string;
  choice: number | null;
  correction: string;
  /** 참고한 책 이름. 채점하지 않지만 꼭 적는다. */
  bookTitle: string;
}

/** 입력 칸 이름: 채점 항목 둘 + 참고한 책 */
type FieldKey = LibraryCheckItem | 'bookTitle';
const FIELD_ORDER: readonly FieldKey[] = ['locate', 'correction', 'bookTitle'];

type Draft = Record<string, QuestionDraft>;
type QuestionErrors = Partial<Record<FieldKey, string>>;
type Errors = Record<string, QuestionErrors>;

function toDraft(questions: readonly LibraryQuestion[], answer: LibraryCheckAnswer | null): Draft {
  const draft: Draft = {};
  for (const question of questions) {
    const previous = answer?.answers[question.id];
    draft[question.id] = {
      wrongPart: previous?.wrongPart ?? '',
      choice: typeof previous?.choice === 'number' ? previous.choice : null,
      correction: previous?.correction ?? '',
      bookTitle: previous?.bookTitle ?? '',
    };
  }
  return draft;
}

function validate(questions: readonly LibraryQuestion[], draft: Draft): Errors {
  const errors: Errors = {};
  for (const question of questions) {
    const value = draft[question.id];
    const questionErrors: QuestionErrors = {};
    if (question.type === 'find' && !value.wrongPart.trim()) {
      questionErrors.locate = 'AI 글에서 틀린 부분을 적어 주세요.';
    }
    if (question.type === 'choose' && value.choice === null) {
      questionErrors.locate = '틀린 문장을 하나 골라 주세요.';
    }
    if (!value.correction.trim()) {
      questionErrors.correction = '책에서 찾은 바른 내용을 적어 주세요.';
    }
    if (!value.bookTitle.trim()) {
      questionErrors.bookTitle = '참고한 책 이름을 적어 주세요.';
    }
    if (Object.keys(questionErrors).length > 0) errors[question.id] = questionErrors;
  }
  return errors;
}

function toAnswers(
  questions: readonly LibraryQuestion[],
  draft: Draft,
): Record<string, LibraryQuestionAnswer> {
  const answers: Record<string, LibraryQuestionAnswer> = {};
  for (const question of questions) {
    const value = draft[question.id];
    const shared = { correction: value.correction.trim(), bookTitle: value.bookTitle.trim() };
    answers[question.id] =
      question.type === 'find'
        ? { wrongPart: value.wrongPart.trim(), ...shared }
        : { choice: value.choice ?? -1, ...shared };
  }
  return answers;
}

/**
 * 고른 질문은 이 기기에 적어 두어 화면을 새로 열어도 다시 고르지 못하게 한다.
 * 제출에도 함께 보내므로 제출 뒤에는 서버 기록을 쓴다.
 */
function choiceStorageKey(eventId: string, teamId: string, missionId: string, roundNo: number) {
  return `songjeong-festival:library-choice:${eventId}:${teamId}:${missionId}:${roundNo}`;
}

function readStoredChoice(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storeChoice(key: string, questionId: string) {
  try {
    window.localStorage.setItem(key, questionId);
  } catch {
    // 저장이 막힌 기기에서는 화면 상태로만 유지한다.
  }
}

/** 형광펜으로 표시한 문장을 답 칸에 짧게 보여 준다. */
function shorten(text: string, max = 22): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 이야기와 부정행위 경고. 게임 전 가림막과 게임 중 화면에 같이 보여 준다. */
function LibraryStory({ compact }: { compact?: boolean }) {
  return (
    <>
      <p>
        {LIBRARY_STORY.intro} {LIBRARY_STORY.task}
      </p>
      <p className={compact ? undefined : 'library-story__warning'}>
        <Icon name="do_not_disturb_on" /> {LIBRARY_STORY.warning}
      </p>
    </>
  );
}

/**
 * AI가 쓴 글의 틀린 곳을 찾아 책으로 확인해 바르게 고친다. 학년마다 문제가 다르고,
 * 하나만 고르는 방식이면 AI에게 한 질문 가운데 조사할 답을 먼저 고른다(한 번 고르면 못 바꿈).
 * 선생님이 모든 문제의 정답을 등록해 두었으면 제출 즉시 자동으로 채점된다. 게임 시작 전에는 글을 가린다.
 */
export function LibraryCheckMission({
  eventId,
  view,
  event,
  phase,
  gate,
  onSubmitted,
  config,
}: LibraryCheckMissionProps) {
  const { team, mission, submission, roundNo } = view;
  // 학년별 문제가 있으면 우리 학년 문제를, 없으면 공통 문제를 푼다.
  const questions = getLibraryQuestions(config, team.grade);
  const pickOne = isLibraryPickOne(config, team.grade);
  const previous = submission?.answer.type === 'library_check' ? submission.answer : null;
  const saved = submission && submission.status !== 'draft' ? previous : null;
  const storageKey = choiceStorageKey(eventId, team.id, mission.id, roundNo);
  // 고른 질문: 제출 기록 → 이 기기에 적어 둔 것 순서로 되살린다.
  const [chosenId, setChosenId] = useState<string | null>(() => {
    if (!pickOne) return null;
    const stored = previous?.chosenQuestionId ?? readStoredChoice(storageKey);
    return stored && questions.some((question) => question.id === stored) ? stored : null;
  });
  const [pending, setPending] = useState<LibraryQuestion | null>(null);
  // 재제출 허용이면 지난번 입력을 채워 두고 고칠 수 있게 한다.
  const [draft, setDraft] = useState<Draft>(() => toDraft(questions, previous));
  const [errors, setErrors] = useState<Errors>({});
  const formId = useId();
  const { playEffect } = useSettings();
  const { submit, isPending, error } = useMissionSubmit(eventId, team.id, mission.id, onSubmitted);

  const lock = getMissionLock(view, event, phase);
  const editable = canSubmitInPhase(phase) && saved === null && lock === null;
  const autoScored = hasLibraryCheckAnswerKey(config);
  const maxScore = getLibraryCheckMaxScore(config, team.grade);
  const result = saved ? scoreLibraryCheck(config, saved, team.grade) : null;
  // 화면에 펼치는 문제: 하나만 고르는 방식이면 고른 문제만, 제출 뒤에는 채점된 문제만
  const visible: LibraryQuestion[] = saved
    ? getScoredLibraryQuestions(config, saved, team.grade)
    : pickOne
      ? questions.filter((question) => question.id === chosenId)
      : questions;
  const needsChoice = pickOne && !saved && chosenId === null;
  const single = visible.length === 1;
  const fieldId = (questionId: string, item: FieldKey) => `${formId}-${questionId}-${item}`;
  // 문제가 하나면 "1-1." 같은 번호를 붙이지 않는다.
  const label = (index: number, step: 1 | 2 | 3, text: string) =>
    single ? `${step}. ${text}` : `${index + 1}-${step}. ${text}`;

  const updateText =
    (questionId: string, key: 'wrongPart' | 'correction' | 'bookTitle') =>
    (change: ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      const value = change.target.value;
      setDraft((current) => ({
        ...current,
        [questionId]: { ...current[questionId], [key]: value },
      }));
    };

  const choose = (questionId: string, choice: number) => {
    if (!editable) return;
    playEffect('tap');
    setDraft((current) => ({ ...current, [questionId]: { ...current[questionId], choice } }));
  };

  const confirmChoice = () => {
    if (!pending) return;
    playEffect('success');
    storeChoice(storageKey, pending.id);
    setChosenId(pending.id);
    setPending(null);
  };

  const handleSubmit = (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (!editable || isPending || needsChoice) return;
    const nextErrors = validate(visible, draft);
    setErrors(nextErrors);
    const firstInvalid = visible.find((question) => nextErrors[question.id]);
    if (firstInvalid) {
      const item = FIELD_ORDER.find((key) => nextErrors[firstInvalid.id][key]) ?? 'locate';
      document.getElementById(fieldId(firstInvalid.id, item))?.focus();
      return;
    }
    void submit({
      type: 'library_check',
      answers: toAnswers(visible, draft),
      ...(pickOne && chosenId ? { chosenQuestionId: chosenId } : {}),
    });
  };

  return (
    <MissionShell
      mission={mission}
      team={team}
      roundNo={roundNo}
      event={event}
      phase={phase}
      notice={<MissionNotice phase={phase} event={event} view={view} error={error} />}
      gate={gate}
      actions={
        saved ? (
          result ? (
            <StatusBadge tone="success" icon="task_alt" size="lg">
              제출 완료 · 자동 채점 {result.total}점 / {result.max}점
            </StatusBadge>
          ) : (
            <StatusBadge tone="info" icon="lock" size="lg">
              제출 완료 · 선생님이 확인해요
            </StatusBadge>
          )
        ) : lock !== null ? (
          <>
            <p className="mission-actions__hint">
              <Icon name="info" />
              {lock === 'not-entered'
                ? '인증코드를 넣고 입장하면 글을 읽을 수 있어요'
                : '게임이 시작되면 글을 읽고 확인할 수 있어요'}
            </p>
            <Button size="xl" icon="send" disabled>
              확인 내용 제출
            </Button>
          </>
        ) : needsChoice ? (
          <>
            <p className="mission-actions__hint">
              <Icon name="touch_app" />
              조사할 답을 먼저 골라요 · {LIBRARY_STORY.chooseLock}
            </p>
            <Button size="xl" icon="send" disabled>
              확인 내용 제출
            </Button>
          </>
        ) : (
          <>
            {autoScored ? (
              <p className="mission-actions__hint">
                <Icon name="bolt" />
                제출하면 바로 채점돼요 · 한 번만 낼 수 있어요
              </p>
            ) : null}
            <Button
              type="submit"
              form={formId}
              size="xl"
              icon="send"
              disabled={!editable}
              loading={isPending}
              loadingLabel="제출하는 중"
            >
              확인 내용 제출
            </Button>
          </>
        )
      }
    >
      {lock !== null ? (
        // 글 본문은 화면에 올리지 않는다. 이야기와 규칙, 무엇을 적어 내는지만 알려 준다.
        <MissionLockedPanel mission={mission} reason={lock} subject="AI가 쓴 글이">
          <LibraryStory compact />
          {pickOne ? (
            <p>
              AI에게 한 질문 {questions.length}개 가운데 하나를 골라 조사해요.{' '}
              {LIBRARY_STORY.chooseLock}
            </p>
          ) : null}
          <p>
            적어 낼 것:{' '}
            {(pickOne ? questions.slice(0, 1) : questions)
              .map(
                (question, index) =>
                  `${single || pickOne ? '' : `${index + 1}번 `}${question.type === 'choose' ? '틀린 문장(형광펜 표시)' : '틀린 부분'}, 바르게 고친 내용, 참고한 책 이름`,
              )
              .join(' · ')}
          </p>
        </MissionLockedPanel>
      ) : (
        <form id={formId} className="library" onSubmit={handleSubmit} noValidate>
          <section className="library-story" aria-labelledby="library-story-title">
            <Icon name="smart_toy" className="library-story__icon" />
            <div className="library-story__body">
              <h2 id="library-story-title" className="library-story__title">
                {LIBRARY_STORY.title}
              </h2>
              <LibraryStory />
            </div>
          </section>

          {needsChoice ? (
            <section className="library-pick" aria-labelledby="library-pick-title">
              <h2 id="library-pick-title" className="library-pick__title">
                <Icon name="touch_app" /> {LIBRARY_STORY.choose}
              </h2>
              <p className="library-pick__lock">{LIBRARY_STORY.chooseLock}</p>
              <div className="library-pick__cards">
                {questions.map((question) => (
                  <button
                    key={question.id}
                    type="button"
                    className="library-pick__card"
                    disabled={!editable}
                    onClick={() => {
                      playEffect('tap');
                      setPending(question);
                    }}
                  >
                    {question.subject ? (
                      <span className="library-pick__subject">{question.subject}</span>
                    ) : null}
                    <span className="library-pick__prompt">
                      <Icon name="format_quote" /> {getLibraryPrompt(question)}
                    </span>
                    <span className="library-pick__hint">
                      <Icon name="smart_toy" /> AI가 답한 글을 조사해요
                    </span>
                  </button>
                ))}
              </div>
              <ConfirmDialog
                open={pending !== null}
                title="이 답을 조사할까요?"
                confirmLabel="이 답을 조사할래요"
                confirmIcon="check"
                cancelLabel="다시 고를래요"
                onConfirm={confirmChoice}
                onCancel={() => setPending(null)}
              >
                <p>
                  <strong>“{pending ? getLibraryPrompt(pending) : ''}”</strong>에 AI가 답한 글을
                  조사해요.
                </p>
                <p>{LIBRARY_STORY.chooseLock}</p>
              </ConfirmDialog>
            </section>
          ) : null}

          {result ? (
            <section className="library-result" aria-labelledby="library-result-title">
              <AssetImage
                asset={result.total === maxScore ? 'mascotCorrect' : 'mascotHint'}
                decorative
                className="library-result__mascot"
              />
              <div className="library-result__body">
                <h2 id="library-result-title" className="library-result__title">
                  자동 채점 결과{' '}
                  <strong className="number">
                    {result.total} / {result.max}점
                  </strong>
                </h2>
                {visible.map((question, index) => {
                  const score = result.questions[question.id];
                  if (!score) return null;
                  return (
                    <div key={question.id} className="library-result__question">
                      {single ? null : <span className="library-result__no">{index + 1}번</span>}
                      <ul className="library-result__items">
                        {LIBRARY_CHECK_ITEMS.map((item) => (
                          <li
                            key={item}
                            className={`library-result__item${
                              score.items[item] ? ' library-result__item--ok' : ''
                            }`}
                          >
                            <Icon name={score.items[item] ? 'check_circle' : 'close'} />
                            {getLibraryItemLabel(question.type, item)}{' '}
                            <span className="number">
                              {score.items[item] ? LIBRARY_QUESTION_POINTS[item] : 0}점
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
                <p className="library-result__note">
                  점수는 선생님이 확인한 뒤 고칠 수 있어요. 3위 안에 들면 카드 조각을 받아요.
                </p>
              </div>
            </section>
          ) : null}

          {visible.map((question, index) => {
            const value = draft[question.id];
            const questionErrors = errors[question.id] ?? {};
            const titleId = `${formId}-${question.id}-title`;
            return (
              <section key={question.id} className="library__question" aria-labelledby={titleId}>
                <div className="library__passage">
                  <p className="library__label">
                    <Icon name="smart_toy" />
                    {single ? 'AI가 답한 글' : `${index + 1}번`}
                    {question.subject ? (
                      <span className="library__subject">{question.subject}</span>
                    ) : null}
                    <span className="library__task">
                      {question.type === 'choose'
                        ? '틀린 문장을 짚어 형광펜을 칠하고 바르게 고쳐요'
                        : '틀린 부분을 찾아 적고 바르게 고쳐요'}
                    </span>
                  </p>
                  {/* 실제 AI 대화처럼 보여 준다: 내가 한 질문(오른쪽)과 AI의 답(왼쪽 말풍선, 번호 없는 줄글) */}
                  <div className="chat">
                    {question.prompt ? (
                      <div className="chat__row chat__row--me">
                        <p className="chat__bubble chat__bubble--me">{question.prompt}</p>
                      </div>
                    ) : null}
                    <div className="chat__row chat__row--ai">
                      <Icon name="smart_toy" className="chat__avatar" />
                      <div className="chat__bubble chat__bubble--ai">
                        <h2 id={titleId} className="library__title">
                          {question.title}
                        </h2>
                        {question.type === 'find' ? (
                          <p className="library__text">{question.passage}</p>
                        ) : (
                          // 문장은 글 속에 그대로 있고, 짚으면 형광펜을 칠한 것처럼 보인다.
                          <p
                            id={fieldId(question.id, 'locate')}
                            className="library__text library-prose"
                            role="radiogroup"
                            aria-label={
                              single ? '틀린 문장 고르기' : `${index + 1}번 틀린 문장 고르기`
                            }
                            aria-invalid={questionErrors.locate ? true : undefined}
                            tabIndex={-1}
                          >
                            {question.sentences.map((sentence, sentenceIndex) => {
                              const isChosen = value.choice === sentenceIndex;
                              return (
                                <Fragment key={`${question.id}-${sentenceIndex}`}>
                                  <button
                                    type="button"
                                    role="radio"
                                    aria-checked={isChosen}
                                    className={`library-sentence${
                                      isChosen ? ' library-sentence--marked' : ''
                                    }`}
                                    disabled={!editable}
                                    onClick={() => choose(question.id, sentenceIndex)}
                                  >
                                    {sentence}
                                  </button>{' '}
                                </Fragment>
                              );
                            })}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  {questionErrors.locate ? (
                    <p className="form-field__error" role="alert">
                      <Icon name="error" size="sm" />
                      {questionErrors.locate}
                    </p>
                  ) : null}
                  <p className="library__tip">
                    <Icon name="menu_book" />
                    {question.type === 'choose'
                      ? '틀린 문장을 손가락으로 짚으면 형광펜이 칠해져요. 인터넷 말고 도서관 책에서 사실을 확인해요.'
                      : '인터넷 말고 도서관 책에서 사실을 확인해요.'}
                  </p>
                </div>

                <div className="panel library__form">
                  {question.type === 'find' ? (
                    <FormField
                      id={fieldId(question.id, 'locate')}
                      label={label(index, 1, '틀린 부분')}
                      error={questionErrors.locate}
                    >
                      {(control) => (
                        <textarea
                          {...control}
                          className="text-input"
                          rows={2}
                          value={value.wrongPart}
                          onChange={updateText(question.id, 'wrongPart')}
                          readOnly={!editable}
                        />
                      )}
                    </FormField>
                  ) : (
                    <p className="library__chosen">
                      <Icon name={value.choice === null ? 'touch_app' : 'check_circle'} />
                      {value.choice === null
                        ? label(index, 1, '왼쪽 글에서 틀린 문장을 짚어 형광펜을 칠해요')
                        : label(
                            index,
                            1,
                            `형광펜 표시: “${shorten(question.sentences[value.choice] ?? '')}”`,
                          )}
                    </p>
                  )}
                  <FormField
                    id={fieldId(question.id, 'correction')}
                    label={label(index, 2, '책에서 찾은 바른 내용으로 고치기')}
                    error={questionErrors.correction}
                  >
                    {(control) => (
                      <textarea
                        {...control}
                        className="text-input"
                        rows={2}
                        value={value.correction}
                        onChange={updateText(question.id, 'correction')}
                        readOnly={!editable}
                      />
                    )}
                  </FormField>
                  <FormField
                    id={fieldId(question.id, 'bookTitle')}
                    label={label(index, 3, '참고한 책 이름')}
                    hint="점수에는 들어가지 않지만 꼭 적어요. 예: 딩동~ 고래 도감"
                    error={questionErrors.bookTitle}
                  >
                    {(control) => (
                      <input
                        {...control}
                        className="text-input"
                        value={value.bookTitle}
                        onChange={updateText(question.id, 'bookTitle')}
                        readOnly={!editable}
                      />
                    )}
                  </FormField>
                </div>
              </section>
            );
          })}
        </form>
      )}
    </MissionShell>
  );
}
