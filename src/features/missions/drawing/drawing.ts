import { DRAWING_MAX_BYTES, DRAWING_TARGET_BYTES } from '../../../domain/drawingFiles';

/** 제출하는 그림 사진의 긴 변 최대 길이(px). 별 개수나 점묘 같은 조건을 알아볼 수 있는 크기다. */
export const PHOTO_MAX_EDGE = 1280;

/** 투명한 부분은 흰색으로 내보낸다. Canvas API는 CSS 변수를 읽지 못해 여기서만 색을 정한다. */
export const CANVAS_BACKGROUND = '#ffffff';

/** 이 기기에서 화면 안 카메라를 쓸 수 있는지. 못 쓰면 사진 파일 고르기만 보여 준다. */
export function isCameraSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

export type PhotoRotation = 0 | 90 | 180 | 270;

export function nextPhotoRotation(rotation: PhotoRotation): PhotoRotation {
  return ((rotation + 90) % 360) as PhotoRotation;
}

/** 긴 변이 최대 길이를 넘지 않게 줄인 크기. 작은 사진을 키우지는 않는다. */
export function fitPhotoSize(
  width: number,
  height: number,
  maxEdge: number = PHOTO_MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxEdge / longest);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * 카메라 화면이나 사진 파일을 제출용 캔버스에 옮긴다.
 * 좌우를 뒤집지 않는다. 왼쪽·오른쪽 배치가 심사 조건이라 찍힌 그대로 보내야 한다.
 */
export function renderPhoto(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  rotation: PhotoRotation = 0,
): HTMLCanvasElement | null {
  const fitted = fitPhotoSize(sourceWidth, sourceHeight);
  if (fitted.width === 0 || fitted.height === 0) return null;
  const sideways = rotation === 90 || rotation === 270;
  const canvas = document.createElement('canvas');
  canvas.width = sideways ? fitted.height : fitted.width;
  canvas.height = sideways ? fitted.width : fitted.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = CANVAS_BACKGROUND;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(source, -fitted.width / 2, -fitted.height / 2, fitted.width, fitted.height);
  return canvas;
}

/** 고른 사진 파일을 그릴 수 있는 이미지로 읽는다. 사진이 아니면 null */
export function loadPhotoFile(file: Blob): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image.naturalWidth > 0 && image.naturalHeight > 0 ? image : null);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
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
 * 제출용 그림 사진을 압축한다(명세 6.3).
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
