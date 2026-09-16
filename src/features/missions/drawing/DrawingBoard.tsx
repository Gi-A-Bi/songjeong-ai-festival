import { useEffect, useRef, type PointerEvent, type RefObject } from 'react';
import { CANVAS_HEIGHT, CANVAS_WIDTH, drawStroke, redrawCanvas, type Stroke } from './drawing';

interface DrawingBoardProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  strokes: readonly Stroke[];
  /** 새 선을 그리기 시작할 때 쓸 도구 설정 */
  brush: Omit<Stroke, 'points'>;
  disabled: boolean;
  onStrokeEnd: (stroke: Stroke) => void;
}

/** HTML Canvas 그림판. 선 목록이 바뀌면 다시 그리고, 그리는 중인 선은 바로 칠한다. */
export function DrawingBoard({
  canvasRef,
  strokes,
  brush,
  disabled,
  onStrokeEnd,
}: DrawingBoardProps) {
  const current = useRef<Stroke | null>(null);

  useEffect(() => {
    if (canvasRef.current) redrawCanvas(canvasRef.current, strokes);
  }, [canvasRef, strokes]);

  const toCanvasPoint = (event: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    ];
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (disabled || event.button > 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const stroke: Stroke = { ...brush, points: [toCanvasPoint(event)] };
    current.current = stroke;
    const context = event.currentTarget.getContext('2d');
    if (context) drawStroke(context, stroke);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const stroke = current.current;
    if (!stroke) return;
    const point = toCanvasPoint(event);
    const previous = stroke.points[stroke.points.length - 1];
    stroke.points.push(point);
    const context = event.currentTarget.getContext('2d');
    if (context) drawStroke(context, { ...stroke, points: [previous, point] });
  };

  const finishStroke = () => {
    const stroke = current.current;
    current.current = null;
    if (stroke) onStrokeEnd(stroke);
  };

  return (
    <canvas
      ref={canvasRef}
      className="drawing-board__canvas"
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      aria-label="그림판. 손가락이나 펜으로 그려요."
      role="img"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
    />
  );
}
