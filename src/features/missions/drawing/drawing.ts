export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 540;

/** 그림판 도화지는 흰색으로 내보낸다. Canvas API는 CSS 변수를 읽지 못해 여기서만 색을 정한다. */
export const CANVAS_BACKGROUND = '#ffffff';

export const PEN_COLORS: readonly { value: string; name: string }[] = [
  { value: '#1f2937', name: '검정' },
  { value: '#e5484d', name: '빨강' },
  { value: '#ff8a1f', name: '주황' },
  { value: '#f5c400', name: '노랑' },
  { value: '#2f9e44', name: '초록' },
  { value: '#0ea5ff', name: '파랑' },
  { value: '#7c5cff', name: '보라' },
  { value: '#8b5a2b', name: '갈색' },
];

export const PEN_WIDTHS: readonly { value: number; name: string }[] = [
  { value: 4, name: '가늘게' },
  { value: 10, name: '보통' },
  { value: 22, name: '굵게' },
];

export type DrawingTool = 'pen' | 'eraser';

export interface Stroke {
  tool: DrawingTool;
  color: string;
  width: number;
  points: [number, number][];
}

/** 선 하나를 그린다. 지우개는 도화지 색으로 덧칠한다. */
export function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke): void {
  const [first, ...rest] = stroke.points;
  if (!first) return;
  const color = stroke.tool === 'eraser' ? CANVAS_BACKGROUND : stroke.color;
  const width = stroke.tool === 'eraser' ? stroke.width * 2 : stroke.width;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = width;
  if (rest.length === 0) {
    context.beginPath();
    context.arc(first[0], first[1], width / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.beginPath();
  context.moveTo(first[0], first[1]);
  for (const [x, y] of rest) context.lineTo(x, y);
  context.stroke();
}

export function redrawCanvas(canvas: HTMLCanvasElement, strokes: readonly Stroke[]): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = CANVAS_BACKGROUND;
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const stroke of strokes) drawStroke(context, stroke);
}

/** 제출용 미리보기. WebP를 지원하지 않는 브라우저는 PNG로 내보낸다. */
export function exportCanvas(canvas: HTMLCanvasElement): string {
  try {
    return canvas.toDataURL('image/webp', 0.65);
  } catch {
    return '';
  }
}
