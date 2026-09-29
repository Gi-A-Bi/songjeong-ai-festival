import { useCallback, useState } from 'react';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/Dialog';
import { FormField } from '../../../components/FormField';
import { Icon } from '../../../components/Icon';
import { InlineAlert } from '../../../components/StateViews';
import { StatusBadge } from '../../../components/StatusBadge';
import { toUserMessage } from '../../../data/errors';
import { useRepository } from '../../../data/RepositoryContext';
import {
  changeGoldenBellKind,
  countGoldenBellKinds,
  createEmptyGoldenBellQuestion,
  getGoldenBellConfigError,
  getGoldenBellKind,
  getGoldenBellSetsError,
  GOLDEN_BELL_GRADES,
  GOLDEN_BELL_KIND_LABELS,
  GOLDEN_BELL_KINDS,
  GOLDEN_BELL_LEVEL_LABELS,
  GOLDEN_BELL_LEVELS,
  GOLDEN_BELL_RECOMMENDED_QUESTIONS,
  hasGoldenBellErrors,
  normalizeGoldenBellQuestion,
  toEditableGoldenBellQuestion,
  validateGoldenBellQuestion,
  type GoldenBellQuestionErrors,
} from '../../../domain/goldenBell';
import type {
  GoldenBellConfig,
  GoldenBellLevel,
  GoldenBellQuestion,
  GoldenBellQuestionKind,
  Grade,
  Mission,
} from '../../../domain/types';
import { useAction } from '../../../hooks/useAction';
import { GoldenBellUploadPanel } from './GoldenBellUploadPanel';

/** 고치는 대상: 학년 공통 문제이거나 한 학년의 문제 */
type Scope = 'common' | Grade;

interface GoldenBellQuestionEditorProps {
  eventId: string;
  mission: Mission;
  config: GoldenBellConfig;
  /** 지금 진행하는 학년. 그 학년의 문제가 따로 있으면 그 문제부터 보여 준다. */
  grade: Grade | null;
  onSaved: () => void;
}

const SCOPES: readonly Scope[] = ['common', ...GOLDEN_BELL_GRADES];

function scopeLabel(scope: Scope): string {
  return scope === 'common' ? '공통' : `${scope}학년`;
}

function scopeQuestions(config: GoldenBellConfig, scope: Scope): GoldenBellQuestion[] {
  return scope === 'common' ? config.questions : (config.gradeQuestions?.[scope] ?? []);
}

function toEditable(config: GoldenBellConfig, scope: Scope): GoldenBellQuestion[] {
  return scopeQuestions(config, scope).map(toEditableGoldenBellQuestion);
}

/**
 * 단답형의 "함께 인정하는 답"은 쉼표로 나눠 적는다.
 * 적는 동안에는 답 안의 띄어쓰기를 지우지 않는다(저장할 때 다듬는다).
 */
function splitAnswers(text: string): string[] {
  return text.split(/[,，、]/u).map((answer) => answer.replace(/^\s+/u, ''));
}

/**
 * 골든벨 문제 등록·수정. 학년 공통 문제와 학년별 문제를 따로 고친다.
 * 학년별 문제를 등록한 학년은 그 문제를, 나머지 학년은 공통 문제를 푼다.
 */
export function GoldenBellQuestionEditor({
  eventId,
  mission,
  config,
  grade,
  onSaved,
}: GoldenBellQuestionEditorProps) {
  const repository = useRepository();
  const [scope, setScope] = useState<Scope>(() =>
    grade !== null && scopeQuestions(config, grade).length > 0 ? grade : 'common',
  );
  const [questions, setQuestions] = useState(() => toEditable(config, scope));
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saved, setSaved] = useState(false);
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);
  const [copyFrom, setCopyFrom] = useState<Scope | ''>('');

  // 문제 파일을 올려 설정이 바뀌면 목록을 새 문제로 바꾼다. 고치던 문제가 있으면 그대로 둔다.
  const [seenConfig, setSeenConfig] = useState(config);
  if (seenConfig !== config) {
    setSeenConfig(config);
    if (!dirty) setQuestions(toEditable(config, scope));
  }

  const save = useAction(
    useCallback(
      (next: GoldenBellConfig) => repository.updateMissionConfig(eventId, mission.id, next),
      [repository, eventId, mission.id],
    ),
  );

  const change = (next: GoldenBellQuestion[]) => {
    setQuestions(next);
    setDirty(true);
    setSaved(false);
  };

  const pickScope = (next: Scope) => {
    setScope(next);
    setQuestions(toEditable(config, next));
    setDirty(false);
    setShowErrors(false);
    setSaved(false);
    setCopyFrom('');
    save.reset();
  };

  const updateQuestion = (index: number, patch: Partial<GoldenBellQuestion>) =>
    change(questions.map((question, at) => (at === index ? { ...question, ...patch } : question)));

  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= questions.length) return;
    const next = [...questions];
    [next[index], next[target]] = [next[target], next[index]];
    change(next);
  };

  /** 이 목록을 저장했을 때의 전체 설정 */
  const buildConfig = (list: GoldenBellQuestion[]): GoldenBellConfig => {
    const gradeQuestions = { ...config.gradeQuestions };
    if (scope !== 'common') {
      if (list.length > 0) gradeQuestions[scope] = list;
      else delete gradeQuestions[scope];
    }
    return {
      type: 'golden_bell',
      questions: scope === 'common' ? list : config.questions,
      gradeQuestions,
    };
  };

  // 학년 문제를 모두 지우면 그 학년은 공통 문제를 쓴다. 그 밖에는 목록에 문제가 있어야 한다.
  const getError = (list: GoldenBellQuestion[]): string | null => {
    if (list.length > 0) {
      const error = getGoldenBellConfigError(list);
      if (error) return error;
    }
    return getGoldenBellSetsError(buildConfig(list));
  };

  const handleSave = async () => {
    setShowErrors(true);
    const normalized = questions.map(normalizeGoldenBellQuestion);
    if (getError(normalized)) return;
    const result = await save.run(buildConfig(normalized));
    if (result?.ok) {
      setQuestions(normalized.map(toEditableGoldenBellQuestion));
      setDirty(false);
      setShowErrors(false);
      setSaved(true);
      onSaved();
    }
  };

  const listError = showErrors ? getError(questions) : null;
  const counts = countGoldenBellKinds(questions);
  const copySources = SCOPES.filter(
    (item) => item !== scope && scopeQuestions(config, item).length > 0,
  );

  return (
    <section className="stack" aria-labelledby="gb-editor-title">
      <div className="teacher-title">
        <h2 id="gb-editor-title" className="section-title">
          <Icon name="quiz" /> 골든벨 문제 등록
          <StatusBadge
            tone={questions.length === GOLDEN_BELL_RECOMMENDED_QUESTIONS ? 'success' : 'info'}
            icon="format_list_numbered"
          >
            {questions.length}문항 (권장 {GOLDEN_BELL_RECOMMENDED_QUESTIONS}문항)
          </StatusBadge>
          {dirty ? (
            <StatusBadge tone="warning" icon="edit">
              저장 안 됨
            </StatusBadge>
          ) : null}
        </h2>
      </div>

      <InlineAlert tone="info">
        학생은 모든 문제를 풀고 한 번에 제출해요. 맞힌 문제마다 100점이고, 점수가 같으면 먼저 낸
        팀이 앞서요. 행사 중에 문제를 바꾸면 이미 제출한 팀의 자동 점수도 새 문제 기준으로 다시
        계산돼요.
      </InlineAlert>

      <div className="stack">
        <div className="segmented" role="group" aria-label="문제를 고칠 학년">
          {SCOPES.map((item) => {
            const count = scopeQuestions(config, item).length;
            return (
              <button
                key={item}
                type="button"
                className="segmented__button"
                aria-pressed={scope === item}
                // 저장하지 않은 문제를 잃지 않도록, 고치는 동안에는 다른 학년으로 넘어가지 않는다.
                disabled={dirty && scope !== item}
                onClick={() => pickScope(item)}
              >
                {scopeLabel(item)}{' '}
                <span className="number">
                  {item !== 'common' && count === 0 ? '(공통 사용)' : `(${count})`}
                </span>
              </button>
            );
          })}
        </div>
        <p className="muted">
          {scope === 'common'
            ? '학년별 문제를 따로 등록하지 않은 학년이 이 문제를 풀어요.'
            : questions.length > 0
              ? `${scope}학년은 이 문제를 풀어요. 문제를 모두 지우고 저장하면 공통 문제를 써요.`
              : `${scope}학년은 지금 공통 문제를 써요. 문제를 추가하면 ${scope}학년만 그 문제를 풀어요.`}
          {dirty ? ' 다른 학년으로 넘어가려면 먼저 저장하거나 변경을 취소해 주세요.' : ''}
        </p>
        <p className="question-counts" aria-label="형식별 문제 수">
          <span>O/X {counts.ox}</span>
          <span>객관식 {counts.choice}</span>
          <span>단답형 {counts.short}</span>
        </p>
      </div>

      <ol className="question-list">
        {questions.map((question, index) => (
          <QuestionCard
            key={question.id}
            question={question}
            index={index}
            total={questions.length}
            errors={showErrors ? validateGoldenBellQuestion(question) : {}}
            onChange={(patch) => updateQuestion(index, patch)}
            onKind={(kind) =>
              change(
                questions.map((item, at) =>
                  at === index ? changeGoldenBellKind(item, kind) : item,
                ),
              )
            }
            onMove={(offset) => move(index, offset)}
            onRemove={() => setRemoveIndex(index)}
          />
        ))}
      </ol>

      {questions.length === 0 && scope === 'common' ? (
        <InlineAlert tone="warning">아직 문제가 없어요. 문제 추가를 눌러 주세요.</InlineAlert>
      ) : null}
      {listError ? <InlineAlert tone="danger">{listError}</InlineAlert> : null}
      {save.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(save.error)}</InlineAlert>
      ) : null}
      {saved ? <InlineAlert tone="success">문제를 저장했어요.</InlineAlert> : null}

      <div className="teacher-actions">
        {copySources.length > 0 ? (
          <div className="question-copy">
            <label htmlFor="gb-copy-from" className="visually-hidden">
              문제를 가져올 학년
            </label>
            <select
              id="gb-copy-from"
              className="text-input"
              value={copyFrom}
              onChange={(event) =>
                setCopyFrom(
                  event.target.value === 'common'
                    ? 'common'
                    : event.target.value === ''
                      ? ''
                      : (Number(event.target.value) as Grade),
                )
              }
            >
              <option value="">다른 문제 가져오기</option>
              {copySources.map((item) => (
                <option key={item} value={item}>
                  {scopeLabel(item)} 문제 ({scopeQuestions(config, item).length}문항)
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              size="lg"
              icon="content_copy"
              disabled={copyFrom === ''}
              onClick={() => {
                if (copyFrom === '') return;
                change(toEditable(config, copyFrom));
                setCopyFrom('');
              }}
            >
              가져오기
            </Button>
          </div>
        ) : null}
        <Button
          variant="secondary"
          size="lg"
          icon="add"
          onClick={() => change([...questions, createEmptyGoldenBellQuestion()])}
        >
          문제 추가
        </Button>
        <Button
          variant="ghost"
          size="lg"
          icon="undo"
          disabled={!dirty}
          onClick={() => pickScope(scope)}
        >
          변경 취소
        </Button>
        <Button
          size="lg"
          icon="save"
          loading={save.isPending}
          loadingLabel="저장하는 중"
          disabled={!dirty}
          onClick={() => void handleSave()}
        >
          문제 저장
        </Button>
      </div>

      <GoldenBellUploadPanel
        eventId={eventId}
        mission={mission}
        config={config}
        disabled={dirty}
        onUploaded={onSaved}
      />

      <ConfirmDialog
        open={removeIndex !== null}
        title={`${(removeIndex ?? 0) + 1}번 문제를 삭제할까요?`}
        confirmLabel="삭제"
        confirmIcon="delete"
        tone="danger"
        onCancel={() => setRemoveIndex(null)}
        onConfirm={() => {
          if (removeIndex !== null) change(questions.filter((_, at) => at !== removeIndex));
          setRemoveIndex(null);
        }}
      >
        <p>문제 저장을 눌러야 학생 화면에 반영돼요.</p>
      </ConfirmDialog>
    </section>
  );
}

interface QuestionCardProps {
  question: GoldenBellQuestion;
  index: number;
  total: number;
  errors: GoldenBellQuestionErrors;
  onChange: (patch: Partial<GoldenBellQuestion>) => void;
  onKind: (kind: GoldenBellQuestionKind) => void;
  onMove: (offset: number) => void;
  onRemove: () => void;
}

/** 문제 하나. 형식(O/X, 객관식, 단답형)에 따라 정답을 적는 칸이 달라진다. */
function QuestionCard({
  question,
  index,
  total,
  errors,
  onChange,
  onKind,
  onMove,
  onRemove,
}: QuestionCardProps) {
  const fieldId = `gb-${question.id}`;
  const no = index + 1;
  const kind = getGoldenBellKind(question);
  const answers = question.answers ?? [];

  return (
    <li
      className={`panel question-card${hasGoldenBellErrors(errors) ? ' question-card--invalid' : ''}`}
    >
      <div className="question-card__head">
        <h3 className="question-card__title">{no}번 문제</h3>
        <div className="cluster">
          <Button
            variant="ghost"
            icon="arrow_upward"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            위로
          </Button>
          <Button
            variant="ghost"
            icon="arrow_downward"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            아래로
          </Button>
          <Button variant="ghost" icon="delete" onClick={onRemove}>
            삭제
          </Button>
        </div>
      </div>

      <div className="question-card__meta">
        <FormField id={`${fieldId}-kind`} label="형식">
          {(control) => (
            <select
              {...control}
              className="text-input"
              value={kind}
              onChange={(event) => onKind(event.target.value as GoldenBellQuestionKind)}
            >
              {GOLDEN_BELL_KINDS.map((item) => (
                <option key={item} value={item}>
                  {GOLDEN_BELL_KIND_LABELS[item]}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField id={`${fieldId}-level`} label="난이도">
          {(control) => (
            <select
              {...control}
              className="text-input"
              value={question.level ?? ''}
              onChange={(event) =>
                onChange({
                  level: event.target.value ? (event.target.value as GoldenBellLevel) : undefined,
                })
              }
            >
              <option value="">표시 안 함</option>
              {GOLDEN_BELL_LEVELS.map((item) => (
                <option key={item} value={item}>
                  {GOLDEN_BELL_LEVEL_LABELS[item]}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField id={`${fieldId}-area`} label="영역">
          {(control) => (
            <input
              {...control}
              className="text-input"
              placeholder="예: AI 윤리"
              value={question.area ?? ''}
              onChange={(event) => onChange({ area: event.target.value })}
            />
          )}
        </FormField>
      </div>

      <FormField id={`${fieldId}-question`} label="문제" error={errors.question}>
        {(control) => (
          <textarea
            {...control}
            className="text-input"
            rows={2}
            value={question.question}
            onChange={(event) => onChange({ question: event.target.value })}
          />
        )}
      </FormField>

      {kind === 'choice' ? (
        <fieldset className="question-card__choices">
          <legend className="form-field__label">보기와 정답 (정답 보기를 골라 주세요)</legend>
          {question.choices.map((choice, choiceIndex) => (
            <div key={choiceIndex} className="choice-row">
              <label className="choice-row__answer">
                <input
                  type="radio"
                  name={`${fieldId}-answer`}
                  checked={question.answerIndex === choiceIndex}
                  onChange={() => onChange({ answerIndex: choiceIndex })}
                />
                정답
              </label>
              <input
                className="text-input"
                aria-label={`${no}번 문제 보기 ${choiceIndex + 1}`}
                placeholder={`보기 ${choiceIndex + 1}${choiceIndex >= 2 ? ' (비워 두면 빠져요)' : ''}`}
                value={choice}
                onChange={(event) =>
                  onChange({
                    choices: question.choices.map((value, at) =>
                      at === choiceIndex ? event.target.value : value,
                    ),
                  })
                }
              />
            </div>
          ))}
          {errors.choices || errors.answer ? (
            <p className="form-field__error">
              <Icon name="error" size="sm" />
              {errors.choices ?? errors.answer}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {kind === 'ox' ? (
        <fieldset className="question-card__choices">
          <legend className="form-field__label">정답</legend>
          <div className="cluster">
            {question.choices.map((choice, choiceIndex) => (
              <label key={choice} className="choice-row__answer">
                <input
                  type="radio"
                  name={`${fieldId}-answer`}
                  aria-label={`${no}번 문제 정답 ${choice}`}
                  checked={question.answerIndex === choiceIndex}
                  onChange={() => onChange({ answerIndex: choiceIndex })}
                />
                {choice}
              </label>
            ))}
          </div>
          {errors.answer ? (
            <p className="form-field__error">
              <Icon name="error" size="sm" />
              {errors.answer}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {kind === 'short' ? (
        <div className="question-card__meta">
          <FormField id={`${fieldId}-answer`} label="정답" error={errors.answer}>
            {(control) => (
              <input
                {...control}
                className="text-input"
                value={answers[0] ?? ''}
                onChange={(event) =>
                  onChange({ answers: [event.target.value, ...answers.slice(1)] })
                }
              />
            )}
          </FormField>
          <FormField
            id={`${fieldId}-accept`}
            label="함께 인정하는 답"
            hint="쉼표로 나눠 적어요. 띄어쓰기와 대소문자는 달라도 맞게 채점해요."
          >
            {(control) => (
              <input
                {...control}
                className="text-input"
                placeholder="예: 딥블루, Deep Blue"
                value={answers.slice(1).join(', ')}
                onChange={(event) =>
                  onChange({ answers: [answers[0] ?? '', ...splitAnswers(event.target.value)] })
                }
              />
            )}
          </FormField>
          <FormField id={`${fieldId}-hint`} label="힌트 (학생 화면에 보여요)">
            {(control) => (
              <input
                {...control}
                className="text-input"
                placeholder="예: 초성 ㅍㄹㅍㅌ"
                value={question.hint ?? ''}
                onChange={(event) => onChange({ hint: event.target.value })}
              />
            )}
          </FormField>
        </div>
      ) : null}

      <FormField id={`${fieldId}-explanation`} label="해설 (정답 공개 때 학생 화면에 보여요)">
        {(control) => (
          <input
            {...control}
            className="text-input"
            value={question.explanation}
            onChange={(event) => onChange({ explanation: event.target.value })}
          />
        )}
      </FormField>
    </li>
  );
}
