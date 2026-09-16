import { DRAWING_MAX_BYTES, DRAWING_TARGET_BYTES } from '../../../domain/drawingFiles';

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

export interface EncodedDrawing {
  blob: Blob;
  width: number;
  height: number;
}

/** 캔버스를 배율·품질에 맞춰 이미지로 만든다. WebP를 못 만드는 브라우저는 PNG를 돌려준다. */
export type EncodeDrawing = (
  canvas: HTMLCanvasElement,
  scale: number,
  quality: number,
) => Promise<EncodedDrawing | null>;

export const encodeDrawing: EncodeDrawing = (canvas, scale, quality) => {
  const width = Math.round(canvas.width * scale);
  const height = Math.round(canvas.height * scale);
  let source = canvas;
  if (scale !== 1) {
    source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const context = source.getContext('2d');
    if (!context) return Promise.resolve(null);
    context.fillStyle = CANVAS_BACKGROUND;
    context.fillRect(0, 0, width, height);
    context.drawImage(canvas, 0, 0, width, height);
  }
  return new Promise((resolve) => {
    try {
      source.toBlob(
        (blob) => resolve(blob ? { blob, width, height } : null),
        'image/webp',
        quality,
      );
    } catch {
      resolve(null);
    }
  });
};

/** 목표 크기(300KB) 안에 들 때까지 품질, 그다음 크기를 줄여 본다. */
const COMPRESSION_STEPS: readonly { scale: number; quality: number }[] = [
  { scale: 1, quality: 0.65 },
  { scale: 1, quality: 0.55 },
  { scale: 1, quality: 0.45 },
  { scale: 1, quality: 0.35 },
  { scale: 0.75, quality: 0.5 },
  { scale: 0.5, quality: 0.5 },
];

export type CompressDrawingResult =
  | { ok: true; drawing: EncodedDrawing }
  | { ok: false; reason: 'too-large' | 'unsupported'; byteSize: number | null };

/**
 * 제출용 그림을 압축한다(명세 6.3).
 * 300KB 이하가 나오면 바로 쓰고, 끝까지 넘으면 가장 작은 결과가 350KB 이하일 때만 쓴다.
 */
export async function compressDrawing(
  canvas: HTMLCanvasElement,
  encode: EncodeDrawing = encodeDrawing,
): Promise<CompressDrawingResult> {
  let smallest: EncodedDrawing | null = null;
  for (const step of COMPRESSION_STEPS) {
    const encoded = await encode(canvas, step.scale, step.quality);
    if (!encoded) continue;
    if (!smallest || encoded.blob.size < smallest.blob.size) smallest = encoded;
    if (encoded.blob.size <= DRAWING_TARGET_BYTES) return { ok: true, drawing: encoded };
  }
  if (!smallest) return { ok: false, reason: 'unsupported', byteSize: null };
  if (smallest.blob.size <= DRAWING_MAX_BYTES) return { ok: true, drawing: smallest };
  return { ok: false, reason: 'too-large', byteSize: smallest.blob.size };
}
