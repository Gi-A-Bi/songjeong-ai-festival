/** 이름표를 붙인 사진 형식. 생성형 AI 채팅창이 가장 널리 받는 JPEG로 내보낸다. */
export const LABELED_PHOTO_MIME_TYPE = 'image/jpeg';
const LABELED_PHOTO_QUALITY = 0.9;

/** Canvas API는 CSS 변수를 읽지 못해 이름표 색은 여기서만 정한다. */
const LABEL_BACKGROUND = '#ffffff';
const LABEL_TEXT = '#000000';

export interface LabeledPhoto {
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
}

/** 이름표 띠의 높이. 작은 사진에서도 글자를 읽을 수 있게 최소 높이를 둔다. */
export function labelStripHeight(imageHeight: number): number {
  return Math.max(56, Math.round(imageHeight * 0.08));
}

/** 사진 하나를 읽는 데 기다리는 시간. 넘으면 이름표 없이 원래 사진을 쓴다. */
const LOAD_TIMEOUT_MS = 4000;

function loadImage(bytes: Uint8Array, mimeType: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
    const image = new Image();
    const finish = (result: HTMLImageElement | null) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), LOAD_TIMEOUT_MS);
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0 ? image : null);
    image.onerror = () => finish(null);
    image.src = url;
  });
}

/**
 * 사진 아래에 흰 띠를 덧붙이고 팀 이름을 적는다. 그림 자체는 가리지 않는다.
 * 생성형 AI 채팅창에서는 첨부한 파일의 이름이 보이지 않을 수 있어, 어느 팀 그림인지 사진 안에 남긴다.
 * 이 기기에서 만들 수 없으면 null을 돌려주고, 부르는 쪽은 원래 사진을 쓴다.
 */
export async function labelPhoto(
  bytes: Uint8Array,
  mimeType: string,
  label: string,
): Promise<LabeledPhoto | null> {
  try {
    const image = await loadImage(bytes, mimeType);
    if (!image) return null;
    const width = image.naturalWidth;
    const strip = labelStripHeight(image.naturalHeight);
    const height = image.naturalHeight + strip;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;

    context.fillStyle = LABEL_BACKGROUND;
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, image.naturalHeight);
    context.fillStyle = LABEL_TEXT;
    context.fillRect(0, image.naturalHeight, width, 2);
    context.font = `bold ${Math.round(strip * 0.56)}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, width / 2, image.naturalHeight + strip / 2 + 1, width - 32);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, LABELED_PHOTO_MIME_TYPE, LABELED_PHOTO_QUALITY),
    );
    if (!blob || blob.type !== LABELED_PHOTO_MIME_TYPE) return null;
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mimeType: LABELED_PHOTO_MIME_TYPE,
      width,
      height,
    };
  } catch {
    return null;
  }
}
