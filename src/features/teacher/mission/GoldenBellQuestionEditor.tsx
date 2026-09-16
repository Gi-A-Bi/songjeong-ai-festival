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
  createEmptyGoldenBellQuestion,
  getGoldenBellConfigError,
  GOLDEN_BELL_RECOMMENDED_QUESTIONS,
  hasGoldenBellErrors,
  normalizeGoldenBellQuestion,
  toEditableGoldenBellQuestion,
  validateGoldenBellQuestion,
} from '../../../domain/goldenBell';
import type { GoldenBellConfig, GoldenBellQuestion, Mission } from '../../../domain/types';
import { useAction } from '../../../hooks/useAction';

interface GoldenBellQuestionEditorProps {
  eventId: string;
  mission: Mission;
  config: GoldenBellConfig;
  onSaved: () => void;
}

function toEditable(config: GoldenBellConfig): GoldenBellQuestion[] {
  return config.questions.map(toEditableGoldenBellQuestion);
}

/** 골든벨 문제 등록·수정. 저장하면 모든 학년·라운드가 같은 문제를 쓴다. */
export function GoldenBellQuestionEditor({
  eventId,
  mission,
  config,
  onSaved,
}: GoldenBellQuestionEditorProps) {
  const repository = useRepository();
  const [questions, setQuestions] = useState(() => toEditable(config));
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saved, setSaved] = useState(false);
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);

  const save = useAction(
    useCallback(
      (next: GoldenBellQuestion[]) =>
        repository.updateMissionConfig(eventId, mission.id, {
          type: 'golden_bell',
          questions: next,
        }),
      [repository, eventId, mission.id],
    ),
  );

  const change = (next: GoldenBellQuestion[]) => {
    setQuestions(next);
    setDirty(true);
    setSaved(false);
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

  const handleSave = async () => {
    setShowErrors(true);
    const normalized = questions.map(normalizeGoldenBellQuestion);
    if (getGoldenBellConfigError(normalized)) return;
    const result = await save.run(normalized);
    if (result?.ok) {
      setQuestions(toEditable({ type: 'golden_bell', questions: normalized }));
      setDirty(false);
      setShowErrors(false);
      setSaved(true);
      onSaved();
    }
  };

  const listError = showErrors ? getGoldenBellConfigError(questions) : null;

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

      <ol className="question-list">
        {questions.map((question, index) => {
          const errors = showErrors ? validateGoldenBellQuestion(question) : {};
          const fieldId = `gb-${question.id}`;
          return (
            <li
              key={question.id}
              className={`panel question-card${hasGoldenBellErrors(errors) ? ' question-card--invalid' : ''}`}
            >
              <div className="question-card__head">
                <h3 className="question-card__title">{index + 1}번 문제</h3>
                <div className="cluster">
                  <Button
                    variant="ghost"
                    icon="arrow_upward"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    위로
                  </Button>
                  <Button
                    variant="ghost"
                    icon="arrow_downward"
                    disabled={index === questions.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    아래로
                  </Button>
                  <Button variant="ghost" icon="delete" onClick={() => setRemoveIndex(index)}>
                    삭제
                  </Button>
                </div>
              </div>

              <FormField id={`${fieldId}-question`} label="문제" error={errors.question}>
                {(control) => (
                  <textarea
                    {...control}
                    className="text-input"
                    rows={2}
                    value={question.question}
                    onChange={(event) => updateQuestion(index, { question: event.target.value })}
                  />
                )}
              </FormField>

              <fieldset className="question-card__choices">
                <legend className="form-field__label">보기와 정답 (정답 보기를 골라 주세요)</legend>
                {question.choices.map((choice, choiceIndex) => (
                  <div key={choiceIndex} className="choice-row">
                    <label className="choice-row__answer">
                      <input
                        type="radio"
                        name={`${fieldId}-answer`}
                        checked={question.answerIndex === choiceIndex}
                        onChange={() => updateQuestion(index, { answerIndex: choiceIndex })}
                      />
                      정답
                    </label>
                    <input
                      className="text-input"
                      aria-label={`${index + 1}번 문제 보기 ${choiceIndex + 1}`}
                      placeholder={`보기 ${choiceIndex + 1}${choiceIndex >= 2 ? ' (비워 두면 빠져요)' : ''}`}
                      value={choice}
                      onChange={(event) =>
                        updateQuestion(index, {
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

              <FormField
                id={`${fieldId}-explanation`}
                label="해설 (정답 공개 때 학생 화면에 보여요)"
              >
                {(control) => (
                  <input
                    {...control}
                    className="text-input"
                    value={question.explanation}
                    onChange={(event) => updateQuestion(index, { explanation: event.target.value })}
                  />
                )}
              </FormField>
            </li>
          );
        })}
      </ol>

      {questions.length === 0 ? (
        <InlineAlert tone="warning">아직 문제가 없어요. 문제 추가를 눌러 주세요.</InlineAlert>
      ) : null}
      {listError ? <InlineAlert tone="danger">{listError}</InlineAlert> : null}
      {save.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(save.error)}</InlineAlert>
      ) : null}
      {saved ? <InlineAlert tone="success">문제를 저장했어요.</InlineAlert> : null}

      <div className="teacher-actions">
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
          onClick={() => {
            setQuestions(toEditable(config));
            setDirty(false);
            setShowErrors(false);
          }}
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
