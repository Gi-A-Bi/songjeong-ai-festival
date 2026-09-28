import { useCallback, useState } from 'react';
import { AssetImage } from '../../../components/AssetImage';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/Dialog';
import { Icon } from '../../../components/Icon';
import { InlineAlert } from '../../../components/StateViews';
import { StatusBadge } from '../../../components/StatusBadge';
import { toUserMessage } from '../../../data/errors';
import { useRepository } from '../../../data/RepositoryContext';
import {
  createDefaultDrawingConfig,
  DRAWING_GRADE_BAND_LABELS,
  drawingArtworkLabel,
  drawingOptionMark,
  getDrawingGradeBand,
  resolveDrawingPrompt,
} from '../../../domain/drawingPrompts';
import type {
  DrawingConfig,
  DrawingGradeBand,
  DrawingPrompt,
  FestivalEvent,
  Grade,
  Mission,
} from '../../../domain/types';
import { useAction } from '../../../hooks/useAction';
import { ArtworkDialog } from './ArtworkDialog';

interface DrawingPromptPickerProps {
  eventId: string;
  mission: Mission;
  config: DrawingConfig;
  event: FestivalEvent;
  onSaved: () => void;
}

const GRADES: readonly Grade[] = [3, 4, 5, 6];
const BANDS: readonly DrawingGradeBand[] = ['grade34', 'grade56'];

type Selection = Record<Grade, string | null>;

function toSelection(config: DrawingConfig): Selection {
  return {
    3: resolveDrawingPrompt(config, 3)?.id ?? null,
    4: resolveDrawingPrompt(config, 4)?.id ?? null,
    5: resolveDrawingPrompt(config, 5)?.id ?? null,
    6: resolveDrawingPrompt(config, 6)?.id ?? null,
  };
}

function withSelection(config: DrawingConfig, selection: Selection): DrawingConfig {
  const selectedPromptIds: DrawingConfig['selectedPromptIds'] = {};
  for (const grade of GRADES) {
    const promptId = selection[grade];
    if (promptId !== null) selectedPromptIds[grade] = promptId;
  }
  return { ...config, selectedPromptIds };
}

/** 저장된 프롬프트가 프로그램의 기본 프롬프트와 같은지(글이나 작품을 고친 뒤 다시 넣어야 하는지) */
function matchesDefaults(prompts: readonly DrawingPrompt[]): boolean {
  const defaults = createDefaultDrawingConfig().prompts;
  return (
    prompts.length === defaults.length &&
    defaults.every((item) => {
      const saved = prompts.find((prompt) => prompt.id === item.id);
      return (
        saved !== undefined &&
        saved.text === item.text &&
        saved.artwork === item.artwork &&
        saved.artist === item.artist &&
        saved.technique === item.technique &&
        saved.gradeBand === item.gradeBand &&
        saved.optionNo === item.optionNo &&
        saved.imageKey === item.imageKey
      );
    })
  );
}

/**
 * 학년별로 그릴 명화 프롬프트(①, ② 중 하나)를 고른다.
 * 같은 학년은 모든 팀이 같은 프롬프트로 그려야 하므로 그 학년의 1라운드를 시작하기 전에 정한다.
 */
export function DrawingPromptPicker({
  eventId,
  mission,
  config,
  event,
  onSaved,
}: DrawingPromptPickerProps) {
  const repository = useRepository();
  const [selection, setSelection] = useState(() => toSelection(config));
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [viewing, setViewing] = useState<DrawingPrompt | null>(null);

  const save = useAction(
    useCallback(
      (next: DrawingConfig) => repository.updateMissionConfig(eventId, mission.id, next),
      [repository, eventId, mission.id],
    ),
  );

  const initial = toSelection(config);
  const changedGrades = GRADES.filter((grade) => selection[grade] !== initial[grade]);
  /** 지금 미션 투어를 진행하는 학년의 프롬프트를 바꾸려는지 */
  const changesRunningGrade = changedGrades.some((grade) => event.activeGrade === grade);
  const outdated = !matchesDefaults(config.prompts);

  const handleSave = async () => {
    const result = await save.run(withSelection(config, selection));
    setConfirmOpen(false);
    if (result?.ok) {
      setSavedMessage('학년별 그림 프롬프트를 저장했어요.');
      onSaved();
    }
  };

  const handleRestore = async () => {
    const defaults = createDefaultDrawingConfig();
    const kept: Selection = { 3: null, 4: null, 5: null, 6: null };
    for (const grade of GRADES) {
      const promptId = selection[grade];
      const stillThere = defaults.prompts.some(
        (prompt) => prompt.id === promptId && prompt.gradeBand === getDrawingGradeBand(grade),
      );
      kept[grade] = stillThere ? promptId : (resolveDrawingPrompt(defaults, grade)?.id ?? null);
    }
    const result = await save.run(withSelection(defaults, kept));
    setRestoreOpen(false);
    if (result?.ok) {
      setSelection(kept);
      setSavedMessage('프로그램의 기본 그림 프롬프트로 바꿨어요.');
      onSaved();
    }
  };

  return (
    <section className="stack" aria-labelledby="prompt-picker-title">
      <div className="teacher-title">
        <h2 id="prompt-picker-title" className="section-title">
          <Icon name="museum" /> 학년별 그림 프롬프트
          {changedGrades.length > 0 ? (
            <StatusBadge tone="warning" icon="edit">
              저장 안 됨
            </StatusBadge>
          ) : null}
        </h2>
      </div>

      <InlineAlert tone="info">
        학년마다 ①, ② 중 하나를 골라 주세요. 같은 학년은 모든 팀이 같은 프롬프트로 그려요. 그 학년의
        1라운드를 시작하기 전에 정해 주세요.
      </InlineAlert>
      {outdated ? (
        <InlineAlert
          tone="warning"
          action={
            <Button variant="secondary" icon="restart_alt" onClick={() => setRestoreOpen(true)}>
              기본 프롬프트로 바꾸기
            </Button>
          }
        >
          저장된 그림 프롬프트가 프로그램에 들어 있는 기본 프롬프트와 달라요.
        </InlineAlert>
      ) : null}
      {savedMessage && changedGrades.length === 0 ? (
        <InlineAlert tone="success">{savedMessage}</InlineAlert>
      ) : null}
      {save.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(save.error)}</InlineAlert>
      ) : null}

      {BANDS.map((band) => {
        const options = config.prompts
          .filter((prompt) => prompt.gradeBand === band)
          .sort((a, b) => a.optionNo - b.optionNo);
        const grades = GRADES.filter((grade) => getDrawingGradeBand(grade) === band);
        return (
          <section key={band} className="panel stack" aria-labelledby={`prompt-band-${band}`}>
            <h3 id={`prompt-band-${band}`} className="section-title">
              {DRAWING_GRADE_BAND_LABELS[band]}
            </h3>
            <ul className="prompt-options">
              {options.map((prompt) => (
                <li key={prompt.id} className="prompt-option">
                  {prompt.imageKey ? (
                    <AssetImage
                      asset={prompt.imageKey}
                      decorative
                      className="prompt-option__image"
                    />
                  ) : null}
                  <div className="prompt-option__body">
                    <strong className="prompt-option__title">
                      {drawingOptionMark(prompt)} {drawingArtworkLabel(prompt)}
                    </strong>
                    <p className="muted">표현 기법: {prompt.technique}</p>
                    <p>{prompt.text}</p>
                    <Button
                      variant="secondary"
                      icon="fullscreen"
                      onClick={() => setViewing(prompt)}
                    >
                      크게 보기
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {grades.map((grade) => (
              <div
                key={grade}
                className="prompt-grade"
                role="radiogroup"
                aria-label={`${grade}학년 그림 프롬프트`}
              >
                <span className="prompt-grade__name">
                  {grade}학년
                  {event.activeGrade === grade ? (
                    <StatusBadge tone="primary" icon="play_arrow">
                      진행 중
                    </StatusBadge>
                  ) : null}
                </span>
                {options.map((prompt) => (
                  <button
                    key={prompt.id}
                    type="button"
                    role="radio"
                    className="prompt-grade__choice"
                    aria-checked={selection[grade] === prompt.id}
                    onClick={() => {
                      setSelection((previous) => ({ ...previous, [grade]: prompt.id }));
                      setSavedMessage(null);
                    }}
                  >
                    {drawingOptionMark(prompt)} {prompt.artwork}
                  </button>
                ))}
              </div>
            ))}
          </section>
        );
      })}

      <div className="teacher-actions">
        <Button
          variant="ghost"
          size="lg"
          icon="undo"
          disabled={changedGrades.length === 0}
          onClick={() => setSelection(initial)}
        >
          되돌리기
        </Button>
        <Button
          size="lg"
          icon="save"
          disabled={changedGrades.length === 0}
          loading={save.isPending && !confirmOpen && !restoreOpen}
          loadingLabel="저장 중"
          onClick={() => {
            if (changesRunningGrade) setConfirmOpen(true);
            else void handleSave();
          }}
        >
          프롬프트 저장
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="진행 중인 학년의 프롬프트를 바꿀까요?"
        confirmLabel="바꿔서 저장"
        confirmIcon="save"
        tone="danger"
        loading={save.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void handleSave()}
      >
        <p>
          {event.activeGrade}학년은 이미 미션을 시작했어요. 지금 바꾸면 먼저 그린 팀과 나중에 그리는
          팀의 프롬프트가 달라져요. 학생 화면은 미션 화면을 다시 열어야 새 프롬프트가 보여요.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={restoreOpen}
        title="기본 그림 프롬프트로 바꿀까요?"
        confirmLabel="기본 프롬프트로 바꾸기"
        confirmIcon="restart_alt"
        loading={save.isPending}
        onCancel={() => setRestoreOpen(false)}
        onConfirm={() => void handleRestore()}
      >
        <p>
          저장된 그림 프롬프트 글을 프로그램에 들어 있는 기본 프롬프트로 바꿔요. 학년별로 고른
          번호는 그대로 둬요.
        </p>
      </ConfirmDialog>

      <ArtworkDialog prompt={viewing} onClose={() => setViewing(null)} />
    </section>
  );
}
