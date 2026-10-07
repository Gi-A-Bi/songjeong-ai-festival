import { useCallback, useId, useState } from 'react';
import { Button } from '../../../components/Button';
import { FormField } from '../../../components/FormField';
import { Icon } from '../../../components/Icon';
import { InlineAlert } from '../../../components/StateViews';
import { StatusBadge } from '../../../components/StatusBadge';
import { toUserMessage } from '../../../data/errors';
import { useRepository } from '../../../data/RepositoryContext';
import {
  circledNumber,
  createLibraryQuestionId,
  getLibraryCheckConfigError,
  hasLibraryCheckAnswerKey,
  LIBRARY_GRADES,
  LIBRARY_QUESTION_MAX_SCORE,
  LIBRARY_QUESTION_POINTS,
  LIBRARY_QUESTION_TYPE_LABELS,
  LIBRARY_STORY,
  LIBRARY_SUBJECTS,
  normalizeLibraryCheckConfig,
  splitKeywords,
  splitSentences,
} from '../../../domain/libraryCheck';
import type {
  Grade,
  LibraryCheckConfig,
  LibraryQuestion,
  LibraryQuestionType,
  Mission,
} from '../../../domain/types';
import { useAction } from '../../../hooks/useAction';

interface LibraryCheckEditorProps {
  eventId: string;
  mission: Mission;
  config: LibraryCheckConfig;
  onSaved: () => void;
}

/** 입력 칸 그대로의 값. 저장할 때 문제 형식으로 바꾼다. */
interface QuestionDraft {
  id: string;
  type: LibraryQuestionType;
  title: string;
  /** AI에게 한 질문(고르기 카드에 보임) */
  prompt: string;
  /** 주제 배지 */
  subject: string;
  /** 서술형 글 본문 */
  passage: string;
  /** 선택형 문장(한 줄에 한 문장) */
  sentences: string;
  /** 서술형: 틀린 부분으로 인정하는 말 */
  wrongPart: string;
  /** 선택형: 틀린 문장의 차례(비우면 정답 없음) */
  wrongIndex: string;
  /** 바르게 고친 내용으로 인정하는 말 */
  correction: string;
}

/** 공통 묶음과 학년별 묶음 */
type SetKey = 'common' | Grade;

interface Draft {
  pickOne: boolean;
  common: QuestionDraft[];
  grades: Partial<Record<Grade, QuestionDraft[]>>;
}

function toQuestionDraft(question: LibraryQuestion): QuestionDraft {
  const base = {
    id: question.id,
    type: question.type,
    title: question.title,
    prompt: question.prompt ?? '',
    subject: question.subject ?? '',
    correction: question.answerKey?.correctionKeywords.join(', ') ?? '',
  };
  if (question.type === 'find') {
    return {
      ...base,
      passage: question.passage,
      sentences: '',
      wrongPart: question.answerKey?.wrongPartKeywords.join(', ') ?? '',
      wrongIndex: '',
    };
  }
  const index = question.answerKey?.wrongIndex;
  return {
    ...base,
    passage: '',
    sentences: question.sentences.join('\n'),
    wrongPart: '',
    wrongIndex: typeof index === 'number' && index >= 0 ? String(index) : '',
  };
}

function toDraft(config: LibraryCheckConfig): Draft {
  const grades: Draft['grades'] = {};
  for (const grade of LIBRARY_GRADES) {
    const own = config.gradeQuestions?.[grade];
    if (own && own.length > 0) grades[grade] = own.map(toQuestionDraft);
  }
  return {
    pickOne: config.pickOne === true,
    common: config.questions.map(toQuestionDraft),
    grades,
  };
}

function emptyQuestionDraft(type: LibraryQuestionType, id: string): QuestionDraft {
  return {
    id,
    type,
    title: '',
    prompt: '',
    subject: '',
    passage: '',
    sentences: '',
    wrongPart: '',
    wrongIndex: '',
    correction: '',
  };
}

function toQuestion(draft: QuestionDraft): LibraryQuestion {
  const correctionKeywords = splitKeywords(draft.correction);
  const base = {
    id: draft.id,
    title: draft.title,
    prompt: draft.prompt,
    subject: draft.subject,
  };
  if (draft.type === 'find') {
    return {
      ...base,
      type: 'find',
      passage: draft.passage,
      answerKey: { wrongPartKeywords: splitKeywords(draft.wrongPart), correctionKeywords },
    };
  }
  return {
    ...base,
    type: 'choose',
    sentences: splitSentences(draft.sentences),
    answerKey: {
      wrongIndex: draft.wrongIndex === '' ? -1 : Number(draft.wrongIndex),
      correctionKeywords,
    },
  };
}

function toConfig(draft: Draft): LibraryCheckConfig {
  // 정답 칸을 모두 비운 문제는 정답 없이 저장되어 선생님이 직접 채점한다. 비어 있는 학년 묶음은 빠진다.
  const gradeQuestions: Partial<Record<Grade, LibraryQuestion[]>> = {};
  for (const grade of LIBRARY_GRADES) {
    const own = draft.grades[grade];
    if (own && own.length > 0) gradeQuestions[grade] = own.map(toQuestion);
  }
  return normalizeLibraryCheckConfig({
    type: 'library_check',
    questions: draft.common.map(toQuestion),
    gradeQuestions,
    pickOne: draft.pickOne,
  });
}

function getSet(draft: Draft, key: SetKey): QuestionDraft[] {
  return key === 'common' ? draft.common : (draft.grades[key] ?? []);
}

function withSet(draft: Draft, key: SetKey, questions: QuestionDraft[]): Draft {
  if (key === 'common') return { ...draft, common: questions };
  return { ...draft, grades: { ...draft.grades, [key]: questions } };
}

function setLabel(key: SetKey): string {
  return key === 'common' ? '공통' : `${key}학년`;
}

/**
 * 도서관 오류찾기의 문제와 정답 등록. 학년별로 문제를 따로 둘 수 있고, 학년별 문제가 없는 학년은
 * 공통 문제를 푼다. "하나만 고르기"를 켜면 학생은 AI에게 한 질문 가운데 조사할 답을 하나 골라 푼다.
 * 서술형(틀린 부분 찾아 고치기)과 선택형(틀린 문장 고르고 고치기)을 섞어 낼 수 있다.
 * 모든 문제에 정답을 등록하면 제출 즉시 자동 채점된다.
 */
export function LibraryCheckEditor({ eventId, mission, config, onSaved }: LibraryCheckEditorProps) {
  const repository = useRepository();
  const ids = useId();
  const [draft, setDraft] = useState(() => toDraft(config));
  const [setKey, setSetKey] = useState<SetKey>('common');
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = useAction(
    useCallback(
      (next: LibraryCheckConfig) => repository.updateMissionConfig(eventId, mission.id, next),
      [repository, eventId, mission.id],
    ),
  );

  const change = (updater: (previous: Draft) => Draft) => {
    setDraft(updater);
    setDirty(true);
    setSaved(false);
  };

  const questions = getSet(draft, setKey);

  const update = (index: number, patch: Partial<QuestionDraft>) =>
    change((previous) =>
      withSet(
        previous,
        setKey,
        getSet(previous, setKey).map((question, at) =>
          at === index ? { ...question, ...patch } : question,
        ),
      ),
    );

  const add = (type: LibraryQuestionType) =>
    change((previous) => {
      const current = getSet(previous, setKey);
      const prefix = setKey === 'common' ? 'q' : `g${setKey}q`;
      return withSet(previous, setKey, [
        ...current,
        emptyQuestionDraft(type, createLibraryQuestionId(current, prefix)),
      ]);
    });

  const remove = (index: number) =>
    change((previous) =>
      withSet(
        previous,
        setKey,
        getSet(previous, setKey).filter((_, at) => at !== index),
      ),
    );

  const next = toConfig(draft);
  const error = getLibraryCheckConfigError(next);
  const autoScored = hasLibraryCheckAnswerKey(next);
  const maxScore =
    draft.pickOne && questions.length > 1
      ? LIBRARY_QUESTION_MAX_SCORE
      : questions.length * LIBRARY_QUESTION_MAX_SCORE;

  const handleSave = async () => {
    setShowErrors(true);
    if (error) return;
    const result = await save.run(next);
    if (result?.ok) {
      setDraft(toDraft(next));
      setDirty(false);
      setShowErrors(false);
      setSaved(true);
      onSaved();
    }
  };

  const field = (index: number, key: keyof QuestionDraft) => `${ids}-${setKey}-${index}-${key}`;
  const subjectListId = `${ids}-subjects`;

  return (
    <section className="stack" aria-labelledby="library-editor-title">
      <div className="teacher-title">
        <h2 id="library-editor-title" className="section-title">
          <Icon name="menu_book" /> 문제와 정답 등록
          {autoScored ? (
            <StatusBadge tone="success" icon="bolt">
              자동 채점
            </StatusBadge>
          ) : (
            <StatusBadge tone="warning" icon="school">
              선생님 판정
            </StatusBadge>
          )}
          {dirty ? (
            <StatusBadge tone="warning" icon="edit">
              저장 안 됨
            </StatusBadge>
          ) : null}
        </h2>
      </div>

      <InlineAlert tone="info">
        학년마다 문제를 따로 둘 수 있어요. 학년별 문제가 없는 학년은 공통 문제를 풀어요. 문제마다
        찾기(틀린 부분·틀린 문장) {LIBRARY_QUESTION_POINTS.locate}점 + 바르게 고치기{' '}
        {LIBRARY_QUESTION_POINTS.correction}점으로 채점하고, 모든 문제에 정답을 등록해야 제출 즉시
        자동으로 채점돼요. 자동 점수는 순위표에서 언제든 고칠 수 있어요. 학생 화면에는 “
        {LIBRARY_STORY.title}” 이야기와 부정행위 경고가 함께 나와요.
      </InlineAlert>

      <div className="panel">
        <label className="library-editor__toggle">
          <input
            type="checkbox"
            checked={draft.pickOne}
            onChange={(event) =>
              change((previous) => ({ ...previous, pickOne: event.target.checked }))
            }
          />
          <span>
            <strong>학생이 질문 하나만 골라 풀어요.</strong> 학년마다 문제를 두 개 이상 넣으면
            학생은 “AI에게 한 질문” 카드 가운데 하나를 골라 그 글만 조사해요. 한 번 고르면 바꿀 수
            없고, 점수는 고른 문제 하나로 {LIBRARY_QUESTION_MAX_SCORE}점 만점이에요. (화면에는 “문제
            유형” 같은 말 대신 질문과 주제 배지만 보여요.)
          </span>
        </label>
      </div>

      <div className="segmented" role="group" aria-label="문제 묶음 선택">
        {(['common', ...LIBRARY_GRADES] as SetKey[]).map((key) => {
          const count = getSet(draft, key).length;
          return (
            <button
              key={String(key)}
              type="button"
              className="segmented__button"
              aria-pressed={setKey === key}
              onClick={() => {
                setSetKey(key);
                setShowErrors(false);
              }}
            >
              {setLabel(key)}
              {count > 0 ? ` (${count}문제)` : key === 'common' ? ' (없음)' : ' (공통 사용)'}
            </button>
          );
        })}
      </div>

      {questions.length === 0 ? (
        <InlineAlert tone="info">
          {setKey === 'common'
            ? '공통 문제가 없어요. 학년별 문제가 없는 학년이 있으면 공통 문제를 넣어 주세요.'
            : `${setKey}학년은 공통 문제를 풀어요. ${setKey}학년만의 문제를 내려면 아래에서 문제를 추가하세요.`}
        </InlineAlert>
      ) : (
        <p className="muted">
          {setLabel(setKey)} 문제 {questions.length}개 · 만점 {maxScore}점
          {draft.pickOne && questions.length > 1 ? ' (하나만 골라 풀어요)' : ''}
        </p>
      )}

      <datalist id={subjectListId}>
        {LIBRARY_SUBJECTS.map((subject) => (
          <option key={subject} value={subject} />
        ))}
      </datalist>

      {questions.map((question, index) => {
        const no = index + 1;
        const sentences = splitSentences(question.sentences);
        return (
          <div key={question.id} className="panel stack">
            <div className="library-editor__head">
              <h3 className="section-title">
                <Icon name={question.type === 'choose' ? 'format_list_numbered' : 'edit_note'} />{' '}
                {setLabel(setKey)} {no}번 · {LIBRARY_QUESTION_TYPE_LABELS[question.type]}
                <span className="muted">
                  {question.type === 'choose'
                    ? ' (틀린 문장을 고르고 바르게 고치기)'
                    : ' (틀린 부분을 찾아 적고 바르게 고치기)'}
                </span>
              </h3>
              <Button
                variant="ghost"
                size="md"
                icon="delete"
                onClick={() => remove(index)}
                aria-label={`${no}번 문제 삭제`}
              >
                삭제
              </Button>
            </div>

            <div className="library-editor__meta">
              <FormField
                id={field(index, 'prompt')}
                label={`${no}번 AI에게 한 질문`}
                hint="고르기 카드에 보여요. 예: 고래에 대해 알려 줘"
              >
                {(control) => (
                  <input
                    {...control}
                    className="text-input"
                    value={question.prompt}
                    onChange={(event) => update(index, { prompt: event.target.value })}
                  />
                )}
              </FormField>
              <FormField
                id={field(index, 'subject')}
                label={`${no}번 주제`}
                hint="배지로 보여요. 예: 과학, 역사, 우리말, 예술"
              >
                {(control) => (
                  <input
                    {...control}
                    className="text-input"
                    list={subjectListId}
                    value={question.subject}
                    onChange={(event) => update(index, { subject: event.target.value })}
                  />
                )}
              </FormField>
            </div>

            <FormField
              id={field(index, 'title')}
              label={`${no}번 글 제목`}
              hint="예: AI가 쓴 “꿀벌” 소개 글"
              error={showErrors && !question.title.trim() ? '글 제목을 적어 주세요.' : undefined}
            >
              {(control) => (
                <input
                  {...control}
                  className="text-input"
                  value={question.title}
                  onChange={(event) => update(index, { title: event.target.value })}
                />
              )}
            </FormField>

            {question.type === 'find' ? (
              <FormField
                id={field(index, 'passage')}
                label={`${no}번 AI가 쓴 글(일부러 틀린 내용을 넣은 글)`}
                error={
                  showErrors && !question.passage.trim() ? '글 본문을 적어 주세요.' : undefined
                }
              >
                {(control) => (
                  <textarea
                    {...control}
                    className="text-input"
                    rows={5}
                    value={question.passage}
                    onChange={(event) => update(index, { passage: event.target.value })}
                  />
                )}
              </FormField>
            ) : (
              <>
                <FormField
                  id={field(index, 'sentences')}
                  label={`${no}번 문장(한 줄에 한 문장, 그중 하나가 틀린 문장)`}
                  hint="학생 화면에는 ①②③… 번호가 붙어 보여요."
                  error={
                    showErrors && sentences.length < 2
                      ? '문장을 두 개 이상 적어 주세요(한 줄에 한 문장).'
                      : undefined
                  }
                >
                  {(control) => (
                    <textarea
                      {...control}
                      className="text-input"
                      rows={5}
                      value={question.sentences}
                      onChange={(event) => update(index, { sentences: event.target.value })}
                    />
                  )}
                </FormField>
                {sentences.length > 0 ? (
                  <ol className="library-editor__preview">
                    {sentences.map((sentence, at) => (
                      <li key={`${question.id}-${at}`} value={at + 1}>
                        {circledNumber(at)} {sentence}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </>
            )}

            <h4 className="section-title">
              <Icon name="fact_check" /> {no}번 정답(자동 채점 기준)
            </h4>
            <p className="muted">
              인정하는 말이 여러 개면 쉼표로 나눠 적어요. 띄어쓰기, 대소문자, 문장 부호는 달라도
              맞은 것으로 봐요. 정답 칸을 모두 비우면 이 문제는 선생님이 직접 채점해요.
            </p>
            {question.type === 'find' ? (
              <FormField
                id={field(index, 'wrongPart')}
                label={`${no}번 틀린 부분으로 인정하는 말 (${LIBRARY_QUESTION_POINTS.locate}점)`}
                hint="예: 다리가 8개, 8개"
              >
                {(control) => (
                  <input
                    {...control}
                    className="text-input"
                    value={question.wrongPart}
                    onChange={(event) => update(index, { wrongPart: event.target.value })}
                  />
                )}
              </FormField>
            ) : (
              <FormField
                id={field(index, 'wrongIndex')}
                label={`${no}번 틀린 문장 (${LIBRARY_QUESTION_POINTS.locate}점)`}
              >
                {(control) => (
                  <select
                    {...control}
                    className="text-input"
                    value={question.wrongIndex}
                    onChange={(event) => update(index, { wrongIndex: event.target.value })}
                  >
                    <option value="">(정답 없음)</option>
                    {sentences.map((sentence, at) => (
                      <option key={`${question.id}-option-${at}`} value={String(at)}>
                        {circledNumber(at)} {sentence}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
            )}
            <FormField
              id={field(index, 'correction')}
              label={`${no}번 바르게 고친 내용으로 인정하는 말 (${LIBRARY_QUESTION_POINTS.correction}점)`}
              hint="예: 6개, 여섯 개"
            >
              {(control) => (
                <input
                  {...control}
                  className="text-input"
                  value={question.correction}
                  onChange={(event) => update(index, { correction: event.target.value })}
                />
              )}
            </FormField>
          </div>
        );
      })}

      <div className="library-editor__add">
        <Button variant="ghost" size="md" icon="format_list_numbered" onClick={() => add('choose')}>
          선택형 문제 추가
        </Button>
        <Button variant="ghost" size="md" icon="edit_note" onClick={() => add('find')}>
          서술형 문제 추가
        </Button>
      </div>

      {showErrors && error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {save.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(save.error)}</InlineAlert>
      ) : null}
      {saved ? (
        <InlineAlert tone="success">
          저장했어요. {autoScored ? '이제 제출 즉시 자동으로 채점돼요.' : '선생님이 직접 채점해요.'}
        </InlineAlert>
      ) : null}

      <div className="teacher-actions">
        <Button
          variant="ghost"
          size="lg"
          icon="undo"
          disabled={!dirty}
          onClick={() => {
            setDraft(toDraft(config));
            setDirty(false);
            setShowErrors(false);
            save.reset();
          }}
        >
          변경 취소
        </Button>
        <Button
          size="lg"
          icon="save"
          disabled={!dirty}
          loading={save.isPending}
          onClick={() => void handleSave()}
        >
          저장
        </Button>
      </div>
    </section>
  );
}
