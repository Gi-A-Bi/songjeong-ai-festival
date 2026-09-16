import { useEffect, useRef, useState } from 'react';
import { AssetImage } from '../../../components/AssetImage';
import { Button } from '../../../components/Button';
import { ConfirmDialog, Dialog } from '../../../components/Dialog';
import { Icon } from '../../../components/Icon';
import { MissionShell } from '../../../components/MissionShell';
import { StatusBadge } from '../../../components/StatusBadge';
import { RepositoryError } from '../../../data/errors';
import { formatBytes } from '../../../domain/drawingFiles';
import { canSubmitInPhase } from '../../../domain/missionPhase';
import type { DrawingConfig } from '../../../domain/types';
import { MissionNotice } from '../MissionNotice';
import type { MissionScreenProps } from '../missionTypes';
import { useMissionSubmit } from '../useMissionSubmit';
import { DrawingBoard } from './DrawingBoard';
import {
  compressDrawing,
  PEN_COLORS,
  PEN_WIDTHS,
  type DrawingTool,
  type EncodedDrawing,
  type Stroke,
} from './drawing';
import '../Missions.css';
import './Drawing.css';

interface DrawingMissionProps extends MissionScreenProps {
  config: DrawingConfig;
}

interface PreparedDrawing extends EncodedDrawing {
  url: string;
}

/**
 * 제출한 그림 미리보기. 학생은 그림 파일을 다시 읽을 수 없어(교사만 읽기)
 * 이 기기에서 방금 제출한 그림만 기억해 보여 준다.
 */
const submittedPreviews = new Map<string, string>();

export function DrawingMission({
  eventId,
  view,
  event,
  phase,
  onSubmitted,
  config,
}: DrawingMissionProps) {
  const { team, mission, submission, roundNo } = view;
  const saved =
    submission && submission.status !== 'draft' && submission.answer.type === 'drawing'
      ? submission.answer
      : null;
  const previewKey = `${eventId}|${team.id}|${mission.id}`;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [tool, setTool] = useState<DrawingTool>('pen');
  const [color, setColor] = useState(PEN_COLORS[0].value);
  const [width, setWidth] = useState(PEN_WIDTHS[1].value);
  const [confirmClear, setConfirmClear] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<PreparedDrawing | null>(null);
  const [exportError, setExportError] = useState<RepositoryError | null>(null);
  const { submit, isPending, error } = useMissionSubmit(eventId, team.id, mission.id, onSubmitted);

  const editable = canSubmitInPhase(phase) && saved === null;

  // 제출하지 않고 닫은 미리보기 주소는 메모리에서 정리한다.
  useEffect(
    () => () => {
      if (prepared && submittedPreviews.get(previewKey) !== prepared.url) {
        URL.revokeObjectURL(prepared.url);
      }
    },
    [prepared, previewKey],
  );

  const openPreview = async () => {
    if (!canvasRef.current || preparing) return;
    setPreparing(true);
    setExportError(null);
    const result = await compressDrawing(canvasRef.current);
    setPreparing(false);
    if (!result.ok) {
      setExportError(
        new RepositoryError(
          'invalid-input',
          result.reason === 'too-large'
            ? `그림 파일이 너무 커요(${formatBytes(result.byteSize ?? 0)}). 넓게 칠한 부분을 조금 줄이고 다시 눌러 주세요.`
            : '이 기기에서 그림 파일을 만들지 못했어요. 선생님께 알려 주세요.',
        ),
      );
      return;
    }
    setPrepared({ ...result.drawing, url: URL.createObjectURL(result.drawing.blob) });
  };

  const confirmSubmit = async () => {
    if (!prepared) return;
    const bytes = new Uint8Array(await prepared.blob.arrayBuffer());
    const mimeType = prepared.blob.type || 'image/webp';
    // 제출이 끝나 화면이 바뀌기 전에 미리보기 주소를 남겨 둔다. 실패하면 지운다.
    submittedPreviews.set(previewKey, prepared.url);
    const ok = await submit(
      {
        type: 'drawing',
        strokeCount: strokes.length,
        mimeType,
        byteSize: bytes.length,
        width: prepared.width,
        height: prepared.height,
      },
      {
        promptId: config.promptId,
        mimeType,
        width: prepared.width,
        height: prepared.height,
        bytes,
      },
    );
    if (!ok) submittedPreviews.delete(previewKey);
    setPrepared(null);
  };

  const submittedPreview = submittedPreviews.get(previewKey);

  return (
    <MissionShell
      mission={mission}
      team={team}
      roundNo={roundNo}
      event={event}
      phase={phase}
      notice={
        <MissionNotice phase={phase} event={event} view={view} error={error ?? exportError} />
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
              onClick={() => void openPreview()}
              disabled={!editable || strokes.length === 0}
              loading={preparing}
              loadingLabel="그림 준비 중"
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
          {submittedPreview ? (
            <img
              src={submittedPreview}
              alt="우리 팀이 제출한 그림"
              className="drawing-submitted__image"
            />
          ) : (
            <AssetImage asset="mascotCorrect" decorative className="waiting-panel__mascot" />
          )}
          <figcaption>그림 파일을 선생님께 보냈어요 ({formatBytes(saved.byteSize)})</figcaption>
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
        open={prepared !== null}
        title="이 그림으로 제출할까요?"
        size="lg"
        onClose={() => {
          if (!isPending) setPrepared(null);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              size="lg"
              icon="brush"
              onClick={() => setPrepared(null)}
              disabled={isPending}
            >
              더 그리기
            </Button>
            <Button
              size="lg"
              icon="send"
              onClick={() => void confirmSubmit()}
              loading={isPending}
              loadingLabel="보내는 중"
            >
              제출하기
            </Button>
          </>
        }
      >
        {prepared ? (
          <img src={prepared.url} alt="제출할 그림 미리보기" className="drawing-preview" />
        ) : null}
        <p className="muted">
          그림 파일({prepared ? formatBytes(prepared.blob.size) : '-'})이 선생님 화면으로 가요. 한
          번 제출하면 선생님이 허락할 때만 다시 그릴 수 있어요.
        </p>
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
