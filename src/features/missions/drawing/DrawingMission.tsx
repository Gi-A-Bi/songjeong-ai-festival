import { useRef, useState } from 'react';
import { paths } from '../../../app/paths';
import { Button } from '../../../components/Button';
import { ConfirmDialog, Dialog } from '../../../components/Dialog';
import { Icon } from '../../../components/Icon';
import { MissionShell } from '../../../components/MissionShell';
import { StatusBadge } from '../../../components/StatusBadge';
import { canSubmitInPhase } from '../../../domain/missionPhase';
import type { DrawingConfig } from '../../../domain/types';
import { MissionNotice } from '../MissionNotice';
import type { MissionScreenProps } from '../missionTypes';
import { useMissionSubmit } from '../useMissionSubmit';
import { DrawingBoard } from './DrawingBoard';
import { exportCanvas, PEN_COLORS, PEN_WIDTHS, type DrawingTool, type Stroke } from './drawing';
import '../Missions.css';
import './Drawing.css';

interface DrawingMissionProps extends MissionScreenProps {
  config: DrawingConfig;
}

export function DrawingMission({
  eventId,
  view,
  event,
  phase,
  onSubmitted,
  config,
}: DrawingMissionProps) {
  const { team, mission, submission, roundNo } = view;
  const saved = submission?.answer.type === 'drawing' ? submission.answer : null;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [tool, setTool] = useState<DrawingTool>('pen');
  const [color, setColor] = useState(PEN_COLORS[0].value);
  const [width, setWidth] = useState(PEN_WIDTHS[1].value);
  const [confirmClear, setConfirmClear] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const { submit, isPending, error } = useMissionSubmit(eventId, team.id, mission.id, onSubmitted);

  const editable = canSubmitInPhase(phase) && saved === null;

  const openPreview = () => {
    if (canvasRef.current) setPreview(exportCanvas(canvasRef.current));
  };

  const confirmSubmit = async () => {
    await submit({ type: 'drawing', strokeCount: strokes.length, previewDataUrl: preview || null });
    setPreview(null);
  };

  return (
    <MissionShell
      mission={mission}
      team={team}
      roundNo={roundNo}
      event={event}
      phase={phase}
      notice={
        <MissionNotice
          phase={phase}
          event={event}
          error={error}
          teacherJudged={mission.teacherJudged}
          cardsPath={paths.cards(eventId, team.id)}
        />
      }
      actions={
        saved ? (
          <StatusBadge tone="info" icon="lock" size="lg">
            제출 완료 · 선생님이 순위를 정해요
          </StatusBadge>
        ) : (
          <>
            <p className="mission-actions__hint">
              <Icon name="info" />
              그림에 이름은 쓰지 않아요
            </p>
            <Button
              size="xl"
              icon="visibility"
              onClick={openPreview}
              disabled={!editable || strokes.length === 0}
            >
              미리보기 후 제출
            </Button>
          </>
        )
      }
    >
      <section className="drawing-prompt" aria-labelledby="drawing-prompt-title">
        <h2 id="drawing-prompt-title" className="drawing-prompt__label">
          <Icon name="smart_toy" />
          그림 설명
        </h2>
        <p className="drawing-prompt__text">{config.prompt}</p>
      </section>

      {saved ? (
        <figure className="drawing-submitted">
          {saved.previewDataUrl ? (
            <img
              src={saved.previewDataUrl}
              alt="우리 팀이 제출한 그림"
              className="drawing-submitted__image"
            />
          ) : (
            <p className="muted">그림을 제출했어요. 미리보기는 이 기기에 저장되지 않았어요.</p>
          )}
          <figcaption>제출한 그림</figcaption>
        </figure>
      ) : (
        <div className="drawing-board">
          <div className="drawing-tools" role="toolbar" aria-label="그리기 도구">
            <div className="drawing-tools__group">
              <ToolButton
                icon="brush"
                label="펜"
                pressed={tool === 'pen'}
                onClick={() => setTool('pen')}
                disabled={!editable}
              />
              <ToolButton
                icon="ink_eraser"
                label="지우개"
                pressed={tool === 'eraser'}
                onClick={() => setTool('eraser')}
                disabled={!editable}
              />
            </div>

            <fieldset className="drawing-tools__fieldset" disabled={!editable}>
              <legend className="drawing-tools__legend">
                <Icon name="palette" size="sm" /> 색상
              </legend>
              <div className="drawing-colors">
                {PEN_COLORS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="drawing-color"
                    style={{ backgroundColor: option.value }}
                    aria-label={option.name}
                    aria-pressed={color === option.value}
                    onClick={() => {
                      setColor(option.value);
                      setTool('pen');
                    }}
                  />
                ))}
              </div>
            </fieldset>

            <fieldset className="drawing-tools__fieldset" disabled={!editable}>
              <legend className="drawing-tools__legend">
                <Icon name="line_weight" size="sm" /> 굵기
              </legend>
              <div className="drawing-widths">
                {PEN_WIDTHS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="drawing-width"
                    aria-pressed={width === option.value}
                    onClick={() => setWidth(option.value)}
                  >
                    <span
                      className="drawing-width__dot"
                      style={{ width: option.value, height: option.value }}
                    />
                    {option.name}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="drawing-tools__group">
              <ToolButton
                icon="undo"
                label="실행 취소"
                onClick={() => setStrokes((previous) => previous.slice(0, -1))}
                disabled={!editable || strokes.length === 0}
              />
              <ToolButton
                icon="delete"
                label="전체 지우기"
                onClick={() => setConfirmClear(true)}
                disabled={!editable || strokes.length === 0}
              />
            </div>
          </div>

          <DrawingBoard
            canvasRef={canvasRef}
            strokes={strokes}
            brush={{ tool, color, width }}
            disabled={!editable}
            onStrokeEnd={(stroke) => setStrokes((previous) => [...previous, stroke])}
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmClear}
        title="그림을 모두 지울까요?"
        confirmLabel="모두 지우기"
        confirmIcon="delete"
        tone="danger"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setStrokes([]);
          setConfirmClear(false);
        }}
      >
        <p>지운 그림은 되돌릴 수 없어요.</p>
      </ConfirmDialog>

      <Dialog
        open={preview !== null}
        title="이 그림으로 제출할까요?"
        size="lg"
        onClose={() => setPreview(null)}
        footer={
          <>
            <Button
              variant="secondary"
              size="lg"
              icon="brush"
              onClick={() => setPreview(null)}
              disabled={isPending}
            >
              더 그리기
            </Button>
            <Button
              size="lg"
              icon="send"
              onClick={() => void confirmSubmit()}
              loading={isPending}
              loadingLabel="제출하는 중"
            >
              제출하기
            </Button>
          </>
        }
      >
        {preview ? (
          <img src={preview} alt="제출할 그림 미리보기" className="drawing-preview" />
        ) : null}
        <p className="muted">한 번 제출하면 선생님이 허락할 때만 다시 그릴 수 있어요.</p>
      </Dialog>
    </MissionShell>
  );
}

function ToolButton({
  icon,
  label,
  pressed,
  disabled,
  onClick,
}: {
  icon: 'brush' | 'ink_eraser' | 'undo' | 'delete';
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="drawing-tool"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
      {label}
    </button>
  );
}
